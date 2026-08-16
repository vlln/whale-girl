// 动画状态名权威集合（与 whale-girl lib/client/logic.mjs 的 STATE_NAMES 对齐）。
// 渲染层/状态机用它校验 animationState 是否合法；未知状态回退占位/idle。
export const STATE_NAMES = Object.freeze([
  'idle', 'working', 'celebrate', 'error', 'disappointed', 'joy', 'eat', 'play',
  'drag', 'walk', 'sleep', 'wake', 'welcome', 'think', 'wait',
])

export function isKnownState(name) {
  return STATE_NAMES.includes(name)
}
