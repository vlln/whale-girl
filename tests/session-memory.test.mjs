// 会话记忆纯逻辑单测（node:test）。归属：src/session-memory.mjs 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSIONS_MAX, TASKS_MAX, LABEL_MAX, LINEAGE_HOPS_MAX,
  emptySessionMemory, normalizeSessionMemory, serializeSessionMemory,
  observeSession, recordTask, memoryFor, memorySnapshot, recallable,
} from '../lib/src/session-memory.mjs'

const T = 1_000_000
// 截断断言常量（与实现同值；显式写死防实现悄悄放宽）。
const TITLE_CLIP = 120
const TITLE_OVER = 200

test('空账本与序列化往返', () => {
  const empty = emptySessionMemory()
  assert.deepEqual(empty, { sessions: {} })
  const round = normalizeSessionMemory(JSON.parse(serializeSessionMemory(empty)))
  assert.deepEqual(round, empty)
})

test('observeSession：登记 parent 血缘与标题，不覆盖已有 tasks', () => {
  let mem = recordTask(emptySessionMemory(), 's1', { label: '任务A', at: T })
  mem = observeSession(mem, { id: 's1', parent: 'p1', title: '标题', at: T + 5 })
  const entry = mem.sessions.s1
  assert.equal(entry.parent, 'p1')
  assert.equal(entry.title, '标题')
  assert.equal(entry.at, T + 5)
  assert.equal(entry.tasks.length, 1, '登记不冲掉已记任务')
})

test('observeSession：重复观测保留已有 parent/title（null 不清空），非法输入原样返回', () => {
  let mem = observeSession(emptySessionMemory(), { id: 's1', parent: 'p1', title: 'T', at: T })
  mem = observeSession(mem, { id: 's1', parent: null, title: null, at: T + 1 })
  assert.equal(mem.sessions.s1.parent, 'p1')
  assert.equal(mem.sessions.s1.title, 'T')
  const before = mem
  assert.equal(observeSession(mem, { id: '', at: T }), before, '空 id 不动账本')
  assert.equal(observeSession(mem, { id: 's2', at: NaN }), before, '非法 at 不动账本')
})

test('recordTask：会话未登记时先建条目；标签/时间归一', () => {
  const mem = recordTask(emptySessionMemory(), 's9', { label: '  修复  ', at: T })
  assert.equal(mem.sessions.s9.tasks.length, 1)
  assert.equal(mem.sessions.s9.tasks[0].label, '修复')
  assert.equal(mem.sessions.s9.tasks[0].ok, true, 'ok 缺省为 true')
  assert.equal(recordTask(mem, '', { label: 'x', at: T }), mem, '空会话 id 不动账本')
  assert.equal(recordTask(mem, 's9', { label: '', at: T }), mem, '空标签丢弃')
  assert.equal(recordTask(mem, 's9', { label: 'x', at: 'nope' }), mem, '非法时间丢弃')
})

test('recordTask：每会话只留最近 TASKS_MAX 条（丢最旧）', () => {
  let mem = emptySessionMemory()
  for (let i = 0; i < TASKS_MAX + 3; i += 1) {
    mem = recordTask(mem, 's1', { label: `t${i}`, at: T + i })
  }
  const labels = mem.sessions.s1.tasks.map((t) => t.label)
  assert.equal(labels.length, TASKS_MAX)
  assert.equal(labels[labels.length - 1], `t${TASKS_MAX + 2}`)
  assert.equal(labels[0], `t${3}`, '最旧的被丢弃')
})

test('memoryFor：自身有任务（resume 同会话）→ distance 0', () => {
  let mem = recordTask(emptySessionMemory(), 's1', { label: 'A', at: T })
  mem = observeSession(mem, { id: 's1', parent: 'p0', at: T })
  const found = memoryFor(mem, 's1')
  assert.equal(found.sessionId, 's1')
  assert.equal(found.distance, 0)
  assert.equal(found.tasks.length, 1)
})

test('memoryFor：fork 新会话沿 parent 链上溯到父会话任务', () => {
  let mem = recordTask(emptySessionMemory(), 'parent', { label: '父任务', at: T })
  mem = observeSession(mem, { id: 'child', parent: 'parent', at: T + 1 })
  const found = memoryFor(mem, 'child')
  assert.equal(found.sessionId, 'parent')
  assert.equal(found.distance, 1)
  assert.equal(found.tasks[0].label, '父任务')
})

test('memoryFor：多级链、链断、环、跳数越界都返回 null（不猜）', () => {
  let mem = emptySessionMemory()
  mem = recordTask(mem, 'root', { label: 'R', at: T })
  mem = observeSession(mem, { id: 'mid', parent: 'root', at: T })
  mem = observeSession(mem, { id: 'leaf', parent: 'mid', at: T })
  assert.equal(memoryFor(mem, 'leaf').distance, 2, '三级链可回读')
  // 链断：祖先未登记
  mem = observeSession(emptySessionMemory(), { id: 'orphan', parent: 'never-seen', at: T })
  assert.equal(memoryFor(mem, 'orphan'), null)
  // 环：手改文件造出 parent 环不死循环
  mem = observeSession(emptySessionMemory(), { id: 'a', parent: 'b', at: T })
  mem = observeSession(mem, { id: 'b', parent: 'a', at: T })
  assert.equal(memoryFor(mem, 'a'), null)
  // 跳数：构造 LINEAGE_HOPS_MAX+1 级空链
  let chain = emptySessionMemory()
  chain = recordTask(chain, 'hop', { label: 'H', at: T })
  let child = 'hop'
  for (let i = 0; i <= LINEAGE_HOPS_MAX; i += 1) {
    const next = `c${i}`
    chain = observeSession(chain, { id: next, parent: child, at: T })
    child = next
  }
  assert.equal(memoryFor(chain, child), null, '越界跳数不返回')
  assert.equal(memoryFor(mem, ''), null)
  assert.equal(memoryFor(emptySessionMemory(), 'missing'), null)
})

test('memorySnapshot：null → null；命中 → 快照只带下发字段', () => {
  assert.equal(memorySnapshot(null, T), null)
  const mem = recordTask(emptySessionMemory(), 's1', { label: 'A', at: T })
  const snap = memorySnapshot(memoryFor(mem, 's1'), T + 50)
  assert.deepEqual(snap, {
    at: T + 50, distance: 0, title: null,
    tasks: [{ label: 'A', ok: true, at: T }],
  })
  assert.notEqual(snap.tasks, mem.sessions.s1.tasks, '快照是副本，不泄漏账本引用')
})

test('normalizeSessionMemory：手改/旧文件逐字段容错', () => {
  assert.deepEqual(normalizeSessionMemory(null), { sessions: {} })
  assert.deepEqual(normalizeSessionMemory('junk'), { sessions: {} })
  assert.deepEqual(normalizeSessionMemory({ sessions: 'not-an-object' }), { sessions: {} })
  const norm = normalizeSessionMemory({
    sessions: {
      good: { parent: 'p', title: 'T', at: T, tasks: [{ label: 'A', ok: true, at: T }, { label: '', at: T }, 'junk'] },
      noAt: { tasks: [] },
      badTasks: { at: T, tasks: [null, { label: 'B', at: 'x' }] },
      longTitle: { at: T, title: 'x'.repeat(TITLE_OVER), tasks: [] },
    },
  })
  assert.equal(norm.sessions.good.tasks.length, 1, '非法任务条丢弃')
  assert.equal(norm.sessions.good.tasks[0].label, 'A')
  assert.equal(norm.sessions.noAt, undefined, '缺 at 整条丢弃')
  assert.deepEqual(norm.sessions.badTasks.tasks, [], '非法 tasks 逐条丢弃')
  assert.equal(norm.sessions.longTitle.title.length, TITLE_CLIP, '超长标题截断')
})

test('normalizeSessionMemory：会话数超上限按 at 淘汰最旧', () => {
  const sessions = {}
  for (let i = 0; i < SESSIONS_MAX + 10; i += 1) {
    sessions[`s${i}`] = { at: T + i, tasks: [] }
  }
  const norm = normalizeSessionMemory({ sessions })
  assert.equal(Object.keys(norm.sessions).length, SESSIONS_MAX)
  assert.ok(norm.sessions[`s${SESSIONS_MAX + 9}`], '最新的保留')
  assert.equal(norm.sessions.s0, undefined, '最旧的被淘汰')
})

test('normalizeSessionMemory：超长标签截断到 LABEL_MAX', () => {
  const norm = normalizeSessionMemory({
    sessions: { s: { at: T, tasks: [{ label: 'x'.repeat(LABEL_MAX + 50), at: T }] } },
  })
  assert.equal(norm.sessions.s.tasks[0].label.length, LABEL_MAX)
})

test('recallable：subagent 子会话不播报回读（防 spawn 刷屏），用户会话照常', () => {
  assert.equal(recallable({ origin: 'subagent' }), false, 'subagent 子会话跳过播报')
  assert.equal(recallable({}), true, '无 origin 的用户会话可播报')
  assert.equal(recallable({ origin: undefined }), true)
  assert.equal(recallable(null), true, 'header 缺失按用户会话处理（宽松）')
  assert.equal(recallable(undefined), true)
})
