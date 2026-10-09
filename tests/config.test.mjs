// src/config.mjs 单测（node:test）。归属：配置 schema/默认值/读值改动跑本文件。
// 注意：本测试在插件安装目录运行（@deepseek-ai/schemastery 从依赖解析）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, buildSchema, readConfig, NAMESPACE } from '../lib/src/config.mjs'

test('NAMESPACE 与 DEFAULTS 完整性', () => {
  assert.equal(NAMESPACE, 'whale-girl')
  assert.equal(typeof DEFAULTS.size, 'number')
  assert.equal(DEFAULTS.size, 110)
  assert.equal(DEFAULTS.enabled, true)
  assert.equal(DEFAULTS.sessionMemory, false, '会话记忆默认关（opt-in）')
  assert.equal(DEFAULTS.walk.enabled, true)
  assert.equal(DEFAULTS.walk.maxWaitMs, 40000)
})

test('buildSchema：条目 Config 用，解析出 volatile 实时引用', () => {
  const schema = buildSchema()
  assert.equal(typeof schema, 'function') // z.object 返回可调用的 schema 构造器
  const result = schema['~standard'].validate({})
  assert.equal(result.issues, undefined)
  // live 字段是宿主注入的 { get() } 引用（不重挂载原地换值的传输面），含嵌套叶与数组叶。
  assert.equal(result.value.size.get(), 110)
  assert.equal(result.value.sessionMemory.get(), false, 'sessionMemory 是 volatile 叶')
  assert.equal(result.value.walk.enabled.get(), true)
  assert.deepEqual(result.value.replies.feed.get(), DEFAULTS.replies.feed)
  // 未标 volatile 的容器保持普通对象（volatile 只落在叶上）。
  assert.equal(typeof result.value.walk.enabled, 'object')
})

test('readConfig：解引用 volatile 叶、与 DEFAULTS 合并补缺', () => {
  const config = {
    size: { get: () => 130 },
    walk: { enabled: { get: () => false } },
    replies: { feed: { get: () => ['a'] } },
  }
  const next = readConfig(config)
  assert.equal(next.size, 130)
  assert.equal(next.walk.enabled, false)
  assert.deepEqual(next.replies.feed, ['a'])
  // 缺键回退 DEFAULTS（schema 补默认前的兜底，settings.yaml 缺节也安全）。
  assert.equal(next.opacity, DEFAULTS.opacity)
  assert.equal(next.walk.speedPxPerSec, DEFAULTS.walk.speedPxPerSec)
  assert.deepEqual(next.replies.play, DEFAULTS.replies.play)
})

test('readConfig：成对区间 min > max 时交换（写面只剩 schema 校验）', () => {
  const next = readConfig({ walk: { minWaitMs: { get: () => 9000 }, maxWaitMs: { get: () => 5000 }, minMs: 4000, maxMs: 1000 } })
  assert.equal(next.walk.minWaitMs, 5000)
  assert.equal(next.walk.maxWaitMs, 9000)
  assert.equal(next.walk.minMs, 1000)
  assert.equal(next.walk.maxMs, 4000)
})

test('readConfig：缺配置/坏形状安全回退 DEFAULTS', () => {
  for (const input of [undefined, null, {}, 'nope', 42]) {
    const next = readConfig(input)
    assert.equal(next.size, DEFAULTS.size)
    assert.equal(next.walk.minWaitMs, DEFAULTS.walk.minWaitMs)
  }
  assert.equal(readConfig({ walk: null }).walk.maxMs, DEFAULTS.walk.maxMs)
})

test('DEFAULTS.replies：内置回话池非空且为数组', () => {
  assert.ok(Array.isArray(DEFAULTS.replies.feed) && DEFAULTS.replies.feed.length > 0)
  assert.ok(Array.isArray(DEFAULTS.replies.play) && DEFAULTS.replies.play.length > 0)
})
