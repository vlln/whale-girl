// HTTP 消费者封装：对 whale-girl 端点的只读 + 写面（interact/presence）。
// 全部原生 fetch（Node ≥18 全局），零第三方依赖。
// 契约对齐：见 DESIGN.md §3；isCrossOrigin 若本地调用缺 Origin/Sec-Fetch-Site 视为同源（已验证）。
//
// 错误语义：网络/HTTP 异常抛出带 status 的错误；调用方据此区分瞬态/终态。

import { ROUTE } from './utils.mjs'

/**
 * 创建绑定到指定 BaseURL 的 whale-girl HTTP 客户端。
 * @param {{ baseURL: string, routePrefix?: string, pollMs?: number }} opts
 */
export function createClient({ baseURL, routePrefix = '/whale-girl' }) {
  const url = (path) => new URL(`${routePrefix}${path}`, baseURL).toString()

  async function request(method, path, body, { signal } = {}) {
    const res = await fetch(url(path), {
      method,
      headers: body !== undefined
        ? { 'content-type': 'application/json' }
        : { accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
    if (!res.ok) {
      const err = new Error(`whale-girl ${method} ${path} → HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return res.json()
  }

  return {
    baseURL,
    url,

    /** GET /state → { apiVersion, pet, activity, configRevision, companionOnline } */
    getState: () => request('GET', '/state'),

    /** GET /config → { config, revision } */
    getConfig: () => request('GET', '/config'),

    /** GET /sessions → Array<{ id, title, activity, since }> */
    getSessions: () => request('GET', '/sessions'),

    /** GET /assets/manifest.json → 角色/状态/帧配置 */
    getManifest: () => request('GET', '/assets/manifest.json'),

    /**
     * POST /presence → { online: boolean }
     * @param {boolean} online true=上线续命，false=立即下线
     * @param {{signal?: AbortSignal}} [opts] 可选 AbortSignal（退出清理超时用）
     */
    setPresence: (online = true, opts = {}) => request('POST', '/presence', { online }, opts),

    /**
     * POST /interact → { pet, reply }
     * @param {'feed'|'play'} action 投喂/玩耍（纯乐趣，零账本写面）
     */
    interact: (action = 'feed') => request('POST', '/interact', { action }),
  }
}

export { ROUTE }
