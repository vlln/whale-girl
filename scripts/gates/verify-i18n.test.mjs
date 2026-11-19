// 门禁自证：verify-i18n 必须证明它会拒绝（法则 2）。
// 归属：门禁源码改动跑本文件（node --test scripts/gates/）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, checkTables } from './verify-i18n.mjs'

/** 干净的三语样例表（每项只测一个不变量）。 */
function demo(ru = {}, en = {}) {
  return [{
    label: 'demo',
    table: {
      zh: { title: '更新到 {target}', hint: '文本' },
      en: { title: 'Update to {target}', hint: 'text', ...en },
      ru: { title: 'Обновить до {target}', hint: 'текст', ...ru },
    },
  }]
}

test('干净的三语表通过', () => {
  assert.deepEqual(checkTables(demo()), { ok: true, errors: [] })
})

test('ru 含 CJK 汉字被拒', () => {
  const { ok, errors } = checkTables(demo({ hint: '摘要' }))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /CJK/)
})

test('ru 含中文标点被拒', () => {
  const { ok, errors } = checkTables(demo({ hint: '文本：这里' }))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /CJK/)
})

test('ru 缺键被拒', () => {
  const tables = demo()
  delete tables[0].table.ru.hint
  const { ok, errors } = checkTables(tables)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /缺键 hint/)
})

test('ru 多出键被拒', () => {
  const tables = demo({ extra: 'лишний' })
  const { ok, errors } = checkTables(tables)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /多出键 extra/)
})

test('ru 丢占位符被拒', () => {
  const { ok, errors } = checkTables(demo({ title: 'Обновить' }))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /占位符不一致/)
})

test('ru 空字符串被拒', () => {
  const { ok, errors } = checkTables(demo({ hint: '' }))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /空字符串/)
})

test('en 含 CJK 被拒', () => {
  const { ok, errors } = checkTables(demo({}, { hint: '文本' }))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /CJK/)
})

test('仓库文案表当前全部达标', () => {
  const { ok, errors } = check()
  assert.ok(ok, errors.join('\n'))
})
