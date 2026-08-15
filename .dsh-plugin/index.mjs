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
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import {
  INITIAL_STATE, recordTaskCompleted, recordFailure, recordSession, recordSessionResume, recordActive,
} from './src/pet-state.mjs'
import { deriveActivity, mergeCelebrate } from './src/activity.mjs'
import { sanitizeAssetPath, contentTypeFor, ASSETS_PATH } from './src/assets.mjs'
import { applyAction, isCrossOrigin } from './src/interact.mjs'
import { parseTurnEvent } from './src/session-events.mjs'
import { createSessionView, applySessionView, titleFromLog } from './src/sessions.mjs'
import { normalizeState, serializeState } from './src/persistence.mjs'
import { createSignals } from './src/signals.mjs'
import { NAMESPACE, DEFAULTS, buildSchema, validateConfig } from './src/config.mjs'

export const name = 'whale-girl'
export const inject = ['jobs', 'agents', 'sessions', 'settings', 'webServer']
// 路由端点 re-export（来源 src/routes.mjs；保持既有导出面）。
import { STATE_PATH, INTERACT_PATH, CONFIG_PATH, ROUTE_PREFIX, EVENTS_PATH, SESSIONS_PATH } from './src/routes.mjs'
export { STATE_PATH, INTERACT_PATH, CONFIG_PATH, ROUTE_PREFIX, EVENTS_PATH, SESSIONS_PATH }
/** /interact 请求体大小上限（动作只需几字节）。 */
export const BODY_LIMIT = 1024

// 瞬发窗口时长现由配置（L1 体验层）提供：errorMs/disappointedMs/welcomeMs/celebrateMs，
// 见 src/config.mjs 的 DEFAULTS。消费处统一读 configRef，不再用模块级常量（防双源漂移）。
// 默认值：error 4s → disappointed 6s（总负面 10s，任务失败与请求错误统一）；欢迎 6s；庆祝 6s
// （与 deriveActivity 的 BURST_MS 同长：事件路径与轮询路径取 max 不叠加延长）。

/** 状态文件：<dshHome>/data/whale-girl/state.json（不放插件目录——uninstall 会删）。 */
const DSH_HOME = process.env.DSH_HOME ?? resolve(import.meta.dirname, '../../..')
const STATE_FILE = join(DSH_HOME, 'data', 'whale-girl', 'state.json')

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

/** 收集宿主全部任务：owned（按 agent 遍历，绕过 owner fence）+ unowned，按 id 去重。 */
function collectTasks(ctx) {
  const jobs = ctx.jobs
  const seen = new Set()
  const out = []
  for (const agent of ctx.agents.list()) {
    for (const snapshot of jobs.list(agent)) {
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

export function apply(ctx) {
  let state = loadState() ?? { ...INITIAL_STATE, updatedAt: Date.now() }
  // 配置（L1 体验层）：settings 服务条件接入——web 组合有 provider，CLI/headless
  // 可能缺失；缺失时回退 DEFAULTS（插件照常跑，只是无用户配置面）。
  // configRef 是消费端唯一读取面（Node half 的窗口时长等）；configRevision 随
  // /state 下发，客户端以此门控「配置变化才重应用」。
  let configRef = { ...DEFAULTS }
  let configRevision = 0
  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  const applyConfig = (next) => {
    configRef = next
    configRevision += 1
  }
  if (settings !== undefined && typeof settings.register === 'function') {
    try {
      const scope = settings.register(NAMESPACE, buildSchema(), { applies: 'live', validate: validateConfig })
      applyConfig(scope.get())
      scope.watch((next) => applyConfig(next))
    } catch {
      // register 失败（如重复注册）→ 保持 DEFAULTS
    }
  }
  // 落盘防抖：事件记账时触发（任务完成/失败/会话/活跃时长）。
  let saveTimer = null
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveState(state), 1000)
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

  // ---- 会话状态聚合（v8：官方自渲染 client 无 ctx.sessions——Node half 聚合进 /state）----
  // client 自执行脚本 `apply({})` 拿不到宿主 sessions 服务（官方注入面只给 __DSH_BOOT__），
  // 会话感知（think 陪伴/等待批准/回合完成）改由 Node half 经 `ctx.sessions` 推导后随 /state
  // 轮询下发。信号源：
  // - 思考中（sessionThink）：任一会话处于 turn 之间（有 turn/start 未 turn/end）或已开始未结束
  // - 等待批准（sessionWait）：turn/end 的 reason.kind === 'blocked'（等待用户批准/权限）
  // - 回合完成（turnCompleted）：turn/end 边沿（每完成一个 turn 触发一次庆祝）
  const sessionsSvc = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
  // 会话标题权威源（dsh-session-title）：重启后历史 session/title 事件不可见，
  // 靠该服务补全（get(session)?.title）。缺席时退回事件日志标题。
  const sessionTitleSvc = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : undefined
  let sessionThink = false
  let sessionWait = false
  let turnCompleted = false // 单轮翻转标志：activity() 消费后复位
  const activeTurns = new Map() // sessionId → turn/start 未 turn/end 计数
  // 每会话活动账本（/sessions 端点）：sessionId → { id, title, activity, since }。
  // 事件驱动更新（session/event 回调）；sessions 服务缺席时降级为仅事件视图。
  const sessionViews = new Map()
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
    // 账本记账（+XP/失败计数/回忆）已迁入 ctx.jobs.onJobDone 事件驱动——
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
    // 会话状态随 /state 下发（client 从轮询读，不再直接订阅 sessions）；turnCompleted 单轮消费。
    const tc = turnCompleted
    turnCompleted = false
    return { name, until, sessionThink, sessionWait, turnCompleted: tc }
  }

  // webServer 可选（headless 无 web 服务器）：有则注册 state/interact/config/assets/events
  // 路由，无则降级为无 UI 工具插件。client 经官方 client-modules 挂载（__ModuleLoader__
  // 通道），不再由 entry 注入页面（0811 bundle 形态）。
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  ctx.effect(() => {
    const disposers = [
      // pet 服务（开放性窄缝）：只读快照 + 信号订阅。其他插件 inject ['pet']
      // 消费；服务缺席时消费方应容忍（whale-girl 自己处理 sessions 缺席即先例）。
      // 不暴露任何写面（账本语义由 whale-girl 独占，防第三方破坏积累不变量）。
      ctx.provide('pet', {
        snapshot: () => ({ pet: state, activity: activity() }),
        onSignal: (fn) => signals.subscribe(fn),
      }),
      // 事件驱动记账（F1）：任务终态恰回调一次，与浏览器轮询解耦——
      // GUI 关闭期间完成/失败的任务也入账（此前靠轮询观察 running 翻转，漏记窗口大）。
      // killed（用户取消）中性：不计 XP、不记失败、不写回忆（F4 语义）。
      ctx.jobs.onJobDone((snapshot) => {
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
      ctx.on('agent/session-start', (payload) => {
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
        scheduleSave()
        broadcastEvent() // 会话启动/续接 → welcome 或账本更新即刻下发
      }),
      // 会话事件（v8 会话感知）：跟踪 turn/start · turn/end 边沿驱动 think 陪伴与回合完成庆祝。
      // 无条件注册（不随 sessionsSvc 缺席而丢）：turnCompleted/celebrate 只依赖事件本身；
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
          turnCompleted = true // 每完成一个 turn 触发一次庆祝（activity() 消费）
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
            json(res, 200, { pet: state, activity: act, configRevision }, { 'cache-control': 'no-store' })
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
            // no-cache：替换同名 sheet 后浏览器须重新校验，避免旧图。
            res.writeHead(200, { 'content-type': contentTypeFor(rel), 'cache-control': 'no-cache' })
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
      for (const dispose of disposers) dispose()
    }
  }, 'whale-girl: state/interact/config/assets/ui routes + events')
}
