// 桌面伴侣核心引擎：组装 heartbeat（presence 心跳）+ 状态轮询 + SSE 即时刷新 + 本地调度。
// 与渲染解耦：只产出「当前动画意图 + 状态快照」，由外层决定如何展示
// （headless 打日志 / Electron 画桌面）。纯 Node ESM，可被 Node 测试与 Electron main 复用。
//
// 对 whale-girl 的写面仅两个公开端点：
// - POST /presence …… 显示层心跳（P0-1）
// - POST /interact   …… 用户投喂/玩耍（P1-1）
// 其余全部只读。账本（XP/称号）由 whale-girl 独占，本引擎绝不改写。

import { createClient } from './http.mjs'
import { createSSEClient } from './events.mjs'
import { createLogger } from './utils.mjs'
import { ROUTE_PREFIX } from './utils.mjs'
import { createScheduler, stepScheduler, applyInteraction } from './scheduler.mjs'
import { pickAnimation } from './state.mjs'

/** 本地调度 tick（比 pollMs 更密：睡眠/游走/工作插曲需要细粒度推进）。 */
const TICK_MS = 250

/**
 * 启动桌面伴侣引擎。
 * @param {object} opts 见 src/config.mjs loadConfig()
 * @param {object} [hooks] 渲染层 / 日志回调
 * @param {(snapshot: object) => void} [hooks.onSnapshot] 每次 /state 轮询后的快照回调
 * @param {(anim: {name: string, context: object}) => void} [hooks.onAnimation] 动画意图变化回调
 * @param {(reply: string) => void} [hooks.onReply] interact 回话气泡回调
 * @returns {{ client, stop: () => Promise<void>, interact: (action:'feed'|'play') => Promise<void>, getState: () => object }}
 */
export async function createCompanion(opts, hooks = {}) {
  const log = opts.logger ?? createLogger()
  const client = createClient({
    baseURL: opts.baseURL,
    routePrefix: opts.routePrefix ?? ROUTE_PREFIX,
  })

  // —— 运行时状态 ——
  let snapshot = null            // 最近一次 /state
  let remoteConfig = null        // /config 的 config
  let anim = { name: 'idle', context: {} } // 最近派生动画意图
  let stopped = false
  const sched = createScheduler({ sleepAfterMs: opts.sleepAfterMs })

  // 配置跟随：configRevision 门控（变化才重应用 /config，避免每 3s 拉一次）。
  let lastConfigRevision = -1
  const applyRemoteConfig = async () => {
    if (snapshot === null || typeof snapshot.configRevision !== 'number') return
    if (snapshot.configRevision === lastConfigRevision) return
    lastConfigRevision = snapshot.configRevision
    try {
      const body = await client.getConfig()
      remoteConfig = body?.config ?? null
    } catch (err) {
      log.warn('拉取 /config 失败（保持上次）:', err.message)
    }
  }

  // 派生动画意图并回调渲染层（幂等：只通知变化）。
  let lastAnimName = null
  const computeAnimation = () => {
    const next = pickAnimation(snapshot, sched)
    anim = next
    if (next.name !== lastAnimName) {
      lastAnimName = next.name
      hooks.onAnimation?.(next)
    }
    hooks.onTick?.(next, sched)
    return next
  }

  // —— 状态轮询 ——
  // 并发守卫（Copilot）：refreshState 可能被 setInterval / SSE 事件 / interact 同时调用。
  // 用 in-flight + coalesce 保证同一时刻仅一个请求在途：在途期间到达的调用打标记，
  // 完成后若期间有新的刷新请求则再跑一次，避免并发覆盖与竞态，也不丢最新状态。
  let refreshing = false
  let pendingRefresh = false
  const refreshState = async () => {
    if (refreshing) {
      pendingRefresh = true // 在途：coalesce，待本轮结束再触发一轮
      return null
    }
    refreshing = true
    try {
      do {
        pendingRefresh = false
        try {
          const body = await client.getState()
          snapshot = body
          await applyRemoteConfig()
          hooks.onSnapshot?.(snapshot)
          computeAnimation()
          if (!pendingRefresh) return body
        } catch (err) {
          log.warn('GET /state 失败:', err.message)
          // 在途期间若有新的刷新请求积累，仍重试一轮
          return null
        }
      } while (pendingRefresh)
      return snapshot
    } finally {
      refreshing = false
      pendingRefresh = false
    }
  }

  // —— SSE 即时刷新（事件 → 立即 /state，延迟降到单次往返）——
  let sse = null
  const startSSE = () => {
    if (opts.eventsEnabled === false) return
    const url = new URL(`${opts.routePrefix ?? ROUTE_PREFIX}/events`, opts.baseURL).toString()
    sse = createSSEClient(url, { signal: opts.signal })
    sse.events.on('event', () => {
      log.debug('SSE 事件 → 立即刷新 /state')
      refreshState()
    })
    sse.events.on('reconnect', () => log.debug('SSE 重连'))
    sse.events.on('error', (err) => log.warn('SSE:', err.message))
  }

  // —— presence 心跳（15s；退出时 {online:false} 清理）——
  // AbortSignal 超时：退出/下线时不因 DSH web 瞬时不可达而挂死（reviewer 建议）。
  const PRESENCE_TIMEOUT_MS = 2000
  const sendPresence = async (online) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PRESENCE_TIMEOUT_MS)
    try {
      const body = await client.setPresence(online, { signal: controller.signal })
      return body
    } catch (err) {
      log.warn(`POST /presence ${online ? '上线' : '下线'} 失败:`, err.message)
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  let heartbeatTimer = null
  const startHeartbeat = () => {
    if (opts.autoPresence === false) return
    heartbeatTimer = setInterval(() => sendPresence(true), opts.heartbeatMs)
  }

  // 启动
  if (opts.autoPresence !== false) await sendPresence(true) // 立即宣告在场（网页端据此隐藏宠物）
  startHeartbeat()
  await refreshState()
  startSSE()
  const pollTimer = setInterval(refreshState, opts.pollMs)
  const tickTimer = setInterval(() => {
    if (stopped) return
    stepScheduler(sched, { snapshot, now: Date.now() })
    computeAnimation()
  }, TICK_MS)

  // —— 互动（P1-1）——
  const interact = async (action = 'feed') => {
    try {
      const body = await client.interact(action)
      applyInteraction(sched, action, Date.now()) // 本地瞬发/喜悦/唤醒（带注入时间源）
      const reply = body?.reply ?? null
      log.info(`互动 ${action}: ${reply ?? ''}`)
      hooks.onReply?.(reply)
      await refreshState()
      computeAnimation()
      return body
    } catch (err) {
      log.warn(`POST /interact ${action} 失败:`, err.message)
      return null
    }
  }

  // —— 停止清理 ——
  const stop = async () => {
    if (stopped) return
    stopped = true
    clearInterval(heartbeatTimer)
    clearInterval(pollTimer)
    clearInterval(tickTimer)
    if (sse) sse.close()
    if (opts.cleanupOnExit !== false) {
      await sendPresence(false) // 显式下线，网页宠物立即恢复
    }
    log.info('伴侣已停止（presence 已下线）')
  }

  return {
    client,
    interact,
    getState: () => snapshot,
    getAnimation: () => anim,
    get scheduler() { return sched },
    stop,
  }
}