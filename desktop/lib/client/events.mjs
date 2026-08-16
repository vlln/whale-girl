// SSE（Server-Sent Events）客户端：订阅 whale-girl /events 事件流。
// 用 fetch 流式读取（Node ≥18 原生 fetch，无需全局 EventSource）。
// 行为对齐 DESIGN.md §3.2：收到 data 事件 → 回调触发一次 /state 刷新；
// 断线自动按 retry 重连；25s 心跳 `: ping` 注释行忽略。
//
// 事件语义：whale-girl 推送 `data: {"type":"event"}\n\n` 表示"状态已变化，
// 请重新拉 /state"。本模块不自解释具体字段，只负责把连接生命周期与"收到事件"
// 转成事件回调（onEvent / onReconnect / onError）。

import { EventEmitter } from 'node:events'

/** 默认重连间隔（whale-girl SSE 发 `retry: 3000`，兜底 3s）。 */
const DEFAULT_RETRY_MS = 3000
/** 单次连接最大存活（交由 heartbeat 续命；SSE 路由心跳 25s，这里留余量防僵连）。 */
const HEARTBEAT_GUARD_MS = 90000

/**
 * SSE 订阅器（EventEmitter，事件：event / reconnect / error / open）。
 * @param {string} url 事件流 URL
 * @param {object} [opts]
 * @param {number|string} [opts.retryMs] 初始重连间隔（可被服务器 retry 覆盖）
 * @param {AbortSignal} [opts.signal] 退出信号
 */
export function createSSEClient(url, { retryMs = DEFAULT_RETRY_MS, signal } = {}) {
  const em = new EventEmitter()
  let controller = null
  let closed = false
  let retry = Number(retryMs) || DEFAULT_RETRY_MS
  let lastPingAt = 0

  async function streamOnce() {
    if (closed) return
    // each: 用 AbortController 控制每次连接，重连时重建。
    controller = new AbortController()
    const abort = () => controller.abort()
    if (signal) {
      if (signal.aborted) { close(); return }
      signal.addEventListener('abort', abort, { once: true })
    }
    try {
      const res = await fetch(url, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`SSE connect HTTP ${res.status}`)
      }
      em.emit('open')
      lastPingAt = Date.now()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!closed && !controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // 以空行分隔事件块
        let sep
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sep + 2)
          buffer = buffer.slice(sep + 2)
          handleChunk(raw)
        }
      }
    } catch (err) {
      if (closed || controller.signal.aborted) return
      em.emit('error', err)
    } finally {
      if (signal) signal.removeEventListener('abort', abort)
      if (!closed) scheduleReconnect()
    }
  }

  function handleChunk(raw) {
    // 逐行解析 SSE 字段（data: / retry: / 注释行）
    const dataLines = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      } else if (line.startsWith(':')) {
        // 注释行（含心跳给 ping）——忽略
      } else if (line.startsWith('retry:')) {
        const v = Number(line.slice(6).trim())
        if (Number.isFinite(v) && v > 0) retry = v
      }
    }
    lastPingAt = Date.now()
    if (dataLines.length) {
      const payload = dataLines.join('\n')
      em.emit('event', payload)
    }
  }

  let reconnectTimer = null
  function scheduleReconnect() {
    if (closed) return
    reconnectTimer = setTimeout(async () => {
      em.emit('reconnect')
      await streamOnce()
    }, retry)
  }

  // 心跳守卫：超过 HEARTBEAT_GUARD_MS 无任何数据（服务器僵连）→ 主动断开重连。
  const guard = setInterval(() => {
    if (closed) return
    if (Date.now() - lastPingAt > HEARTBEAT_GUARD_MS) {
      controller?.abort()
    }
  }, Math.min(30000, HEARTBEAT_GUARD_MS))

  function close() {
    closed = true
    clearInterval(guard)
    clearingTimeout(reconnectTimer)
    controller?.abort()
    em.emit('close')
  }

  // 启动
  streamOnce()

  return { events: em, close }
}

function clearingTimeout(t) {
  if (t) clearTimeout(t)
}
