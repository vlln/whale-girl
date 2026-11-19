// 积累型宠物账本：零负反馈——无衰减、无惩罚、无需求；一切向上积累。
// 契约：
// - 状态字段：level/xp（资历）、stats{tasksDone,failures,sessions,activeMs,firstSeenAt}、
//   titles（已解锁称号 id 数组）、memory（最近事件，环形，最多 MEMORY_MAX 条）、updatedAt。
// - 无 tick/衰减函数；所有变化都是事件驱动的纯函数，返回 { state, unlocked, leveledUp }，
//   不修改入参；称号由 stats 阈值派生（checkTitles 幂等）。
// - 等级 = xp 派生（xpForLevel 三角数列），禁止手写 level 字段。
// - locale 只影响写入时的文案（记忆日志）与称号显示名，不参与任何积累/阈值语义；
//   已写入的记忆是历史快照，不回溯改写（旧记录保留写入时语言，见 2026-11-19 决策记录）。
import { normalizeLocale, t, titleName as localizedTitleName } from './i18n.mjs'

export const INITIAL_STATE = Object.freeze({
  level: 1,
  xp: 0,
  stats: { tasksDone: 0, failures: 0, sessions: 0, activeMs: 0, firstSeenAt: null },
  titles: [],
  memory: [],
  locale: 'zh',
  updatedAt: 0,
})

export const MEMORY_MAX = 8
export const TASK_XP = 10
export const SESSION_XP = 5
export const RESUME_XP = 2

/** 升到 level 所需累计 xp（三角数列：L2=50，L3=150，L4=300…）。 */
export function xpForLevel(level) {
  return (50 * level * (level - 1)) / 2
}

/** levelFor 内部安全上限（4*xp/25 不得溢出成 Infinity；现实值远低于此，见 persistence XP_CAP）。 */
const XP_SAFE_MAX = 1e15

/** 由累计 xp 求等级（三角数列反函数的闭式解 O(1)；原线性 while 在巨量 xp 下可挂起宿主）。 */
export function levelFor(xp) {
  const xpSafe = Math.max(0, Math.min(xp, XP_SAFE_MAX))
  return Math.floor((1 + Math.sqrt(1 + (4 * xpSafe) / 25)) / 2)
}

/** 称号定义（封闭集合；加称号要同时改本表与 docs/growth-system.md 的成就表）。 */
export const TITLES = [
  { id: 'first-task', name: '初次协作', when: (s) => s.tasksDone >= 1 },
  { id: 'helper', name: '勤劳伙伴', when: (s) => s.tasksDone >= 20 },
  { id: 'veteran', name: '百炼成钢', when: (s) => s.tasksDone >= 100 },
  { id: 'regular', name: '常驻伙伴', when: (s) => s.activeMs >= 6 * 3_600_000 },
  { id: 'resilient', name: '越挫越勇', when: (s) => s.failures >= 5 },
  { id: 'social', name: '广结善缘', when: (s) => s.sessions >= 10 },
]

/** 称号 id → 名称（未知 id 原样返回，容忍旧数据；locale 决定显示语言，<zh> 为旧行为）。 */
export function titleName(id, locale = 'zh') {
  return localizedTitleName(id, normalizeLocale(locale))
}

function stamp(nowMs) {
  const d = new Date(nowMs)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function truncate(label, max = 14) {
  return label.length > max ? `${label.slice(0, max)}…` : label
}

function checkTitles(stats, titles) {
  return TITLES.filter((t) => !titles.includes(t.id) && t.when(stats))
}

/** 写入文案用的 locale：显式参数优先，否则沿用账本里上次的 locale（旧账本无字段 → zh）。 */
function localeOf(state, locale) {
  return normalizeLocale(locale ?? state?.locale)
}

/** 提交一次事件：应用 stats patch + 可选 xp 增益，重算等级/称号，追加回忆（locale 决定文案）。 */
function commit(state, patch, nowMs, entry, xpGain = 0, locale = undefined) {
  const stats = { ...state.stats, ...patch }
  const xp = state.xp + xpGain
  const level = levelFor(xp)
  const leveledUp = level > state.level
  const unlocked = checkTitles(stats, state.titles)
  const titles = unlocked.length ? [...state.titles, ...unlocked.map((t) => t.id)] : state.titles
  const loc = localeOf(state, locale)
  const memory = [...state.memory]
  if (entry) memory.push(`[${stamp(nowMs)}] ${entry}`)
  if (leveledUp) memory.push(`[${stamp(nowMs)}] ${t(loc, 'memory.levelUp', { level })}`)
  return {
    state: { ...state, stats, xp, level, titles, memory: memory.slice(-MEMORY_MAX), locale: loc, updatedAt: nowMs },
    unlocked: unlocked.map((t) => t.name),
    leveledUp,
  }
}

/** 任务完成：资历 +TASK_XP，记入统计与回忆（locale = 写入时 UI 语言）。 */
export function recordTaskCompleted(state, taskLabel, nowMs, locale = undefined) {
  const n = state.stats.tasksDone + 1
  const entry = t(localeOf(state, locale), 'memory.taskDone', { label: truncate(taskLabel), n })
  return commit(state, { tasksDone: n }, nowMs, entry, TASK_XP, locale)
}

/** 任务失败：只计数与回忆（不惩罚、不扣资历）。 */
export function recordFailure(state, nowMs, locale = undefined) {
  const n = state.stats.failures + 1
  return commit(state, { failures: n }, nowMs, t(localeOf(state, locale), 'memory.failure', { n }), 0, locale)
}

/** 新会话（source=startup）：资历 +SESSION_XP，记录首见时间，计入会话数。 */
export function recordSession(state, nowMs, locale = undefined) {
  const n = state.stats.sessions + 1
  return commit(
    state,
    { sessions: n, firstSeenAt: state.stats.firstSeenAt ?? nowMs },
    nowMs,
    t(localeOf(state, locale), 'memory.newSession', { n }),
    SESSION_XP,
    locale,
  )
}

/** 续接/延续（source=resume/compact/clear）：+RESUME_XP，不计会话数、不记首见（不是新会话）。 */
export function recordSessionResume(state, nowMs, locale = undefined) {
  return commit(state, {}, nowMs, t(localeOf(state, locale), 'memory.resume'), RESUME_XP, locale)
}

/** 单次活跃累加上限：机器睡眠后首轮 poll 不把整段睡眠计入（防一夜刷出「常驻伙伴」）。 */
export const ACTIVE_CAP_MS = 5 * 60_000

/** 活跃时长积累（工作态时由宿主按轮询间隔累加；单次增量封顶 ACTIVE_CAP_MS）。 */
export function recordActive(state, elapsedMs, nowMs) {
  const capped = Math.min(Math.max(0, elapsedMs), ACTIVE_CAP_MS)
  return commit(state, { activeMs: state.stats.activeMs + capped }, nowMs, null)
}
