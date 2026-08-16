// whale-girl-desktop 本地配置：桌面端运行参数（与 whale-girl /whale-girl/config 的
// 体验层配置分开——这里管「桌面端如何连接与跑」，不是 whale-girl 的宠物配置）。
//
// 契约红线：
// - BaseURL 指向 DSH web 服务（默认 http://127.0.0.1:3080）。
// - pollMs / heartbeatMs / presenceTTLMs 需与 whale-girl /presence 契约匹配：
//   心跳窗口 45s，每 15s 续命一次（heartbeatMs < presenceTTLMs，留足余量）。
// - 运行时参数可由 CLI / 环境变量覆盖（见 loadConfig）。

export const DEFAULTS = Object.freeze({
  // DSH web 服务根
  baseURL: 'http://127.0.0.1:3080',
  // 路由前缀（与 whale-girl lib/src/routes.mjs 单一来源一致，勿手写漂移）
  routePrefix: '/whale-girl',
  // 状态轮询间隔（whale-girl 默认 pollMs=3000）
  pollMs: 3000,
  // presence 心跳间隔（whale-girl PRESENCE_TTL_MS=45s；15s 续命 < 45s 余量充分）
  heartbeatMs: 15000,
  // SSE 事件流：收到事件即触发一次 /state 刷新
  eventsEnabled: true,
  // 启动时是否自动宣告在线（--headless 也心跳，让网页端隐藏宠物）
  autoPresence: true,
  // 退出时是否显式下线（{online:false}）
  cleanupOnExit: true,
  // 渲染层开关：false 时只跑核心（心跳+状态+SSE，不弹桌面窗）
  renderEnabled: true,
  // 宠物默认尺寸（px；跟随 /config.size 热更新）
  size: 110,
  // 文字角标/气泡开关
  showStatus: true,
})

/**
 * 解析合并后的运行配置：环境变量 DSH_* 与 CLI 覆盖缺省。
 * @param {{env?: Record<string,string|undefined>, argv?: string[]}} [ctx]
 * @returns {object}
 */
export function loadConfig({ env = process.env ?? {}, argv = process.argv ?? [] } = {}) {
  const cfg = { ...DEFAULTS }

  if (env.WHALE_GIRL_BASE_URL) cfg.baseURL = env.WHALE_GIRL_BASE_URL.replace(/\/+$/, '')
  if (env.WHALE_GIRL_POLL_MS != null) cfg.pollMs = Number(env.WHALE_GIRL_POLL_MS) || cfg.pollMs
  if (env.WHALE_GIRL_HEARTBEAT_MS != null) cfg.heartbeatMs = Number(env.WHALE_GIRL_HEARTBEAT_MS) || cfg.heartbeatMs

  // CLI: --headless / --base-url=<url> / --poll-ms=<n> / --no-presence / --no-render
  if (argv.includes('--headless')) cfg.renderEnabled = false
  if (argv.includes('--no-render')) cfg.renderEnabled = false
  if (argv.includes('--no-presence')) cfg.autoPresence = false
  for (const arg of argv) {
    const m = /^--base-url=(.+)$/.exec(arg)
    if (m) cfg.baseURL = m[1].replace(/\/+$/, '')
    const p = /^--poll-ms=(\d+)$/.exec(arg)
    if (p) cfg.pollMs = Number(p[1])
    const h = /^--heartbeat-ms=(\d+)$/.exec(arg)
    if (h) cfg.heartbeatMs = Number(h[1])
  }
  return cfg
}

/** whale-girl /config 返回的体验层配置（消费端只读；走 configRevision 门控）。 */
export const REMOTE_DEFAULTS = Object.freeze({
  enabled: true, size: 110, opacity: 1, pollMs: 3000,
})
