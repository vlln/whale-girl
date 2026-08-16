// whale-girl-desktop 共用小工具：路由拼接与轻量日志。
// 路由前缀单一来源：默认与 whale-girl lib/src/routes.mjs 的 ROUTE_PREFIX 一致（/whale-girl），
// 不手写漂移。

export const ROUTE_PREFIX = '/whale-girl'

/** @returns `{prefix}${path}`，路径以 / 开头 */
export function ROUTE(path) {
  return `${ROUTE_PREFIX}${path}`
}

/** 简易分级日志（避免无关噪音；可用 --quiet 关闭）。 */
export function createLogger({ quiet = false, tag = 'whale-girl-desktop' } = {}) {
  const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const write = (level, ...args) => {
    if (quiet && level === 'debug') return
    console.log(`[${ts()}] [${tag}] [${level}]`, ...args)
  }
  return {
    info: (...a) => write('info', ...a),
    debug: (...a) => write('debug', ...a),
    warn: (...a) => write('warn', ...a),
    error: (...a) => write('error', ...a),
  }
}
