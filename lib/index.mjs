// whale-girl Node half：积累型账本宿主 + assets 静态服务 + 活动/事件推导 + 状态持久化。
// 契约：官方 bundle 插件的 Node half（完整 Cordis 插件，仓库根 package.json 的 dsh.bundle/dsh.client）；交互经 webServer 路由；
// 路由端点单一来源 src/routes.mjs（verify-routes-sync 门禁守护，改前缀只改那里）；
// activity 是派生字段，不写入账本（账本保持纯函数积累，见 src/pet-state.mjs）。
// 事件机制（v2，零负反馈）：任务完成 → 资历 +XP/称号/回忆 + celebrate；失败 → 只计数 +
// error(4s) → disappointed(6s) 瞬发（任务失败与请求错误同一负面窗口，总 10s）；新会话 → welcome；
// 工作态累加活跃时长。
// 安全：/interact 校验跨源（CSRF）；body 上限 1KB；assets 路径净化拒绝 `\` 段（Windows 穿越）。
// 持久化：状态存 <dshHome>/data/whale-girl/state.json（.tmp + rename 原子写，1s 防抖，
// 事件记账时落盘；disable 时末次落盘）。
import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import {
  INITIAL_STATE, recordTaskCompleted, recordFailure, recordSession, recordSessionResume, recordActive,
} from './src/pet-state.mjs'
import {
  emptySessionMemory, normalizeSessionMemory, serializeSessionMemory,
  observeSession, recordTask, memoryFor, memorySnapshot, recallable,
} from './src/session-memory.mjs'
import { deriveActivity, mergeCelebrate } from './src/activity.mjs'
import { sanitizeAssetPath, contentTypeFor, ASSETS_PATH } from './src/assets.mjs'
import { applyAction, isCrossOrigin } from './src/interact.mjs'
import { parseTurnEvent } from './src/session-events.mjs'
import { createSessionView, applySessionView, titleFromLog } from './src/sessions.mjs'
import { normalizeState, serializeState } from './src/persistence.mjs'
import { createSignals } from './src/signals.mjs'
import { buildSchema, readConfig } from './src/config.mjs'
import { SNAPSHOT_API_VERSION, TURN_COMPLETED_MS, MEMORY_WINDOW_MS, turnCompletionSnapshot } from './src/snapshot.mjs'
import { PRESENCE_TTL_MS, pokePresence, companionOnline } from './src/presence.mjs'
import { parseRepository } from './src/update.mjs'
import { UPDATE_TIMEOUT_MS, createUpdateHost } from './src/update-host.mjs'

export const name = 'whale-girl'
export const inject = ['jobs', 'agents', 'sessions', 'webServer']
/** 条目 Config schema：宿主按它校验条目 config 并把 volatile 叶子注入 apply 的 config。 */
export const Config = buildSchema()
// 路由端点 re-export（来源 src/routes.mjs；保持既有导出面）。
import { STATE_PATH, INTERACT_PATH, CONFIG_PATH, ROUTE_PREFIX, EVENTS_PATH, PRESENCE_PATH, SESSIONS_PATH, UPDATE_PATH } from './src/routes.mjs'
export { STATE_PATH, INTERACT_PATH, CONFIG_PATH, ROUTE_PREFIX, EVENTS_PATH, PRESENCE_PATH, SESSIONS_PATH, UPDATE_PATH }
/** /interact 请求体大小上限（动作只需几字节）。 */
export const BODY_LIMIT = 1024

// 瞬发窗口时长现由配置（L1 体验层）提供：errorMs/disappointedMs/welcomeMs/celebrateMs，
// 见 src/config.mjs 的 DEFAULTS。消费处统一读 configRef，不再用模块级常量（防双源漂移）。
// 默认值：error 4s → disappointed 6s（总负面 10s，任务失败与请求错误统一）；欢迎 6s；庆祝 6s
// （与 deriveActivity 的 BURST_MS 同长：事件路径与轮询路径取 max 不叠加延长）。

/** 状态文件：<dshHome>/data/whale-girl/state.json（不放插件目录——uninstall 会删）。 */
const DSH_HOME = process.env.DSH_HOME ?? resolve(import.meta.dirname, '../../..')
const STATE_FILE = join(DSH_HOME, 'data', 'whale-girl', 'state.json')
/** 会话记忆文件：<dshHome>/data/whale-girl/sessions.json（与账本分离：开关只停记忆，不动账本）。 */
const MEMORY_FILE = join(DSH_HOME, 'data', 'whale-girl', 'sessions.json')

/** 读取并归一化已保存状态；缺失/损坏返回 null。 */
function loadState() {
  try {
    return normalizeState(JSON.parse(readFileSync(STATE_FILE, 'utf8')))
  } catch {
    return null
  }
}

/** 原子写：同目录 .tmp + rename；失败不阻塞插件（状态仅本次运行有效）。 */
function saveState(next) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    const tmp = `${STATE_FILE}.tmp`
    writeFileSync(tmp, serializeState(next))
    renameSync(tmp, STATE_FILE)
  } catch {
    // 持久化失败不阻塞插件：状态仅本次运行内有效。
  }
}

/** 读取并归一化会话记忆；缺失/损坏返回空账本（记忆可丢，仅影响气泡文案）。 */
function loadSessionMemory() {
  try {
    return normalizeSessionMemory(JSON.parse(readFileSync(MEMORY_FILE, 'utf8')))
  } catch {
    return emptySessionMemory()
  }
}

/** 原子写会话记忆（同 state 的 .tmp + rename）；失败不阻塞插件。 */
function saveSessionMemory(next) {
  try {
    mkdirSync(dirname(MEMORY_FILE), { recursive: true })
    const tmp = `${MEMORY_FILE}.tmp`
    writeFileSync(tmp, serializeSessionMemory(next))
    renameSync(tmp, MEMORY_FILE)
  } catch {
    // 记忆持久化失败不阻塞插件：下次事件重试。
  }
}

/** 收集宿主全部任务：owned（按 agent 遍历，绕过 owner fence）+ unowned，按 id 去重。 */
function collectTasks(ctx) {
  const jobs = ctx.jobs
  const seen = new Set()
  const out = []
  for (const agent of ctx.agents.list()) {
    for (const snapshot of jobs.list(agent.id)) {
      if (seen.has(snapshot.id)) continue
      seen.add(snapshot.id)
      out.push({ id: snapshot.id, status: snapshot.status, label: snapshot.label })
    }
  }
  for (const snapshot of jobs.list()) {
    if (seen.has(snapshot.id)) continue
    seen.add(snapshot.id)
    out.push({ id: snapshot.id, status: snapshot.status, label: snapshot.label })
  }
  return out
}

/** 自身清单（当前版本与包名的兜底来源；用户可见的 version 不额外加 v）。 */
function readSelfManifest() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return {
      name: typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : 'whale-girl',
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
      // 只给「本地路径安装」用：那种安装 profile 里没有上游可跟，只能改写包自己声明的仓库。
      // git/registry 安装的更新目标一律是 profile 记的那条 spec，不用这里的值。
      repository: parseRepository(manifest.repository?.url),
    }
  } catch {
    return { name: 'whale-girl', version: undefined, repository: undefined }
  }
}

/** 带时限的 JSON GET（更新检查；宿主 Node 提供 fetch）。 */
async function fetchJson(url, accept, self) {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable')
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, UPDATE_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { accept, 'user-agent': `${self.name}${self.version === undefined ? '' : `/${self.version}`}` },
      signal: controller.signal,
    })
    if (!response.ok) {
      const failure = new Error(`HTTP ${response.status}`)
      failure.status = response.status
      throw failure
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra })
  res.end(JSON.stringify(body))
}

/** 读取请求体（超 BODY_LIMIT 返回 null，由调用方回 413）。 */
async function readBody(req, limit = BODY_LIMIT) {
  let data = ''
  for await (const chunk of req) {
    data += chunk
    if (data.length > limit) return null
  }
  return data
}

export function apply(ctx, config) {
  let state = loadState() ?? { ...INITIAL_STATE, updatedAt: Date.now() }
  // 配置（L1 体验层）：命名空间 = 条目 id（= NAMESPACE），schema 是本模块的 Config
  // 导出（buildSchema）。宿主校验条目 config 后把它交给本函数——标了 volatile 的叶子
  // 是实时引用（get()），改值由宿主原地提交、不重挂载。读值一律走 readConfig
  // （解引用 + DEFAULTS 补缺 + 成对区间归一）；configRevision 随 /state 下发，客户端
  // 以此门控「配置变化才重应用」（无需重启）。
  let configRef = readConfig(config)
  let configRevision = 0
  ctx.effect(() => ctx.on('loader/volatile-update', () => {
    configRef = readConfig(config)
    configRevision += 1
    syncMemoryConfig()
    broadcastEvent()
  }), 'whale-girl: 配置热更新')
  // 落盘防抖：事件记账时触发（任务完成/失败/会话/活跃时长）。
  let saveTimer = null
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveState(state), 1000)
  }
  // ---- 会话记忆（sessionMemory 开关门控）----
  // 关 = 零读零写零副作用：memory 恒为 null，事件回调里的记忆分支全部跳过，
  // 文件留在磁盘上（用户可自行删除；下次开启接着用）。
  // 开 = 懒加载：首次启用时读文件，之后事件驱动写入、1s 防抖落盘（与账本同节拍）。
  // memoryRecall 是最近一次 agent/created 边沿的回读快照，随 /state 在
  // MEMORY_WINDOW_MS 窗口内下发——客户端按 at 去重后播报一次气泡。
  let memory = null
  let memoryRecall = null
  let memorySaveTimer = null
  const memoryEnabled = () => configRef.sessionMemory === true
  const ensureMemory = () => {
    if (memory === null && memoryEnabled()) memory = loadSessionMemory()
    return memory
  }
  const scheduleMemorySave = () => {
    if (memory === null) return
    clearTimeout(memorySaveTimer)
    memorySaveTimer = setTimeout(() => { if (memory !== null) saveSessionMemory(memory) }, 1000)
  }
  // 配置热更新时对齐开关状态：开→懒加载；关→丢内存副本并撤下未播报的回读
  // （磁盘文件保留，见上）。
  const syncMemoryConfig = () => {
    if (memoryEnabled()) {
      ensureMemory()
    } else {
      memory = null
      memoryRecall = null
    }
  }
  // ---- SSE 即时事件（v9：事件 → 宠物反应的延迟从 pollMs 轮询降到单次 /state 往返）----
  // 事件（turn 边沿/会话启动/任务终态/请求错误）发生时广播，client 收到立即 refresh()
  // 拉最新 /state——回合完成庆祝/欢迎/思考陪伴不再等下一个轮询周期（默认 3s）。
  // 轮询保留兜底（SSE 断线/不可用时宠物照常跑，EventSource 内建自动重连）。
  // 连接管理：res 写入失败（断连）即从集合移除；close 时清理（心跳一并停）。
  const sseClients = new Set()
  const broadcastEvent = () => {
    const line = 'data: {"type":"event"}\n\n'
    for (const res of sseClients) {
      try { res.write(line) } catch { sseClients.delete(res) }
    }
  }
  // 活动推导记账（跨轮询保持；与账本分离，见 src/activity.mjs 契约）。
  const known = new Map()
  let wasWorking = false
  let lastActiveCheck = Date.now()
  // 瞬发窗口（welcome > error > disappointed；celebrate 由任务派生——事件 + 轮询两源）。
  let errorUntil = 0
  let disappointedUntil = 0
  let welcomeUntil = 0
  let celebrateUntil = 0
  // 桌面伴侣在场窗口（心跳写面，见 src/presence.mjs）：在场时网页端宠物隐藏。
  let companionUntil = 0

  // ---- 会话状态聚合（v8：官方自渲染 client 无 ctx.sessions——Node half 聚合进 /state）----
  // client 自执行脚本 `apply({})` 拿不到宿主 sessions 服务（官方注入面只给 __DSH_BOOT__），
  // 会话感知（think 陪伴/等待批准/回合完成）改由 Node half 经 `ctx.sessions` 推导后随 /state
  // 轮询下发。信号源：
  // - 思考中（sessionThink）：任一会话处于 turn 之间（有 turn/start 未 turn/end）或已开始未结束
  // - 等待批准（sessionWait）：turn/end 的 reason.kind === 'blocked'（等待用户批准/权限）
  // - 回合完成（turnCompleted）：turn/end 边沿后的共享时间窗（每个消费者均可观察）
  const sessionsSvc = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
  // 会话标题权威源（dsh-session-title）：重启后历史 session/title 事件不可见，
  // 靠该服务补全（get(session)?.title）。缺席时退回事件日志标题。
  const sessionTitleSvc = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : undefined
  let sessionThink = false
  let sessionWait = false
  let turnCompletedUntil = 0
  const activeTurns = new Map() // sessionId → turn/start 未 turn/end 计数
  // 每会话活动账本（/sessions 端点）：sessionId → { id, title, activity, since }。
  // 事件驱动更新（session/event 回调）；sessions 服务缺席时降级为仅事件视图。
  const sessionViews = new Map()
  // 会话记忆归属兜底：最近一次出现在事件流里的会话 id（owner 缺失的任务落这里；null=没见过会话）。
  let lastSessionId = null
  // 标题解析：事件日志（titleFromLog）优先，sessionTitle 服务兜底（重启后补历史标题）。
  const resolveSessionTitle = (s) => {
    const fromLog = titleFromLog(Array.isArray(s?.events) ? s.events : [])
    if (fromLog !== null) return fromLog
    try {
      const snapshot = sessionTitleSvc?.get?.(s)
      return typeof snapshot?.title === 'string' && snapshot.title !== '' ? snapshot.title : null
    } catch {
      return null
    }
  }
  const sessionUpdate = () => {
    // 从当前会话列表与 turn 边沿聚合（sessions 服务缺席时保持上次值——宠物照常跑）。
    if (sessionsSvc === undefined || typeof sessionsSvc.list !== 'function') return
    try {
      const sessions = sessionsSvc.list()
      let thinking = false
      for (const s of sessions) {
        if (s === null || typeof s !== 'object') continue
        const id = typeof s.id === 'string' ? s.id : null
        if (id !== null && (activeTurns.get(id) ?? 0) > 0) thinking = true
      }
      sessionThink = thinking
    } catch {
      // 列表异常：保留上次值
    }
  }
  // 每会话活动快照（/sessions 端点）：事件视图为主，sessions 列表兜底——
  // 未在事件流出现的会话（如插件加载前已存在）用列表事件日志补标题、
  // header.createdAt 补 since；列表缺席时只返回事件视图（宠物照常跑）。
  // 列表可用时清理由已结束会话（不再出现在列表）的视图——"会话结束后框消失"。
  const sessionsSnapshot = () => {
    if (sessionsSvc !== undefined && typeof sessionsSvc.list === 'function') {
      try {
        const live = new Set()
        for (const s of sessionsSvc.list()) {
          if (s === null || typeof s !== 'object') continue
          const id = typeof s.id === 'string' ? s.id : null
          if (id === null) continue
          live.add(id)
          const since = typeof s.header?.createdAt === 'number' ? s.header.createdAt : Date.now()
          const title = resolveSessionTitle(s)
          const known = sessionViews.get(id)
          if (known === undefined) {
            sessionViews.set(id, { id, title, activity: 'done', since })
          } else if (known.title === null && title !== null) {
            // 已知会话也补标题（重启后标题服务能拿到、事件流看不到的场景）。
            sessionViews.set(id, { ...known, title })
          }
        }
        for (const id of sessionViews.keys()) {
          if (!live.has(id)) sessionViews.delete(id)
        }
      } catch {
        // 列表异常：保持事件视图
      }
    }
    return [...sessionViews.values()]
  }

  // ---- pet 服务信号（开放性窄缝，供其他插件 ctx.pet.onSignal 订阅）----
  // 账本信号：celebrate（任务完成/升级）、levelUp（升级）、failure（失败）、session（新会话/续接）。
  // 订阅者回调 (signal, payload)；订阅者异常隔离（不影响宠物本体）。
  const signals = createSignals()
  const emitSignal = signals.emit

  // 派生活动 + 事件记账（积累）：完成 +XP/称号/回忆；失败计数；工作态累加活跃时长。
  const activity = () => {
    const now = Date.now()
    const tasks = collectTasks(ctx)
    const derived = deriveActivity({ tasks, nowMs: now, known, wasWorking, errorMs: configRef.errorMs })
    wasWorking = derived.wasWorking
    // 账本记账（+XP/失败计数/回忆）已迁入 ctx.jobs.events 订阅（任务终态事件）驱动——
    // 页面关闭/轮询缺席时任务终态不漏记；此处只保留展示（working/burst）与活跃时长。
    if (derived.working) {
      state = recordActive(state, now - lastActiveCheck, now).state
      scheduleSave()
    }
    lastActiveCheck = now
    // 任务失败与请求错误同一负面窗口：error(ERROR_MS) → disappointed(尾段 DISAPPOINTED_MS)。
    // 窗口取 max：同一窗口内多次失败/错误只延长不缩短（越挫越勇不因并发被吞）。
    if (derived.burst?.name === 'error') {
      errorUntil = Math.max(errorUntil, derived.burst.until)
      disappointedUntil = Math.max(disappointedUntil, derived.burst.until + configRef.disappointedMs)
    }
    // burst 级联：welcome > error > disappointed > celebrate > working > idle。
    // welcome 不打断进行中的 error/disappointed 尾段（失败失落不该被新会话欢迎盖掉）。
    // celebrate 双源同窗：轮询翻转（derived.burst）与事件记账（celebrateUntil，F3）
    // 由 mergeCelebrate 取 max——页面关闭期间完成的任务（轮询缺席）重开后同样庆祝；
    // error burst 优先，并发完成不盖掉失败。
    let name = derived.working ? 'working' : 'idle'
    let until = 0
    const burst = mergeCelebrate(derived.burst, celebrateUntil, now)
    if (burst !== null && burst.until > now) {
      name = burst.name
      until = burst.until
    }
    if (disappointedUntil > now) {
      name = 'disappointed'
      until = disappointedUntil
    }
    if (errorUntil > now) {
      name = 'error'
      until = errorUntil
    }
    if (welcomeUntil > now && errorUntil <= now && disappointedUntil <= now) {
      name = 'welcome'
      until = welcomeUntil
    }
    // 绝对截止时间使 /state 成为非消费式快照：Web 与外部伴侣可同时观察同一回合完成。
    return {
      name,
      until,
      sessionThink,
      sessionWait,
      ...turnCompletionSnapshot(turnCompletedUntil, now),
    }
  }

  // webServer 可选（headless 无 web 服务器）：有则注册 state/interact/config/assets/events
  // 路由，无则降级为无 UI 工具插件。client 经官方 client-modules 挂载（__ModuleLoader__
  // 通道），不再由 entry 注入页面（0811 bundle 形态）。
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined

  // ---- 版本与更新（可选能力）--------------------------------------------------
  // 「更新」由宿主的 profile 包管理服务执行（拿 profile 写锁、跑 pnpm、失败时回滚 manifest 与
  // 锁文件），插件自己不碰 profile 文件；宿主不提供该服务时这一行仍显示当前版本，只是没有可执行
  // 的更新动作。已安装提交取自 profile 锁文件——git 安装下包的 package.json 版本号不随提交变化，
  // 只有锁文件知道装的是哪个提交。
  const SELF = readSelfManifest()
  // 每次用时再取：插件比包管理服务先起时，不该把这一行永久钉在「不支持」上。
  const managerOf = () => (typeof ctx.get === 'function' ? ctx.get('pluginManager') : undefined)
  const profileDir = (() => {
    const context = typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined
    if (context !== undefined && typeof context.dir === 'string' && context.dir !== '') return context.dir
    const fromEnvironment = process.env.DSH_PROFILE_DIR
    if (typeof fromEnvironment === 'string' && fromEnvironment !== '') return fromEnvironment
    // 兜底：<dshHome>/profiles/<profile>（宿主给子进程设了这两个变量，插件本来就用 DSH_HOME 存状态）。
    const name = process.env.DSH_PROFILE
    return typeof name === 'string' && name !== '' ? join(DSH_HOME, 'profiles', name) : undefined
  })()
  // 更新能力的宿主侧实现（读来源/锁文件、查上游、走包管理服务执行）在 src/update-host.mjs，
  // 这里只把 cordis 服务与网络接进去；那边的状态编排与 .git 布局解析由 tests/update-host.test.mjs 覆盖。
  const updateHost = createUpdateHost({
    self: SELF,
    profileDir,
    managerOf,
    fetchJson: (url, accept) => fetchJson(url, accept, SELF),
  })

  ctx.effect(() => {
    const disposers = [
      // pet 服务（开放性窄缝）：只读快照 + 信号订阅。其他插件 inject ['whale-girl.pet']
      // 消费；服务缺席时消费方应容忍（whale-girl 自己处理 sessions 缺席即先例）。
      // 命名带 whale-girl 前缀避免与第三方插件的通用服务名（如 'pet'）撞名——
      // cordis 同 scope 同名服务直接抛 "service ... has been registered"（见
      // 2026-08-15-pet-service-namespace 决策记录）。
      // 不暴露任何写面（账本语义由 whale-girl 独占，防第三方破坏积累不变量）。
      ctx.provide('whale-girl.pet', {
        snapshot: () => ({ pet: state, activity: activity() }),
        onSignal: (fn) => signals.subscribe(fn),
      }),
      // 事件驱动记账（F1）：任务终态恰回调一次，与浏览器轮询解耦——
      // GUI 关闭期间完成/失败的任务也入账（此前靠轮询观察 running 翻转，漏记窗口大）。
      // killed（用户取消）中性：不计 XP、不记失败、不写回忆（F4 语义）。
      // 订阅面 owners:'all'：注册上下文不落在任何 agent scope 内，覆盖全部 owner（与
      // 按 owner 分域的订阅相反——宠物账本是全局积累，不随会话隔离）。
      ctx.jobs.events.subscribe({ owners: 'all' }, (event) => {
        if (event.type !== 'settled') return // 注册/进度/停止/移除不记账
        const snapshot = event.job
        const now = Date.now()
        if (snapshot.status === 'completed') {
          const result = recordTaskCompleted(state, snapshot.label ?? '未命名任务', now)
          state = result.state
          // F3：账本与庆祝同源——记账即开庆祝窗口。页面关闭期间完成任务（轮询缺席、
          // deriveActivity 看不到翻转）时，重开后首次轮询仍能看到本窗口，同样庆祝；
          // 与轮询翻转的 celebrate 取 max 不叠加（CELEBRATE_MS 同 BURST_MS）。
          celebrateUntil = Math.max(celebrateUntil, now + configRef.celebrateMs)
          scheduleSave()
          emitSignal('celebrate', { label: snapshot.label ?? '未命名任务', level: state.level })
          if (result.leveledUp) emitSignal('levelUp', { level: state.level })
        } else if (snapshot.status === 'failed') {
          state = recordFailure(state, now).state
          scheduleSave()
          emitSignal('failure', { level: state.level })
        }
        // 会话记忆写入①（开关门控）：任务 settle 按 owner 精确归属到会话；
        // 无属主（插件自起任务等）退回「最近活跃会话」，两者皆无则跳过——不猜归属。
        if ((snapshot.status === 'completed' || snapshot.status === 'failed') && memoryEnabled()) {
          const owner = typeof snapshot.owner === 'string' && snapshot.owner !== '' ? snapshot.owner : lastSessionId
          const mem = ensureMemory()
          if (mem !== null && owner !== null) {
            memory = recordTask(mem, owner, {
              label: snapshot.label ?? '未命名任务',
              ok: snapshot.status === 'completed',
              at: now,
            })
            scheduleMemorySave()
          }
        }
        broadcastEvent() // 任务终态 → 即时告知 client（庆祝/失落的窗口即刻生效）
      }),
      ctx.on('agent/request-error', () => {
        // 请求错误（LLM API 抖动，重试后可能成功）只触发 error/disappointed 情绪，
        // 不记入 stats.failures / 回忆——「任务失败」计数只认任务状态翻转（deriveActivity），
        // 避免一次坏任务多次请求错误刷出「越挫越勇」称号、回忆里出现虚假的「任务失败」。
        // 窗口与任务失败统一：error(ERROR_MS) → disappointed(尾段)。
        const now = Date.now()
        errorUntil = Math.max(errorUntil, now + configRef.errorMs)
        disappointedUntil = Math.max(disappointedUntil, now + configRef.errorMs + configRef.disappointedMs)
        broadcastEvent() // 请求错误 → 惊吓窗口即刻生效
      }),
      // agent/created：agent 发布（含新会话 startup 与续接 resume/clear/compact）时发出，
      // payload.agent 是本次发布的 agent。
      ctx.on('agent/created', (payload) => {
        const now = Date.now()
        // source 区分新会话（startup）与续接/延续（resume/compact/clear）——XP 不同：
        // 新会话 +5 + 计数 + welcome；续接 +2 不计数不 welcome（避免切换即欢迎的噪音）。
        if (payload.source === 'startup') {
          state = recordSession(state, now).state
          welcomeUntil = now + configRef.welcomeMs
          emitSignal('session', { kind: 'new', level: state.level })
        } else {
          state = recordSessionResume(state, now).state
          emitSignal('session', { kind: 'resume', level: state.level })
        }
        // 会话记忆回读（开关门控）：agent/created 是 resume/fork/startup 边沿——
        // 先登记本会话血缘（fork 的 child 在此挂上 parent 链），再沿链找最近一条有
        // 任务记录的会话；命中即生成 memoryRecall 随 /state 窗口下发（客户端按 at
        // 去重播报一次气泡）。链断/无记录 → null，客户端不播报。
        // subagent 子会话（header.origin === 'subagent'）照常登记、但不生成回读快照
        // （recallable 契约）——否则每次 subagent spawn 都会误播重逢气泡。
        if (memoryEnabled()) {
          const live = typeof payload.agent?.session === 'object' && payload.agent.session !== null
            ? payload.agent.session
            : null
          const sid = typeof live?.id === 'string' ? live.id : null
          if (sid !== null) {
            const parent = typeof live?.header?.parentSession === 'string' ? live.header.parentSession : null
            const mem = ensureMemory()
            if (mem !== null) {
              memory = observeSession(mem, { id: sid, parent, title: null, at: now })
              if (recallable(live?.header)) {
                const found = memoryFor(memory, sid)
                memoryRecall = memorySnapshot(found, now)
              }
              scheduleMemorySave()
            }
          }
        }
        scheduleSave()
        broadcastEvent() // 会话启动/续接 → welcome 或账本更新即刻下发
      }),
      // 会话事件（v8 会话感知）：跟踪 turn/start · turn/end 边沿驱动 think 陪伴与回合完成庆祝。
      // 无条件注册（不随 sessionsSvc 缺席而丢）：回合完成窗口只依赖事件本身；
      // sessionThink 聚合（sessionUpdate）在 sessions 服务缺席时降级保持上次值（宠物照常跑）。
      ctx.on('session/event', (session, event) => {
        const id = typeof session?.id === 'string' ? session.id : null
        if (id === null) return
        // 每会话活动账本（/sessions 端点数据源）：turn/start → thinking、
        // tool/call → tool:<name>、turn/end（blocked → waiting / 其余 → done）、
        // session/title → 标题。会话未出现在事件流时在 /sessions 兜底
        // （titleFromLog 从列表 meta/事件日志取标题，since 取 header.createdAt）。
        const known = sessionViews.get(id)
        const since = known?.since ?? (typeof session?.header?.createdAt === 'number' ? session.header.createdAt : Date.now())
        const base = known ?? { ...createSessionView(id, since), title: resolveSessionTitle(session) }
        const view = applySessionView(base, event)
        if (known === undefined || view !== known) sessionViews.set(id, view)
        lastSessionId = id
        // 会话记忆写入②（开关门控）：首次见到该会话时登记血缘（header.parentSession）
        // 与标题——fork 的 child 靠这条 parent 链回读祖先任务；标题变化时同步补登。
        if (memoryEnabled()) {
          const parent = typeof session?.header?.parentSession === 'string' ? session.header.parentSession : null
          if (known === undefined || (view.title !== null && view.title !== known.title)) {
            const mem = ensureMemory()
            if (mem !== null) {
              memory = observeSession(mem, { id, parent, title: view.title, at: Date.now() })
              scheduleMemorySave()
            }
          }
        }
        const parsed = parseTurnEvent(event)
        if (parsed === null) return
        if (parsed.kind === 'start') {
          activeTurns.set(id, (activeTurns.get(id) ?? 0) + 1)
          sessionWait = false // 新回合开始，不再处于等待批准
          sessionUpdate()
        } else {
          const n = (activeTurns.get(id) ?? 0) - 1
          if (n <= 0) activeTurns.delete(id)
          else activeTurns.set(id, n)
          turnCompletedUntil = Math.max(turnCompletedUntil, Date.now() + TURN_COMPLETED_MS)
          sessionWait = parsed.blocked // turn/end 的 reason 属等待用户（approval 等）
          sessionUpdate()
        }
        broadcastEvent() // turn 边沿 → think 陪伴/回合完成庆祝即刻下发（不等 pollMs 轮询）
      }),
      
      
      
      // webServer 服务存在时（web 模式）：注册 state/interact/config/assets/ui 路由 + 页面注入。
      ...(webServer !== undefined ? [
      webServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              json(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
              return
            }
            // 轮询端点：禁缓存，防止启发式缓存读到冻结状态。
            // 先跑 activity()（有记账副作用），再读 state——响应里的 pet 才是记账后的值。
            const act = activity()
            json(res, 200, {
              apiVersion: SNAPSHOT_API_VERSION,
              pet: state,
              activity: act,
              configRevision,
              companionOnline: companionOnline(companionUntil, Date.now()),
              // 会话记忆回读（开关 + 双窗口门控）：仅 MEMORY_WINDOW_MS 内随 /state
              // 下发（客户端按 at 去重播一次气泡）；关开关即刻撤下（syncMemoryConfig 清空）。
              ...(configRef.sessionMemory && memoryRecall !== null && Date.now() - memoryRecall.at <= MEMORY_WINDOW_MS
                ? { memory: memoryRecall }
                : {}),
            }, { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: CONFIG_PATH,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              json(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
              return
            }
            // 只读配置端点：返回解析后的体验层配置（客户端按 configRevision 拉取）。
            // 写路径只有用户设置（settings 服务/文件）——插件不自建写面。
            json(res, 200, { config: configRef, revision: configRevision }, { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      // 版本与更新端点：GET 只读检查（卡片挂载时拉一次；要出网，同样挡跨源，免得别的页面刷上游配额），
      // POST 执行更新（写动作）。两者沿用 /interact 的跨源判据（sec-fetch-site / origin 对 host）。
      webServer.register({
        kind: 'exact',
        path: UPDATE_PATH,
        handler: async (req, res) => {
          try {
            if (req.method === 'GET' || req.method === 'POST') {
              if (isCrossOrigin(req.headers, req.headers.host)) {
                json(res, 403, { error: 'cross-origin request rejected' })
                return
              }
              json(res, 200, req.method === 'GET' ? await updateHost.status() : await updateHost.apply(), { 'cache-control': 'no-store' })
              return
            }
            json(res, 405, { error: 'method not allowed; use GET or POST' }, { allow: 'GET, POST' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: INTERACT_PATH,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
              return
            }
            // CSRF 面：跨源请求拒绝（恶意网页不能喂宠物/刷互动）。
            if (isCrossOrigin(req.headers, req.headers.host)) {
              json(res, 403, { error: 'cross-origin request rejected' })
              return
            }
            const raw = await readBody(req)
            if (raw === null) {
              json(res, 413, { error: 'request body too large' })
              return
            }
            let body
            try {
              body = JSON.parse(raw || '{}')
            } catch {
              json(res, 400, { error: 'invalid JSON body' })
              return
            }
            if (typeof body !== 'object' || body === null || Array.isArray(body)) {
              json(res, 400, { error: 'body must be a JSON object' })
              return
            }
            const result = applyAction(state, body.action, configRef.replies)
            json(res, result.status, result.body, { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      // ---- 桌面伴侣在场心跳（显示层写面）：桌面端周期性续命，退出/崩溃后 TTL 过期 ----
      // 在场期间网页端宠物隐藏（/state 的 companionOnline），避免双宠物；无账本语义，
      // 与 /interact 同级安全面（跨源校验 + body 上限）。见 src/presence.mjs 契约。
      webServer.register({
        kind: 'exact',
        path: PRESENCE_PATH,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
              return
            }
            if (isCrossOrigin(req.headers, req.headers.host)) {
              json(res, 403, { error: 'cross-origin request rejected' })
              return
            }
            const raw = await readBody(req)
            if (raw === null) {
              json(res, 413, { error: 'request body too large' })
              return
            }
            let body
            try {
              body = JSON.parse(raw || '{}')
            } catch {
              json(res, 400, { error: 'invalid JSON body' })
              return
            }
            if (body === null || typeof body !== 'object' || Array.isArray(body)) {
              json(res, 400, { error: 'body must be a JSON object' })
              return
            }
            // online 缺省视为上线（裸 {} 即可续命）；false 显式下线（桌面端退出时即时恢复网页端）。
            const online = body.online !== false
            companionUntil = pokePresence(companionUntil, Date.now(), online)
            json(res, 200, { online: companionOnline(companionUntil, Date.now()) }, { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      // ---- 每会话活动（/sessions 端点）----
      // 外部消费者（桌面伴侣的消息框）按会话读取活动：thinking / tool:<name> /
      // waiting / done。数据源是 session/event 事件流（sessionViews 账本），
      // sessions 列表兜底补标题与开始时间；禁缓存（活动随事件实时变化）。
      webServer.register({
        kind: 'exact',
        path: SESSIONS_PATH,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              json(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
              return
            }
            json(res, 200, sessionsSnapshot(), { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      webServer.register({
        kind: 'prefix',
        path: ASSETS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          let pathname
          try {
            pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.internal').pathname)
          } catch {
            res.writeHead(400)
            res.end()
            return
          }
          const rel = sanitizeAssetPath(pathname)
          if (rel === null) {
            res.writeHead(403)
            res.end()
            return
          }
          try {
            const data = readFileSync(join(import.meta.dirname, 'assets', rel))
            // immutable 长期缓存：素材路径含角色 id（/assets/characters/<id>/…）且随包分发，
            // 内容不可变。发布契约：改图必须改文件名或角色 id——immutable 会滞留「同名
            // 被替换」的旧图（替代原 no-cache 的「替换同名 sheet 须重新校验」防线）。
            res.writeHead(200, { 'content-type': contentTypeFor(rel), 'cache-control': 'public, max-age=31536000, immutable' })
            res.end(data)
          } catch {
            res.writeHead(404)
            res.end()
          }
        },
      }),
      // ---- SSE 事件流（v9）：事件即时下发通道 ----
      // client 用 EventSource 订阅；收到事件即 refresh() 拉最新 /state（延迟从 pollMs
      // 降到单次往返）。心跳 25s 注释行防代理/网关空闲断开；close 清理连接与心跳。
      // 广播失败（断连）由 broadcastEvent 的 try/catch 移除连接，不阻塞事件处理。
      webServer.register({
        kind: 'exact',
        path: EVENTS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405)
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })
          if (typeof res.flushHeaders === 'function') res.flushHeaders()
          res.write('retry: 3000\n\n')
          sseClients.add(res)
          let heartbeat = null
          if (typeof res.on === 'function') {
            res.on('close', () => {
              clearInterval(heartbeat)
              sseClients.delete(res)
            })
          }
          heartbeat = setInterval(() => {
            try { res.write(': ping\n\n') } catch { /* 断连由 close 清理 */ }
          }, 25000)
        },
      }),
      ] : []),
    ]
    return () => {
      clearTimeout(saveTimer)
      saveState(state) // 末次落盘：disable/卸载前保留最终状态
      // 会话记忆末次落盘（memory 仅在开关开启时非 null——关=零写，天然不落盘）。
      clearTimeout(memorySaveTimer)
      if (memory !== null) saveSessionMemory(memory)
      for (const dispose of disposers) dispose()
    }
  }, 'whale-girl: state/interact/config/assets/ui routes + events')
}
