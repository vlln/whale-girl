// 宠物账本持久化：归一化与序列化（纯函数；文件 IO 在宿主 index.mjs）。
// 契约：normalizeState(saved) 合并 INITIAL_STATE 并对数值/数组/称号做字段级容错
// （容忍手改/旧版本越界与不一致），缺失/非法返回 null（宿主回退初始态）；
// serializeState 输出 JSON 文本。
import { INITIAL_STATE, levelFor, MEMORY_MAX, TITLES } from './pet-state.mjs'
import { normalizeLocale } from './i18n.mjs'

const KNOWN_TITLES = new Set(TITLES.map((t) => t.id))

/** 手改/损坏文件的安全 xp 上限（1e12 远超现实积累；配合 levelFor 闭式解防挂起）。 */
export const XP_CAP = 1e12

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN
}

function int(v, lo = 0) {
  const n = num(v)
  return Number.isFinite(n) ? Math.max(lo, Math.floor(n)) : lo
}

/** 归一化保存的状态；非法输入返回 null。 */
export function normalizeState(saved) {
  if (typeof saved !== 'object' || saved === null) return null
  const xpRaw = num(saved.xp)
  if (!Number.isFinite(xpRaw)) return null
  // 手改/损坏文件的安全上限（1e12 远超现实积累）与整数取整。
  const xp = Math.max(0, Math.floor(Math.min(xpRaw, XP_CAP)))
  // stats 走 INITIAL_STATE 合并：未来新增字段时旧文件不静默丢失。
  const stats = {
    ...INITIAL_STATE.stats,
    tasksDone: int(saved.stats?.tasksDone),
    failures: int(saved.stats?.failures),
    sessions: int(saved.stats?.sessions),
    activeMs: num(saved.stats?.activeMs) > 0 ? saved.stats.activeMs : 0,
    firstSeenAt: num(saved.stats?.firstSeenAt) || null,
  }
  const titles = [...new Set(Array.isArray(saved.titles)
    ? saved.titles.filter((t) => typeof t === 'string' && KNOWN_TITLES.has(t))
    : [])]
  const memory = Array.isArray(saved.memory)
    ? saved.memory.filter((m) => typeof m === 'string').slice(-MEMORY_MAX)
    : []
  const updatedAt = num(saved.updatedAt)
  // level 是 xp 的派生值：以 xp 为准重算，杜绝手改不一致。
  return {
    ...INITIAL_STATE,
    xp,
    level: levelFor(xp),
    stats,
    titles,
    memory,
    locale: normalizeLocale(saved.locale),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}

/** 序列化状态为 JSON 文本。 */
export function serializeState(state) {
  return JSON.stringify(state)
}
