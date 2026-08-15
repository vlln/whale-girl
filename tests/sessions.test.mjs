// parseSessionEvent / applySessionView / createSessionView / titleFromLog 单测：
// GET /whale-girl/sessions 的每会话活动账本（thinking / tool:<name> / waiting / done）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSessionEvent,
  createSessionView,
  applySessionView,
  titleFromLog,
} from '../.dsh-plugin/src/sessions.mjs'

const ev = (type, data) => ({ type, seq: 1, time: 1, data })

test('turn/start → thinking', () => {
  assert.deepEqual(parseSessionEvent(ev('turn/start', { turn: 1 })), { kind: 'activity', value: 'thinking' })
})

test('tool/call → tool:<name>（bash/pwsh 原样，桌面端映射显示文案）', () => {
  assert.deepEqual(parseSessionEvent(ev('tool/call', { turn: 1, step: 1, callId: 'c', name: 'bash', arguments: '{}' })),
    { kind: 'activity', value: 'tool:bash' })
  assert.deepEqual(parseSessionEvent(ev('tool/call', { turn: 1, step: 1, callId: 'c', name: 'read', arguments: '{}' })),
    { kind: 'activity', value: 'tool:read' })
})

test('tool/call 缺 name 返回 null（不推导）', () => {
  assert.equal(parseSessionEvent(ev('tool/call', { turn: 1 })), null)
})

test('turn/end blocked → waiting，其余结束原因 → done', () => {
  assert.deepEqual(parseSessionEvent(ev('turn/end', { turn: 1, reason: { kind: 'blocked' } })),
    { kind: 'activity', value: 'waiting' })
  for (const kind of ['completed', 'aborted', 'error', 'max-tokens', 'interrupted']) {
    assert.deepEqual(parseSessionEvent(ev('turn/end', { turn: 1, reason: { kind } })),
      { kind: 'activity', value: 'done' }, `reason.kind=${kind}`)
  }
})

test('session/title → 标题（不改活动）', () => {
  assert.deepEqual(parseSessionEvent(ev('session/title', { title: 'whale-girl 二次开发', messageSeqs: [1], source: { kind: 'fallback' } })),
    { kind: 'title', value: 'whale-girl 二次开发' })
})

test('非活动事件返回 null（不抛）', () => {
  assert.equal(parseSessionEvent(null), null)
  assert.equal(parseSessionEvent('nope'), null)
  assert.equal(parseSessionEvent({}), null)
  assert.equal(parseSessionEvent(ev('step/start', { turn: 1, step: 1 })), null)
  assert.equal(parseSessionEvent(ev('user/message', { text: 'hi' })), null)
})

test('createSessionView 默认 done + 空标题', () => {
  assert.deepEqual(createSessionView('s1', 1000), { id: 's1', title: null, activity: 'done', since: 1000 })
})

test('applySessionView 事件驱动更新（不可变；无变化返回原引用）', () => {
  const view = createSessionView('s1', 1000)
  const thinking = applySessionView(view, ev('turn/start', { turn: 1 }))
  assert.deepEqual(thinking, { id: 's1', title: null, activity: 'thinking', since: 1000 })
  assert.notEqual(thinking, view)
  const tool = applySessionView(thinking, ev('tool/call', { turn: 1, step: 1, callId: 'c', name: 'bash', arguments: '{}' }))
  assert.deepEqual(tool, { id: 's1', title: null, activity: 'tool:bash', since: 1000 })
  const done = applySessionView(tool, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  assert.deepEqual(done, { id: 's1', title: null, activity: 'done', since: 1000 })
  const titled = applySessionView(done, ev('session/title', { title: 'T', messageSeqs: [], source: { kind: 'user' } }))
  assert.deepEqual(titled, { id: 's1', title: 'T', activity: 'done', since: 1000 })
  // 无变化事件返回原引用
  assert.equal(applySessionView(view, ev('step/start', { turn: 1, step: 1 })), view)
  assert.equal(applySessionView(titled, ev('session/title', { title: 'T', messageSeqs: [], source: { kind: 'user' } })), titled)
  // 未知事件/异常结构不抛
  assert.equal(applySessionView(view, null), view)
})

test('titleFromLog 取最后一个非空标题', () => {
  const log = [
    { type: 'session/title', seq: 0, time: 1, data: { title: 'first', messageSeqs: [], source: { kind: 'fallback' } } },
    { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
    { type: 'session/title', seq: 2, time: 3, data: { title: 'second', messageSeqs: [1], source: { kind: 'fallback' } } },
  ]
  assert.equal(titleFromLog(log), 'second')
  assert.equal(titleFromLog([]), null)
  assert.equal(titleFromLog(null), null)
  assert.equal(titleFromLog([{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }]), null)
})
