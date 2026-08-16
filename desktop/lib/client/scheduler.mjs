// 本地行为调度器：驱动桌面端在 /state 之外的本地节奏——睡眠（sleep）、
// 游走（walk 动画意图）、working 随机插曲、interact 瞬发（eat/play/joy/wake）。
//
// 与 whale-girl runtime 解耦：/state 只给「事实窗口」（activity burst、sessionThink、
// sessionWait、turnCompletedUntil），本地调度补「节奏」（睡/醒、走、工作插曲、互动瞬发）。
// 所有字段是纯数据（可序列化），由引擎每个 tick 调用 step() 推进。
//
// 默认节奏参数与 whale-girl client 对齐（见 DESIGN.md §3）。

import {
  JOY_MS, TRANSIENT_MS, SLEEP_AFTER_MS,
  WORKING_MIN_WAIT_MS, WORKING_MAX_WAIT_MS, WORKING_MIN_DUR_MS, WORKING_MAX_DUR_MS,
} from './state.mjs'
import { nextWorkingRhythm, shouldWake, wakeFromInteraction } from './behaviors.mjs'

function rand(min, max) {
  return min + Math.random() * (max - min)
}

/** 初始调度状态。 */
export function createScheduler({ sleepAfterMs = SLEEP_AFTER_MS } = {}) {
  return {
    sleepAfterMs,
    idleSince: 0,          // 进入 idle 的时刻（睡眠由此起算）
    sleeping: false,       // 当前是否打盹
    joyUntil: 0,           // interact 后喜悦窗口
    transient: null,       // 'eat'|'play'|'wake'|null
    transientUntil: 0,
    walking: false,
    nextWalkAt: 0,
    working: { active: false, until: 0 },
    lastActivityState: 'idle',
  }
}

/**
 * 每 tick 推进调度（调用引擎的轮询刷新）。
 * @param {object} sched 调度状态
 * @param {object} ctx
 * @param {object} ctx.snapshot /state 快照（activity 等）
 * @param {number} ctx.now
 */
export function stepScheduler(sched, { snapshot, now = Date.now() } = {}) {
  const act = snapshot?.activity ?? { name: 'idle', until: 0 }
  // 瞬发复位（eat/play/wake 播完或超时）
  if (sched.transient !== null && now >= sched.transientUntil) {
    const wasFun = sched.transient === 'eat' || sched.transient === 'play'
    sched.transient = null
    if (wasFun) sched.joyUntil = now + JOY_MS
  }
  // 会话活跃性 → 空闲起算 / 睡眠
  const isActive = act.name !== 'idle' || act.until > now
  if (isActive) {
    sched.idleSince = 0
  } else if (sched.idleSince === 0) {
    sched.idleSince = now
  }
  sched.sleeping = act.name === 'idle' && sched.idleSince !== 0 && now - sched.idleSince > sched.sleepAfterMs

  // working 随机插曲（仅会话思考期间武装；到点才重新决策——nextWorkingRhythm 返回
  // 的 until 是「新阶段结束时刻」，不能每 tick 无条件翻转，否则 think/working 高频抖动）
  if (act.sessionThink !== true) {
    if (sched.working.active !== false || sched.working.until !== 0) {
      sched.working = { active: false, until: 0 }
    }
  } else if (sched.working.until === 0 || now >= sched.working.until) {
    sched.working = nextWorkingRhythm({ now, sessionThink: true, working: sched.working })
  }

  // 游走节奏（简单周期：空闲时偶尔走一段；离开空闲即重置排程，避免回空闲时立刻走）
  if (sched.walking) {
    if (now >= sched.nextWalkAt) {
      sched.walking = false
      sched.nextWalkAt = now + rand(18000, 40000)
    }
  } else if (!sched.sleeping && act.name === 'idle') {
    if (sched.nextWalkAt === 0) sched.nextWalkAt = now + rand(18000, 40000)
    if (now >= sched.nextWalkAt) {
      sched.walking = true
      sched.nextWalkAt = now + rand(3000, 6000)
    }
  } else {
    if (sched.walking) sched.walking = false
    sched.nextWalkAt = 0 // 非空闲：游走排程复位
  }

  return sched
}

/** interact 后重置空闲 + eat/play 瞬发（对齐 whale-girl：互动瞬发优先于醒觉——
 *  喂食/玩耍直接播 eat/play；wake 只用于拖拽放下等非互动路径，桌面端无拖拽故不产生）。 */
export function applyInteraction(sched, action) {
  const decision = wakeFromInteraction({ sleeping: sched.sleeping })
  sched.sleeping = decision.sleeping
  sched.idleSince = 0
  sched.joyUntil = Date.now() + JOY_MS
  sched.transient = action === 'feed' ? 'eat' : 'play'
  sched.transientUntil = Date.now() + TRANSIENT_MS
  return sched
}
