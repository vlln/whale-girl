// 路由前缀单一来源（verify-routes-sync 门禁守护）。
// client 与 Node half 的 HTTP 端点共用同一前缀——改前缀只改这里；
// 任何文件不得手写 '/plugins/...' 字面量（漂移会断端点，见决策记录
// 2026-08-10-doc-system-single-source-and-gates.md）。
// 零依赖纯常量：client bundle（esbuild 内联）与 Node half 都可 import。
export const ROUTE_PREFIX = '/whale-girl'
export const STATE_PATH = `${ROUTE_PREFIX}/state`
export const INTERACT_PATH = `${ROUTE_PREFIX}/interact`
export const CONFIG_PATH = `${ROUTE_PREFIX}/config`
export const ASSETS_PATH = `${ROUTE_PREFIX}/assets`
export const EVENTS_PATH = `${ROUTE_PREFIX}/events`
export const SESSIONS_PATH = `${ROUTE_PREFIX}/sessions`
