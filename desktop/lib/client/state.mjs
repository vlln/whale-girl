// 状态机：把 whale-girl /state 的 activity + pet 快照映射为「动画意图」。
// 与 whale-girl client/logic.mjs 的 pickState 对齐（同一状态集合/优先级），
// 但纯 Node、无 DOM、去掉 drag（桌面端不走拖拽）：
// 优先级 = activity burst > transient(本地) > wait > celebrate(回合完成) > working(随机插曲) > think > joy > sleep > walk > idle。
//
// 输出 { name, context }：
// - name：动画状态名（15 状态之一，见 whale-girl manifest）
// - context：渲染层需要的最小参数（如 opSize 工具窗尺寸）
//
// 状态：本模块是无状态纯函数 + 一个可持久的调度器（working 随机插曲 / 睡眠 / 游走）。

import { STATE_NAMES } from './state-names.mjs'

// 与 whale-girl tick 配合的本地参数（对齐 client/logic.mjs 常量）
export const WAKE_MS = 3000        // 睡醒过渡
export const JOY_MS = 1600         // interact 后短时喜悦
export const TRANSIENT_MS = 1500   // eat/play 瞬发
export const SLEEP_AFTER_MS = 60000 // 空闲 ≥60s 打盹（与 whale-girl 默认一致）
// working 随机插曲（会话思考期间偶尔插入，见 whale-girl logic）
export const WORKING_MIN_WAIT_MS = 12000
export const WORKING_MAX_WAIT_MS = 30000
export const WORKING_MIN_DUR_MS = 2500
export const WORKING_MAX_DUR_MS = 6000

/**
 * 状态优先级表（行序即优先级；与 whale-girl 对齐，去掉 drag）。
 * input：{ activity, sessionThink, sessionWait, turnCompleted, celebrateUntil, joyUntil,
 *          sleep, walking, transient, workingActive }
 */
export const STATE_TABLE = [
  // activity 事件 burst（welcome/celebrate/error/disappointed/joy）：until 有效期内优先。
  // 注意用 c.now（注入的可测时间），不是 Date.now()——pickState 是纯函数，测试传固定 now。
  { state: 'burst', when: (c) => c.activity.name !== 'idle' && c.activity.name !== 'working' && c.activity.until > c.now, resolve: (c) => c.activity.name },
  { state: 'eat', when: (c) => c.transient === 'eat' },
  { state: 'play', when: (c) => c.transient === 'play' },
  { state: 'wake', when: (c) => c.transient === 'wake' },
  { state: 'wait', when: (c) => c.sessionWait },
  // 回合完成庆祝（client 本地窗口，低于事件 burst）
  { state: 'celebrate', when: (c) => c.celebrateUntil > c.now },
  { state: 'working', when: (c) => c.workingActive },
  { state: 'think', when: (c) => c.sessionThink },
  { state: 'joy', when: (c) => c.now < c.joyUntil },
  { state: 'sleep', when: (c) => c.sleep },
  { state: 'walk', when: (c) => c.walking },
  { state: 'idle', when: () => true },
]

/** 选择动画状态名（now 显式，测试确定性）。 */
export function pickState(input) {
  const ctx = { now: input.now ?? Date.now(), ...input }
  for (const row of STATE_TABLE) {
    if (row.when(ctx)) return row.resolve ? row.resolve(ctx) : row.state
  }
  return 'idle'
}

/**
 * 结合 /state 快照与本地调度器派生动画意图。
 * @param {object} body /state 响应
 * @param {object} sched 本地调度状态（见 scheduler.mjs createScheduler）
 * @returns {{ name: string, context: object }}
 */
export function pickAnimation(body, sched = {}) {
  const act = body?.activity ?? { name: 'idle', until: 0 }
  const now = Date.now()
  const name = pickState({
    activity: act,
    sessionThink: act.sessionThink === true,
    sessionWait: act.sessionWait === true,
    celebrateUntil: act.turnCompletedUntil ?? 0,
    joyUntil: sched.joyUntil ?? 0,
    transient: sched.transient ?? null,
    sleep: sched.sleeping === true,
    walking: sched.walking === true,
    workingActive: sched.working?.active === true,
    now,
  })
  return {
    name,
    context: {
      activityName: act.name,
      pet: body?.pet ?? null,
      sessionThink: act.sessionThink === true,
      sessionWait: act.sessionWait === true,
      size: body?.size ?? null,
      until: act.until ?? 0,
    },
  }
}
