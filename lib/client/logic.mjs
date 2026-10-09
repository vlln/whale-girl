// client 纯逻辑：动画状态选择与表情映射（无 DOM 引用，可脱离浏览器单测）。
// 契约：pickState 输入 { activity, pet, dragging, transient, sleeping, joyUntil, now,
//   sessionThink, sessionWait, workingActive, celebrateUntil }，返回动画状态名；
//   pet 不再驱动状态（零负反馈——无 hunger/mood 属性状态）。
// 状态优先级由 STATE_TABLE 声明（顺序即优先级，文法单源——加状态/调优先级只改此表，
// 不再散落 if 链）；Node half 的窗口级联仍输出 { name, until }（burst 权威，两半分工：
// Node 出事实窗口、client 出本地交互选择）。
// drag/burst/transient 都是临时覆盖；窗口结束后重新计算底层派生状态，不硬编码回 idle。
// transient 由宿主计时（TRANSIENT_MS 超时兜底），本模块只做选择；burst 由 activity.until 窗口决定。
// 会话感知（P2 思考态）：sessionThink/sessionWait 由 host sessions 服务聚合（见 deriveSessionMood），
// 是持续陪伴底座——任一会话活跃时宠物保持清醒陪伴（覆盖 sleep/walk），低于用户互动与事件反馈。
// 行为节奏（v3）：working 不是任务状态指示灯，而是 client 节奏器随机插入的工作插曲
// （workingActive 由宿主随机调度：偶尔、随机时长），think 是思考陪伴的常态；
// 回合完成（session running→completed 翻转）由宿主经 celebrateUntil 本地窗口播庆祝，
// 与 Node 的任务完成 celebrate（activity burst）并列、优先级更低。

export const TRANSIENT_MS = 1500
// wake 是从长时间休眠回来的过渡，不与短促的 eat/play 互动共用时长；
// 非循环 wake sheet 播完后保持末帧，直到 WAKE_MS 到期。
export const WAKE_MS = 3000
export const JOY_MS = 1600
// 回合完成庆祝窗口（client 本地）：session running→completed 翻转后播 celebrate 的时长。
export { TURN_COMPLETED_MS as ROUND_CELEBRATE_MS } from '../src/snapshot.mjs'

// 状态名权威集合（15 状态，全角色必填素材——缺 sheet 不再 emoji 降级）。
// 来源：docs/sprites-spec.md 状态总表；verify-spec-states 门禁校验三者一致：
// spec 总表 ↔ 本集合 ↔ STATE_TABLE 行（含 burst 的 resolve 值）。
export const STATE_NAMES = Object.freeze([
  'idle', 'working', 'celebrate', 'error', 'disappointed', 'joy', 'eat', 'play',
  'drag', 'walk', 'sleep', 'wake', 'welcome', 'think', 'wait',
])

// 帧播放模式（manifest 每状态必填；播放器按此推进帧，不再按状态名特判）。
// - loop：正向循环 0→1→…→N-1→0（帧0=常态起点）
// - pingpong：往返 0→1→…→N-1→…→0（帧0/末帧为两端姿态，对称）
// - once：播完保持末帧（帧0=起点、末帧=完成态；配 motion 可叠加持续表现）
// - blink：常态帧0静止 + 随机间隔触发一次动作播完回帧0（帧0=常态、1..N-1=动作过程）
export const PLAYBACK_MODES = Object.freeze(['loop', 'pingpong', 'once', 'blink'])
// 各播放模式对帧数的约束（verify-assets 交叉校验）。
export const PLAYBACK_MIN_FRAMES = Object.freeze({
  loop: 1, pingpong: 2, once: 1, blink: 2,
})

/**
 * 状态优先级表（文法单源）。行序即优先级：首行命中即返回。
 * - `when`：命中谓词（输入上下文）。
 * - `resolve`：命中时返回的状态名（多数恒等于 state；burst 需取 activity.name）。
 * 注意：状态名必须都在 STATE_NAMES 权威集合（verify-spec-states 门禁校验
 * spec 总表 ↔ STATE_NAMES ↔ STATE_TABLE 行序）。
 */
export const STATE_TABLE = [
  { state: 'drag', when: (c) => c.dragging },
  // 拖拽放下缓冲：drag 结束短暂回 idle（1.5s），再进入底层状态——避免放下即跳 think/working 的生硬切换。
  // 睡着被拖起时让位 wake：wake 是「被拖起来」的醒觉过渡，直接播（不先 idle 缓冲）；
  // wake 行仍低于 burst/eat/play（事件反馈优先，见 wake 行注释）。
  { state: 'idle', when: (c) => c.dragReleaseUntil > c.now && c.transient !== 'wake' },
  // 事件 burst（welcome/celebrate/error/disappointed）：Node half 窗口级联输出，until 有效期内优先。
  { state: 'burst', when: (c) => c.activity.name !== 'idle' && c.activity.name !== 'working' && c.activity.until > c.now, resolve: (c) => c.activity.name },
  { state: 'eat', when: (c) => c.transient === 'eat' },
  { state: 'play', when: (c) => c.transient === 'play' },
  { state: 'wake', when: (c) => c.transient === 'wake' },
  { state: 'wait', when: (c) => c.sessionWait },
  // 回合完成庆祝（client 本地窗口）：session running→completed 翻转后庆祝——
  // 低于 Node 事件 burst（任务完成的 celebrate 仍走 burst 行）、用户互动与等待批准
  // （wait 需要用户注意），高于陪伴——庆祝是短时插曲，不打断互动反馈。
  { state: 'celebrate', when: (c) => c.celebrateUntil > c.now },
  // working 是随机工作插曲：client 节奏器在思考陪伴期间偶尔插入（workingActive），
  // 不是任务状态指示灯——think 是常态，working 是「认真干活」的短时小动作。
  { state: 'working', when: (c) => c.workingActive },
  { state: 'think', when: (c) => c.sessionThink },
  { state: 'joy', when: (c) => c.now < c.joyUntil },
  { state: 'sleep', when: (c) => c.sleeping },
  { state: 'walk', when: (c) => c.walking },
  { state: 'idle', when: () => true },
]

/** 选择当前应播放的动画状态名（now 显式传入，测试确定性；遍历 STATE_TABLE 首个命中）。 */
export function pickState(input) {
  const ctx = {
    ...input,
    now: input.now ?? Date.now(),
    joyUntil: input.joyUntil ?? 0,
    sessionThink: input.sessionThink ?? false,
    sessionWait: input.sessionWait ?? false,
    dragReleaseUntil: input.dragReleaseUntil ?? 0,
    workingActive: input.workingActive ?? false,
    celebrateUntil: input.celebrateUntil ?? 0,
  }
  for (const row of STATE_TABLE) {
    if (row.when(ctx)) return row.resolve ? row.resolve(ctx) : row.state
  }
  return 'idle'
}

/**
 * 从 host sessions 服务快照聚合「陪伴」信号（多会话：任一活跃会话都算——
 * 宠物陪伴整个 GUI，不只当前会话；当前会话由宿主 current 标出，消费方自行区分）。
 * 输入快照形状（host sessions 契约）：{ byId: { [id]: { displayTitle, running,
 * pendingInteraction, completed } }, current }。仅读字段，无副作用。
 * @returns {{ thinking: boolean, waiting: boolean, titles: string[] }} thinking=任一会话运行中；
 *   waiting=任一会话等待用户交互（approval/plan-review/question）；titles=运行中会话的展示标题。
 */
export function deriveSessionMood(snapshot) {
  const byId = snapshot?.byId ?? {}
  let thinking = false
  let waiting = false
  const titles = []
  for (const id of Object.keys(byId)) {
    const s = byId[id]
    if (s === undefined || s === null) continue
    if (s.running === true) {
      thinking = true
      titles.push(s.displayTitle ?? id)
    }
    if (s.pendingInteraction !== undefined) waiting = true
  }
  return { thinking, waiting, titles }
}

// ---- 调度决策（v3 纯函数面）----
// 调度状态（计时器窗口/随机插曲/边沿）从 index.mjs 闭包抽出为纯函数：
// now 与随机源显式传入，输出可单测（确定性时间推进测试的落点）。
// 纪律：这些函数只做「决策」不碰 DOM/定时器；index.mjs 是薄执行层。

// working 随机插曲参数（L2 语义层，代码级，不可配——进不得 src/config.mjs）。
export const WORKING_MIN_WAIT_MS = 12000 // 插曲最小间隔（think 常态）
export const WORKING_MAX_WAIT_MS = 30000 // 插曲最大间隔
export const WORKING_MIN_DUR_MS = 2500   // 插曲最短时长
export const WORKING_MAX_DUR_MS = 6000   // 插曲最长时长

// idle 随机眨眼参数（L2 语义层，代码级）：常态保持帧 0（睁眼），随机间隔眨一次。
export const BLINK_MIN_INTERVAL_MS = 3000 // 眨眼最小间隔
export const BLINK_MAX_INTERVAL_MS = 9000 // 眨眼最大间隔

// 随机朝向转换参数（L2 语义层，代码级）：静态陪伴态（idle/think/wait）偶尔转身。
export const FACING_MIN_INTERVAL_MS = 10000 // 转身最小间隔
export const FACING_MAX_INTERVAL_MS = 25000 // 转身最大间隔

/**
 * idle 随机眨眼决策：常态睁眼静止，随机间隔触发一次眨眼（帧 0→1→2→0）。
 * @param {object} input
 * @param {number} input.now 当前时刻
 * @param {() => number} [input.random] 随机源（测试注入；默认 Math.random）
 * @returns {number} 下次眨眼触发时刻（now + 随机间隔）
 */
export function nextBlinkAt({ now, random = Math.random }) {
  const wait = BLINK_MIN_INTERVAL_MS + random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS)
  return now + wait
}

/**
 * 随机朝向转换决策：静态陪伴态（idle/think/wait）偶尔转身（flip 翻转），
 * 动作间朝向保持连续（walk/drag 的方向写入 flip 后，静态态沿用，不无谓翻转）。
 * @param {object} input
 * @param {number} input.now 当前时刻
 * @param {() => number} [input.random] 随机源（测试注入；默认 Math.random）
 * @returns {number} 下次转身触发时刻（now + 随机间隔）
 */
export function nextFacingAt({ now, random = Math.random }) {
  const wait = FACING_MIN_INTERVAL_MS + random() * (FACING_MAX_INTERVAL_MS - FACING_MIN_INTERVAL_MS)
  return now + wait
}

/**
 * working 随机插曲决策：会话思考期间偶尔插入 working 工作姿态，其余时间 think 常态。
 * @param {object} input
 * @param {number} input.now 当前时刻
 * @param {boolean} input.sessionThink 会话思考中（插曲只在该窗口内武装）
 * @param {object} input.working 当前插曲状态 { active: boolean, until: number }（宿主持有）
 * @param {() => number} [input.random] 随机源（测试注入；默认 Math.random）
 * @returns {{ active: boolean, until: number }} 新的插曲状态：active=是否进入 working，
 *   until=该状态的目标结束时刻（宿主据此设 setTimeout/tick 判断）
 */
export function nextWorkingRhythm({ now, sessionThink, working, random = Math.random }) {
  // 会话不活跃：插曲关闭，等下次思考再武装。
  if (!sessionThink) return { active: false, until: 0 }
  if (working.active) {
    // working 中：随机时长后回到 think。
    const dur = WORKING_MIN_DUR_MS + random() * (WORKING_MAX_DUR_MS - WORKING_MIN_DUR_MS)
    return { active: false, until: now + dur }
  }
  // think 中：随机间隔后插入 working（大部分时间 think，偶尔工作）。
  const wait = WORKING_MIN_WAIT_MS + random() * (WORKING_MAX_WAIT_MS - WORKING_MIN_WAIT_MS)
  return { active: true, until: now + wait }
}

/**
 * 睡醒边沿判断：上一帧显示 sleep、本帧离开 sleep（非拖拽打断、无瞬发占用）→ 播 wake。
 * @param {string} prevState 上一帧视觉状态（animState）
 * @param {string} nextState 本帧目标状态（pickState 结果）
 * @param {object} ctx { dragging, transient }
 * @returns {boolean} 是否应播 wake
 */
export function shouldWake(prevState, nextState, ctx = {}) {
  return prevState === 'sleep' && nextState !== 'sleep' && !ctx.dragging && (ctx.transient ?? null) === null
}

/**
 * 用户交互醒觉决策（v6）：拖拽/喂食/玩耍/开菜单都是用户在场信号——空闲计时从交互
 * 时刻重新起算（交互后不再「放下立即回 sleep」）；交互瞬间若宠物**视觉上处于 sleep
 * 动画**（交互开始时刻 `animState === 'sleep'`）则附加 wake 醒觉过渡。
 * 醒觉判定绑定视觉 sleep 状态，**不用 `sleeping` 派生变量**：会话活跃时（think/working
 * 优先于 sleep）视觉已离开 sleep 但 `sleeping` 仍 true（activity 还 idle）——此时交互
 * 不需要醒觉过渡（用户看到的不是睡着）。
 * @param {object} input
 * @param {boolean} input.visuallySleeping 交互开始时宠物视觉上是否处于 sleep 动画
 * @returns {{ sleeping: boolean, wake: boolean }} sleeping=交互后的睡眠标志（恒 false：
 *   空闲从交互时刻重新起算）；wake=应播 wake 醒觉过渡
 */
export function wakeFromInteraction({ visuallySleeping }) {
  return { sleeping: false, wake: visuallySleeping === true }
}

/**
 * 回合完成边沿检测（v7）：sessions 快照里 running
 * true→false 的会话——「一个 turn 结束」的可靠信号（官方快照 running 字段，
 * 含当前会话与子会话；completed 字段是「非选中会话」done 提醒语义，不可用）。
 * @param {object} snapshot sessions 快照 { byId: { [id]: { running, displayTitle } } }
 * @param {Map<string, boolean>} prevRunning 上次观察的 running 位（宿主持有）
 * @returns {{ flips: Array<{ id: string, title: string }>, prevRunning: Map<string, boolean> }}
 *   flips=本次 running→false 的会话；prevRunning=更新后的位表（宿主保存）
 */
export function detectTurnCompleted(snapshot, prevRunning) {
  const byId = snapshot?.byId ?? {}
  const nextPrev = new Map(prevRunning)
  const flips = []
  for (const id of Object.keys(byId)) {
    const s = byId[id]
    if (s === null || typeof s !== 'object') continue
    const running = s.running === true
    if (nextPrev.get(id) === true && !running) {
      flips.push({ id, title: s.displayTitle ?? id })
    }
    nextPrev.set(id, running)
  }
  // 快照缺失的会话（已删除/不再列出）：移除位表，防止重开后旧位误判
  for (const id of nextPrev.keys()) {
    if (!(id in byId)) nextPrev.delete(id)
  }
  return { flips, prevRunning: nextPrev }
}

/**
 * 会话记忆气泡文案（纯函数）：把 /state 的 memory 快照译成一句宠物台词。
 * 契约：只取最近 2 条**已完成**任务（失败不进气泡——回读是重逢的问候，不翻旧账）；
 * 标签截断 14 字防气泡横向溢出（记录侧上限 160 字，见 src/session-memory.mjs）；
 * distance > 0 表示这条记忆来自父会话（fork 回读），文案点明「分支前」；
 * 无可展示任务返回 null（客户端不播报）。
 * @param {{ distance?: number, tasks?: Array<{ label?: string, ok?: boolean }> } | null | undefined} memory
 * @returns {string | null}
 */
export function memoryLine(memory) {
  const tasks = Array.isArray(memory?.tasks) ? memory.tasks : []
  const labels = tasks
    .filter((t) => t !== null && typeof t === 'object' && t.ok !== false && typeof t.label === 'string' && t.label !== '')
    .map((t) => t.label)
  if (labels.length === 0) return null
  const clip = (s) => (s.length > 14 ? `${s.slice(0, 14)}…` : s)
  const shown = labels.slice(-2).map((l) => `「${clip(l)}」`).join('、')
  const more = labels.length > 2 ? `等 ${labels.length} 项` : ''
  const branch = (memory?.distance ?? 0) > 0 ? '上次在分支前的会话里完成了' : '上次你们完成了'
  return `${branch}${shown}${more}`
}
