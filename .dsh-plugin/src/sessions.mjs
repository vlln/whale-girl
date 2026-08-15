// 每会话活动账本（GET /whale-girl/sessions 数据源）：纯函数，从宿主会话事件
// 推导每会话活动（零宿主依赖，可单测）。
// 契约：
// - 输入是宿主 `session/event` 回调的第二个参数（append 日志条目，结构与官方
//   `@deepseek-ai/dsh-session` 的 SessionEvent 一致）：{ type, seq, time, data }。
// - 事件类型字段是 `type`（'turn/start' | 'turn/end' | 'tool/call' |
//   'session/title' | ...），与 session-events.mjs 同一事实源。
// - 活动取值（closed set）：'thinking'（深度思考中）/ 'tool:<name>'（执行工具，
//   桌面端对 bash/pwsh 显示"运行命令行中"）/ 'waiting'（等待批准）/
//   'done'（回合完成/无事件的新会话默认）。
// - 返回 null（非活动事件/结构异常）或 { kind: 'activity' | 'title', value }；
//   turn/start → thinking；tool/call → tool:<name>；turn/end 的
//   reason.kind === 'blocked' → waiting，其余结束原因 → done；
//   session/title → 会话标题（仅标题，不改活动）。
// - applySessionView 是不可变更新：输入视图不被修改，返回新视图或原视图
//   （无变化时返回原引用，调用方可用 === 判断是否需要落账）。

/**
 * 从一条会话事件推导活动/标题变化。
 * @param {unknown} event 宿主 session/event 回调的事件参数
 * @returns {null | { kind: 'activity', value: string } | { kind: 'title', value: string }}
 */
export function parseSessionEvent(event) {
  if (event === null || typeof event !== 'object') return null
  const type = typeof event.type === 'string' ? event.type : null
  const data = typeof event.data === 'object' && event.data !== null ? event.data : null
  if (type === 'turn/start') return { kind: 'activity', value: 'thinking' }
  if (type === 'tool/call') {
    const name = data !== null && typeof data.name === 'string' ? data.name : null
    if (name === null || name === '') return null
    return { kind: 'activity', value: `tool:${name}` }
  }
  if (type === 'turn/end') {
    const reason = data !== null ? data.reason : null
    const blocked = typeof reason === 'object' && reason !== null && reason.kind === 'blocked'
    return { kind: 'activity', value: blocked ? 'waiting' : 'done' }
  }
  if (type === 'session/title') {
    const title = data !== null && typeof data.title === 'string' ? data.title : null
    if (title === null || title === '') return null
    return { kind: 'title', value: title }
  }
  return null
}

/**
 * 一条会话视图：{ id, title, activity, since }。
 * @param {string} id 会话 id
 * @param {number} since 会话开始时间（Unix epoch ms）
 */
export function createSessionView(id, since) {
  return { id, title: null, activity: 'done', since }
}

/**
 * 把一条会话事件应用到视图（不可变）。
 * @param {{ id: string, title: string | null, activity: string, since: number }} view
 * @param {unknown} event 宿主会话事件
 * @returns {typeof view} 新视图；事件不改变视图时返回原引用
 */
export function applySessionView(view, event) {
  const parsed = parseSessionEvent(event)
  if (parsed === null) return view
  if (parsed.kind === 'title') {
    if (parsed.value === view.title) return view
    return { ...view, title: parsed.value }
  }
  if (parsed.value === view.activity) return view
  return { ...view, activity: parsed.value }
}

/**
 * 从会话事件日志兜底取标题（最后一个非空 session/title 事件）。
 * @param {readonly unknown[]} events 会话事件日志
 * @returns {string | null}
 */
export function titleFromLog(events) {
  if (!Array.isArray(events)) return null
  let title = null
  for (const event of events) {
    const parsed = parseSessionEvent(event)
    if (parsed !== null && parsed.kind === 'title') title = parsed.value
  }
  return title
}
