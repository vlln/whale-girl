// 门禁：UI 文案三语完整性（verify-i18n）。
// 拒绝不变量：
//   1) 文案表（设置卡 / 宠物 UI / 记忆与统计 / 称号名 / 回话池）在 zh/en/ru 的键集合不一致
//      ——缺键会让该语言静默回退 zh，等于界面混语言；
//   2) ru 或 en 的字符串值含 CJK 汉字/中文标点（俄语界面残留中文，正是本次改造要消灭的缺陷）；
//   3) ru 值丢了 zh 里的命名占位符（{target}/{n}/…）——漏转会让动态文案塌陷；
//   4) 存在空字符串值（空文案在 UI 上表现为元素消失，静默不可见）。
// 只读、确定性；自证测试见 verify-i18n.test.mjs。
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { PET_DICT } from '../../lib/client/pet-i18n.mjs'
import { zh as settingsZh, en as settingsEn, ru as settingsRu } from '../../lib/client/settings-text.mjs'
import { REPLIES, TITLE_NAMES, translations } from '../../lib/src/i18n.mjs'

const LOCALES = ['zh', 'en', 'ru']
/** CJK 汉字 + 中文/全角标点（ru/en 文案里出现即违规；zh 表本身不检查）。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/
const PLACEHOLDER = /\{(\w+)\}/g

/** 收集全部三语文案表（label 用于报错定位）。 */
export function localeTables() {
  return [
    { label: 'settings-text', table: { zh: settingsZh, en: settingsEn, ru: settingsRu } },
    { label: 'pet-i18n', table: PET_DICT },
    { label: 'i18n.titleNames', table: TITLE_NAMES },
    {
      label: 'i18n.replies',
      table: Object.fromEntries(LOCALES.map((l) => [l, Object.fromEntries(
        Object.entries(REPLIES[l]).map(([action, pool]) => [action, pool.join('\n')]),
      )])),
    },
    { label: 'i18n.dict', table: Object.fromEntries(LOCALES.map((l) => [l, translations(l)])) },
  ]
}

function placeholders(text) {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort()
}

/** 校验一组三语文案表。返回 { ok, errors }（纯函数，自证测试直接调用）。 */
export function checkTables(tables) {
  const errors = []
  for (const { label, table } of tables) {
    const keys = Object.fromEntries(LOCALES.map((l) => [l, Object.keys(table[l] ?? {})]))
    if (keys.zh.length === 0) {
      errors.push(`${label}: zh 表为空（文案表结构变更？）`)
      continue
    }
    for (const locale of ['en', 'ru']) {
      const missing = keys.zh.filter((k) => !keys[locale].includes(k))
      const extra = keys[locale].filter((k) => !keys.zh.includes(k))
      for (const key of missing) errors.push(`${label}.${locale}: 缺键 ${key}（回退 zh 会混语言）`)
      for (const key of extra) errors.push(`${label}.${locale}: 多出键 ${key}（zh 表没有）`)
    }
    for (const locale of ['en', 'ru']) {
      for (const [key, value] of Object.entries(table[locale] ?? {})) {
        // 复数键的值是形式数组（t() 按 n 选形）；逐形式校验，空形式同样算缺陷。
        const forms = Array.isArray(value) ? value : [value]
        if (forms.length === 0) {
          errors.push(`${label}.${locale}.${key}: 空形式数组`)
          continue
        }
        for (const form of forms) {
          if (typeof form !== 'string') {
            errors.push(`${label}.${locale}.${key}: 值不是字符串`)
            continue
          }
          if (form.trim() === '') errors.push(`${label}.${locale}.${key}: 空字符串（UI 上元素会消失）`)
          if (CJK.test(form)) errors.push(`${label}.${locale}.${key}: 含 CJK/中文标点（目标语言残留中文）`)
        }
      }
    }
    for (const [key, value] of Object.entries(table.zh ?? {})) {
      if (typeof value !== 'string') continue
      const ruValue = table.ru?.[key]
      const expected = placeholders(value)
      const actualForms = Array.isArray(ruValue) ? ruValue : (typeof ruValue === 'string' ? [ruValue] : [])
      for (const form of actualForms) {
        if (placeholders(form).join(',') !== expected.join(',')) {
          errors.push(`${label}.ru.${key}: 占位符不一致（zh: {${expected.join('}{')}} / ru: {${placeholders(form).join('}{')}}）`)
        }
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/** 校验仓库内文案表（门禁入口）。 */
export function check() {
  return checkTables(localeTables())
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { ok, errors } = check()
  for (const e of errors) console.error(`[verify-i18n] ${e}`)
  if (!ok) {
    console.error(`[verify-i18n] ${errors.length} 处违规`)
    process.exit(1)
  }
  console.log('[verify-i18n] OK（zh/en/ru 键集合一致、ru/en 无 CJK、占位符对齐）')
}
