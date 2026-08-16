// 行为纯函数（对齐 whale-girl client/logic.mjs，无 DOM、可单测）：
// working 随机插曲节奏、睡醒边沿、interact 醒觉决策。

import {
  WORKING_MIN_WAIT_MS, WORKING_MAX_WAIT_MS, WORKING_MIN_DUR_MS, WORKING_MAX_DUR_MS,
} from './state.mjs'

function rand(min, max) {
  return min + Math.random() * (max - min)
}

/**
 * working 随机插曲决策：会话思考期间偶尔插入 working 工作姿态，其余时间 think 常态。
 * @param {object} input
 * @param {number} input.now
 * @param {boolean} input.sessionThink
 * @param {object} input.working { active, until }
 * @returns {object} { active, until }
 */
export function nextWorkingRhythm({ now, sessionThink, working = { active: false, until: 0 } }) {
  if (!sessionThink) return { active: false, until: 0 }
  if (working.active) {
    return { active: false, until: now + rand(WORKING_MIN_DUR_MS, WORKING_MAX_DUR_MS) }
  }
  return { active: true, until: now + rand(WORKING_MIN_WAIT_MS, WORKING_MAX_WAIT_MS) }
}

/**
 * 睡醒边沿：上一帧显示 sleep、本帧离开 sleep（非拖拽打断、无瞬发占用）→ 播 wake。
 */
export function shouldWake(prevState, nextState, ctx = {}) {
  return prevState === 'sleep' && nextState !== 'sleep' && !ctx.dragging && (ctx.transient ?? null) === null
}

/**
 * 互动醒觉：拖拽/喂食/玩耍都是用户在场——空闲重算；睡着则附加 wake 过渡。
 */
export function wakeFromInteraction({ sleeping }) {
  return { sleeping: false, wake: sleeping === true }
}
