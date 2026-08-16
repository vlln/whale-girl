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
 * 找下一个 SSE 事件块分隔点（空行）。SSE 规范允许 LF("\n\n") 或 CRLF("\r\n\r\n")——
 * 返回分隔符之前的 index（即块内容结束处）；无分隔返回 -1。
 */
function findBlockBoundary(buffer) {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1) return crlf
  if (crlf === -1) return lf
  return Math.min(lf, crlf)
}

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
        // 以空行分隔事件块。SSE 规范允许 LF(\n) 与 CRLF(\r\n)：同时匹配两种，
        // 取最早出现的分隔点，避免仅识别 "\n\n" 时 CRLF 服务的缓冲永不切块。
        let sep
        while ((sep = findBlockBoundary(buffer)) !== -1) {
          const raw = buffer.slice(0, sep)
          // 跳过分隔符自身的换行（\n\n 或 \r\n\r\n）
          buffer = buffer.slice(sep + (buffer[sep] === '\r' ? 4 : 2))
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
    // 先清掉未触发的旧 timer，避免并发调度重复重连（Copilot: timer 覆盖泄漏）。
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (closed) return
      em.emit('reconnect')
      streamOnce()
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
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    controller?.abort()
    em.emit('close')
  }

  // 启动
  streamOnce()

  return { events: em, close }
}
