// 设置卡字段规格与派生单测（node:test，零依赖）。归属：lib/client/settings-fields.mjs 的
// 行为改动跑本文件（叶取值、文本↔数组、快照派生、即时写入的深路径提交与 CAS 判据、字段表完整性）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD_FIELDS, deriveState, leafOf, parseLines, sameLeaf, serializeLines, writeField,
} from '../lib/client/settings-fields.mjs'

test('leafOf：按点分路径取值，缺失/非对象返回 undefined', () => {
  const v = { enabled: true, walk: { enabled: false, minMs: 3000 }, replies: { feed: ['a'] }, zero: 0 }
  assert.equal(leafOf(v, 'enabled'), true)
  assert.equal(leafOf(v, 'walk.enabled'), false)
  assert.equal(leafOf(v, 'replies.feed.0'), 'a')
  assert.equal(leafOf(v, 'zero'), 0, '0 不是缺失')
  assert.equal(leafOf(v, 'walk.missing'), undefined)
  assert.equal(leafOf(v, 'missing.deep.path'), undefined)
  assert.equal(leafOf(undefined, 'enabled'), undefined)
  assert.equal(leafOf({ walk: null }, 'walk.enabled'), undefined)
})

test('sameLeaf：标量同值、数组/对象按形状比（宿主往返后引用必然不同）', () => {
  assert.equal(sameLeaf(1, 1), true)
  assert.equal(sameLeaf('a', 'a'), true)
  assert.equal(sameLeaf(1, 2), false)
  assert.equal(sameLeaf(['a', 'b'], ['a', 'b']), true, '数组按形状相等')
  assert.equal(sameLeaf({ a: 1 }, { a: 1 }), true)
  assert.equal(sameLeaf(['a'], ['b']), false)
  assert.equal(sameLeaf(null, null), true)
  assert.equal(sameLeaf(null, {}), false)
  assert.equal(sameLeaf(undefined, {}), false)
})

test('deriveState：已提交值优先，缺失回退默认值；可用性/可写性源自快照', () => {
  const defaults = { enabled: true, size: 110, walk: { enabled: true }, replies: { feed: ['内置'] } }
  const s = deriveState({ status: 'ready', writable: true, value: { size: 130 } }, defaults)
  assert.equal(s.available, true)
  assert.equal(s.writable, true)
  assert.equal(s.fields.size, 130, '已提交值优先')
  assert.equal(s.fields.enabled, true, '缺失回退默认值')
  assert.deepEqual(s.fields['replies.feed'], ['内置'], '嵌套字段的叶默认值')
  assert.equal(s.fields['walk.enabled'], true)
})

test('deriveState：unavailable / 只读快照的降级', () => {
  const s = deriveState({ status: 'unavailable', writable: false, value: {} }, { size: 110 })
  assert.equal(s.available, false)
  assert.equal(s.writable, false)
  // value 缺失也不炸（回退默认值）
  assert.equal(deriveState({ status: 'ready', writable: true }, { size: 110 }).fields.size, 110)
})

/**
 * 假 ConfigFormController：记录 mutate 调用，按 accepted 决定是否落库（CAS 被拒时宿主不改文档）。
 * @param {object} initial 初始文档
 * @param {object} [opts]
 * @param {boolean} [opts.accepted] mutate 的返回值（false = revision 过期被拒）
 * @param {boolean} [opts.ignoreWrite] 接受但文档不变（模拟宿主归一化后回读不一致）
 */
function makeScope(initial = {}, opts = {}) {
  let snap = { status: 'ready', writable: true, revision: 7, value: { ...initial } }
  const calls = []
  const setPath = (target, segments, value) => {
    const [head, ...rest] = segments
    if (rest.length === 0) return { ...target, [head]: value }
    const child = target[head]
    const base = child !== null && typeof child === 'object' && !Array.isArray(child) ? child : {}
    return { ...target, [head]: setPath(base, rest, value) }
  }
  return {
    calls,
    getSnapshot: () => snap,
    setRevision: (revision) => { snap = { ...snap, revision } },
    mutate: async (ops, revision) => {
      calls.push({ ops, revision })
      const accepted = opts.accepted !== false
      if (!accepted) return false
      if (opts.ignoreWrite !== true) {
        let value = snap.value
        for (const op of ops) value = setPath(value, op.path, op.value)
        snap = { ...snap, revision: (revision ?? snap.revision) + 1, value }
      }
      return true
    },
  }
}

test('writeField：单字段按深路径提交，不自己传 expectedRevision（交给控制器排队）', async () => {
  const scope = makeScope({ size: 110 })
  await writeField(scope, 'size', 130)
  assert.deepEqual(scope.calls.map((c) => c.ops), [[{ op: 'set', path: ['size'], value: 130 }]])
  assert.equal(scope.calls[0].revision, undefined, '自己传快照 revision 会绕过控制器的 pendingRevision 栅栏')
  assert.equal(scope.getSnapshot().value.size, 130)
})

test('writeField：嵌套字段按叶路径写（mutate 深路径，不必整组合并）', async () => {
  const scope = makeScope({ walk: { enabled: true, minMs: 3000 }, replies: { feed: ['a'], play: ['b'] } })
  await writeField(scope, 'walk.enabled', false)
  assert.deepEqual(scope.calls[0].ops, [{ op: 'set', path: ['walk', 'enabled'], value: false }])
  assert.deepEqual(scope.getSnapshot().value.walk, { enabled: false, minMs: 3000 }, '组内其他键不丢')
  await writeField(scope, 'replies.feed', ['c'])
  assert.deepEqual(scope.getSnapshot().value.replies, { feed: ['c'], play: ['b'] }, '深路径合并而非整组覆盖')
})

test('writeField：逐次写入是独立提交（无暂存、无批量）', async () => {
  const scope = makeScope({ enabled: true, size: 110 })
  await writeField(scope, 'enabled', false)
  await writeField(scope, 'size', 120)
  assert.equal(scope.calls.length, 2)
  assert.deepEqual(scope.calls.map((c) => c.ops[0].path), [['enabled'], ['size']])
  assert.deepEqual(scope.calls.map((c) => c.revision), [undefined, undefined])
})

test('writeField：同一 RTT 内连续写入都落库（F1 回归：不接受自带的 CAS 栅栏）', async () => {
  // 官方控制器按 pendingRevision 给后继写定栅栏；自己传过期的快照 revision 会被宿主按 CAS 拒绝
  // （第一次其实已落库）→ 误报「未被接受」并丢掉后一次编辑。这里绑定「writeField 不传第二个参数」。
  let revision = 7
  const value = { enabled: true, size: 110 }
  const applied = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', writable: true, revision, value: { ...value } }),
    mutate: async (ops, expected) => {
      if (expected !== undefined) return false
      for (const op of ops) {
        applied.push(op.path.join('.'))
        value[op.path[0]] = op.value
      }
      revision += 1
      return true
    },
  }
  await writeField(scope, 'size', 130)
  await writeField(scope, 'enabled', false)
  assert.deepEqual(applied, ['size', 'enabled'], '两次都必须被接受')
  assert.equal(value.size, 130)
  assert.equal(value.enabled, false)
})

test('writeField：宿主拒绝（revision 过期）时抛错，文档保持不变', async () => {
  const scope = makeScope({ size: 110 }, { accepted: false })
  await assert.rejects(() => writeField(scope, 'size', 130), /未被接受/u)
  assert.equal(scope.getSnapshot().value.size, 110)
})

test('writeField：接受但回读不一致（宿主归一化）时抛错', async () => {
  const scope = makeScope({ size: 110 }, { ignoreWrite: true })
  await assert.rejects(() => writeField(scope, 'size', 130), /未被接受/u)
})

test('writeField：数组值按形状确认（引用必然不同）', async () => {
  const scope = makeScope({ replies: { feed: [] } })
  await writeField(scope, 'replies.feed', ['a', 'b'])
  assert.deepEqual(scope.getSnapshot().value.replies.feed, ['a', 'b'])
})

test('文案池文本 ↔ 数组：trim、去空行、行尾空行不产生空串', () => {
  assert.deepEqual(parseLines(' a \n\n b \n'), ['a', 'b'])
  assert.deepEqual(parseLines(''), [])
  assert.deepEqual(parseLines(undefined), [])
  assert.equal(serializeLines(['a', 'b']), 'a\nb')
  assert.equal(serializeLines(undefined), '')
})

test('CARD_FIELDS：字段表完整性（路径唯一、种类合法、范围合理）', () => {
  const paths = CARD_FIELDS.map((f) => f.path)
  assert.equal(new Set(paths).size, paths.length, '路径必须唯一')
  assert.equal(paths.length, 8, '字段数量与设置卡一致')
  for (const f of CARD_FIELDS) {
    assert.ok(['toggle', 'number', 'lines'].includes(f.kind), `${f.path}: 种类合法`)
    assert.equal(typeof f.labelKey, 'string', `${f.path}: 有文案键`)
    if (f.kind === 'number') {
      assert.ok(Number.isFinite(f.min) && Number.isFinite(f.max), `${f.path}: 有范围`)
      assert.ok(f.min < f.max, `${f.path}: min < max`)
      assert.ok(f.step > 0, `${f.path}: step > 0`)
    } else {
      assert.equal(f.min, undefined, `${f.path}: 非数字字段不带范围`)
    }
  }
  // 三个开关 + 三个数字 + 两个文案池（与界面一致）
  assert.deepEqual(
    CARD_FIELDS.filter((f) => f.kind === 'toggle').map((f) => f.path),
    ['enabled', 'sessionMemory', 'walk.enabled'],
  )
  assert.deepEqual(
    CARD_FIELDS.filter((f) => f.kind === 'number').map((f) => f.path),
    ['size', 'opacity', 'sleepAfterMs'],
  )
})
