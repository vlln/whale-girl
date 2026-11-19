// /interact 路由的纯逻辑：动作分发与跨源校验（无宿主依赖，可单测）。
// 契约：applyAction 输入 (state, action, replies, locale)，返回 { status, body }，错误码语义集中于此；
// 投喂/玩耍是纯乐趣互动（零负反馈）：状态不变，只回一句宠物回话；宠物"说话"由客户端气泡展示。
// replies 是配置化的回话池（src/config.mjs DEFAULTS.replies——zh 默认值，用户可自定义追加）；
// 用户没改过配置（仍是 zh 默认池）时按请求 locale 取内置池（src/i18n.mjs REPLIES），
// 改过则原样尊重用户文案（用户数据不翻译）；空池/缺动作时回退内置（互动不因配置损坏而崩）。
// locale 归一化与回退规则见 src/i18n.mjs（未知值 → zh，保持旧行为）。
// isCrossOrigin 输入 (headers, host)，Sec-Fetch-Site 优先、其次 Origin，都缺省视为同源。
import { isDefaultReplies, normalizeLocale, repliesFor } from './i18n.mjs'

/** 按动作返回互动结果（状态不变）。replies 为 { feed: string[], play: string[] } 配置值。 */
export function applyAction(state, action, replies = null, locale = 'zh') {
  if (action === 'feed' || action === 'play') {
    const configured = Array.isArray(replies?.[action]) && replies[action].length > 0 ? replies[action] : null
    const pool = configured === null || isDefaultReplies(configured, action)
      ? repliesFor(normalizeLocale(locale), action)
      : configured
    return {
      status: 200,
      body: { pet: state, reply: pool[Math.floor(Math.random() * pool.length)] },
    }
  }
  return { status: 400, body: { error: `unknown action "${action}"; expected "feed" or "play"` } }
}

/** 跨源判定（CSRF 面）：返回 true 表示跨源（应拒绝）。 */
export function isCrossOrigin(headers, host) {
  const site = headers['sec-fetch-site']
  if (site !== undefined) return site !== 'same-origin' && site !== 'none'
  const origin = headers['origin']
  if (origin !== undefined) {
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }
  return false
}
