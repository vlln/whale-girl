// 设置卡字段规格与派生单测（node:test，零依赖）。归属：lib/client/settings-fields.mjs 的
// 行为改动跑本文件（叶取值、组写入合并、快照派生、即时写入的单键/整组提交、字段表完整性）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD_FIELDS, deriveState, groupWrite, leafOf, parseLines, serializeLines, writeField,
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

test('groupWrite：基于已提交组对象合并叶，不丢组内其他键', () => {
  const committed = { walk: { enabled: true, minMs: 3000, maxMs: 40000 } }
  assert.deepEqual(groupWrite(committed, 'walk.enabled', false), {
    key: 'walk',
    value: { enabled: false, minMs: 3000, maxMs: 40000 },
  })
  // 组缺失 / 组不是对象 / 组是数组：都以空对象为基底，只写目标叶
  assert.deepEqual(groupWrite({}, 'replies.feed', ['x']), { key: 'replies', value: { feed: ['x'] } })
  assert.deepEqual(groupWrite({ replies: null }, 'replies.play', ['y']), { key: 'replies', value: { play: ['y'] } })
  assert.deepEqual(groupWrite({ replies: ['oops'] }, 'replies.feed', ['z']), { key: 'replies', value: { feed: ['z'] } })
  // 不修改传入对象
  assert.deepEqual(committed.walk, { enabled: true, minMs: 3000, maxMs: 40000 })
})

test('deriveState：已提交值优先，缺失回退默认值；可用性/可写性源自快照', () => {
  const defaults = { enabled: true, size: 110, walk: { enabled: true }, replies: { feed: ['内置'] } }
  const s = deriveState({ status: 'ready', writable: true, value: { size: 130 } }, defaults)
  assert.equal(s.available, true)
  assert.equal(s.writable, true)
  assert.equal(s.fields.size, 130, '已提交值优先')
  assert.equal(s.fields.enabled, true, '缺失回退默认值')
  assert.deepEqual(s.fields['replies.feed'], ['内置'], '组字段的叶默认值')
  assert.equal(s.fields['walk.enabled'], true)
})

test('deriveState：unavailable / 只读快照的降级', () => {
  const s = deriveState({ status: 'unavailable', writable: false, value: {} }, { size: 110 })
  assert.equal(s.available, false)
  assert.equal(s.writable, false)
  // value 缺失也不炸（回退默认值）
  assert.equal(deriveState({ status: 'ready', writable: true }, { size: 110 }).fields.size, 110)
})

/** 假 scope：记录 set 调用，快照可替换。 */
function makeScope(initial = {}) {
  let snap = { status: 'ready', writable: true, value: { ...initial } }
  const sets = []
  return {
    sets,
    getSnapshot: () => snap,
    set: async (key, value) => { sets.push([key, value]); snap = { ...snap, value: { ...snap.value, [key]: value } } },
  }
}

test('writeField：普通字段单键提交', async () => {
  const scope = makeScope({ size: 110 })
  await writeField(scope, 'size', 130)
  assert.deepEqual(scope.sets, [['size', 130]])
})

test('writeField：组字段整组提交，保留组内其他键', async () => {
  const scope = makeScope({ walk: { enabled: true, minMs: 3000, maxMs: 40000 }, replies: { feed: ['a'], play: ['b'] } })
  await writeField(scope, 'walk.enabled', false)
  assert.deepEqual(scope.sets, [['walk', { enabled: false, minMs: 3000, maxMs: 40000 }]])
  await writeField(scope, 'replies.feed', ['c'])
  assert.deepEqual(scope.sets[1], ['replies', { feed: ['c'], play: ['b'] }])
})

test('writeField：逐次写入是独立提交（无暂存、无批量）', async () => {
  const scope = makeScope({ enabled: true, size: 110 })
  await writeField(scope, 'enabled', false)
  await writeField(scope, 'size', 120)
  assert.deepEqual(scope.sets, [['enabled', false], ['size', 120]])
})

test('文案池文本 ↔ 数组：trim、去空行、行尾空行不产生空串', () => {
  assert.deepEqual(parseLines(' a \n\n b \n'), ['a', 'b'])
  assert.deepEqual(parseLines(''), [])
  assert.deepEqual(parseLines(undefined), [])
  assert.equal(serializeLines(['a', 'b']), 'a\nb')
  assert.equal(serializeLines(undefined), '')
})

test('CARD_FIELDS：字段表完整性（路径唯一、种类合法、范围合理、组字段自洽）', () => {
  const paths = CARD_FIELDS.map((f) => f.path)
  assert.equal(new Set(paths).size, paths.length, '路径必须唯一')
  assert.equal(paths.length, 7, '字段数量与设置卡一致')
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
    if (f.group !== undefined) {
      assert.ok(f.path.startsWith(`${f.group}.`), `${f.path}: 组字段路径以组名开头`)
      assert.equal(groupWrite({}, f.path, 1).key, f.group, `${f.path}: 写入键等于组名`)
    } else {
      assert.ok(!f.path.includes('.'), `${f.path}: 非组字段是单段路径（可直接 set）`)
    }
  }
  // 两个开关 + 三个数字 + 两个文案池（与界面一致）
  assert.deepEqual(
    CARD_FIELDS.filter((f) => f.kind === 'toggle').map((f) => f.path),
    ['enabled', 'walk.enabled'],
  )
})
