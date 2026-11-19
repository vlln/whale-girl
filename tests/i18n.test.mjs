// src/i18n.mjs 单测：locale 归一化、复数选形、缺失键回退、称号/回话池。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCALES, normalizeLocale, pluralIndex, t, titleName, repliesFor, isDefaultReplies, translations, dictKeys,
} from '../lib/src/i18n.mjs'
import { REPLIES } from '../lib/src/i18n.mjs'
import { memoryLine } from '../lib/client/logic.mjs'

test('normalizeLocale：白名单与地区前缀', () => {
  assert.deepEqual(LOCALES, ['zh', 'en', 'ru'])
  assert.equal(normalizeLocale('ru'), 'ru')
  assert.equal(normalizeLocale('RU'), 'ru')
  assert.equal(normalizeLocale('ru-RU'), 'ru')
  assert.equal(normalizeLocale('en-US'), 'en')
  assert.equal(normalizeLocale('zh-Hans'), 'zh')
  for (const bad of [undefined, null, '', 'de', 42, {}]) assert.equal(normalizeLocale(bad), 'zh')
})

test('pluralIndex：俄语 one/few/many', () => {
  assert.equal(pluralIndex('ru', 1), 0)
  assert.equal(pluralIndex('ru', 2), 1)
  assert.equal(pluralIndex('ru', 5), 2)
  assert.equal(pluralIndex('ru', 11), 2)
  assert.equal(pluralIndex('ru', 21), 0)
  assert.equal(pluralIndex('ru', 22), 1)
  assert.equal(pluralIndex('ru', 25), 2)
})

test('pluralIndex：英语 one/other，中文单形', () => {
  assert.equal(pluralIndex('en', 1), 0)
  assert.equal(pluralIndex('en', 0), 1)
  assert.equal(pluralIndex('en', 2), 1)
  assert.equal(pluralIndex('zh', 1), 0)
  assert.equal(pluralIndex('zh', 5), 0)
})

test('t：俄语复数选形', () => {
  assert.equal(t('ru', 'stats.done', { n: 1 }), '1 задача')
  assert.equal(t('ru', 'stats.done', { n: 2 }), '2 задачи')
  assert.equal(t('ru', 'stats.done', { n: 5 }), '5 задач')
  assert.equal(t('ru', 'stats.failed', { n: 11 }), '11 провалов')
  assert.equal(t('en', 'stats.done', { n: 1 }), '1 task')
  assert.equal(t('en', 'stats.done', { n: 3 }), '3 tasks')
  assert.equal(t('zh', 'stats.done', { n: 3 }), '3 任务')
})

test('t：缺键回退 zh、未知 locale 回退 zh、未知键回退键名', () => {
  assert.equal(t('de', 'memory.resume'), t('zh', 'memory.resume'))
  assert.equal(t('ru', 'no.such.key'), 'no.such.key')
  assert.equal(t('ru', 'memory.taskDone', { label: 'сборка', n: 4 }), 'Задача «сборка» выполнена (4-я)')
})

test('translations：三语键集合一致', () => {
  for (const key of dictKeys('zh')) {
    assert.ok(key in translations('en'), `en 缺 ${key}`)
    assert.ok(key in translations('ru'), `ru 缺 ${key}`)
  }
})

test('titleName：id → 当前语言名，未知 id 原样', () => {
  assert.equal(titleName('first-task', 'zh'), '初次协作')
  assert.equal(titleName('first-task', 'en'), 'First collaboration')
  assert.equal(titleName('first-task', 'ru'), 'Первое сотрудничество')
  assert.equal(titleName('unknown-id', 'ru'), 'unknown-id')
  assert.equal(titleName('helper', 'fr'), '勤劳伙伴') // 未知语言回退 zh
})

test('repliesFor：按 locale 取池，未知动作为空', () => {
  assert.deepEqual(repliesFor('ru', 'feed'), [...REPLIES.ru.feed])
  assert.equal(repliesFor('en', 'play').length, 3)
  assert.deepEqual(repliesFor('ru', 'unknown'), [])
})

test('isDefaultReplies：按值判定 zh 默认池', () => {
  assert.equal(isDefaultReplies([...REPLIES.zh.feed], 'feed'), true)
  assert.equal(isDefaultReplies(['своя реплика'], 'feed'), false)
  assert.equal(isDefaultReplies(undefined, 'feed'), false)
})

test('memoryLine：俄语措辞与引号，向后兼容缺省 zh', () => {
  const memory = { distance: 0, tasks: [{ label: 'сборка', ok: true }, { label: 'тесты', ok: true }] }
  assert.equal(memoryLine(memory, 'ru'), 'В прошлый раз вы завершили «сборка», «тесты»')
  assert.equal(memoryLine({ ...memory, distance: 1 }, 'ru'), 'До ответвления вы завершили «сборка», «тесты»')
  assert.equal(memoryLine({ ...memory, distance: 0, tasks: memory.tasks.concat([{ label: 'деплой', ok: true }]) }, 'ru'),
    'В прошлый раз вы завершили «тесты», «деплой» (всего 3)')
  assert.equal(memoryLine({ distance: 0, tasks: [{ label: 'a', ok: true }] }), '上次你们完成了「a」')
  assert.equal(memoryLine({ distance: 0, tasks: [] }, 'ru'), null)
})
