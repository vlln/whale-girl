// 多语言文案唯一来源（zh/en/ru；零依赖纯函数，Node half 与 client bundle 共用）。
// 契约：
// - normalizeLocale：任意输入 → 'zh' | 'en' | 'ru'（容忍大小写与地区前缀；未知值回退 'zh'，
//   保持未传 locale 的旧消费者行为不变）。
// - t(locale, key, vars)：窄接口。缺键按 zh 兜底（en/zh 永不因 ru 上线而变砖，ru 缺键
//   也能显示可读文案）；值为形式数组时按 locale 规则 + vars.n 选形（zh 单形、en one/other、
//   ru one/few/many），{name} 占位符做字符串替换。
// - 称号名/回话池/记忆日志在此集中；src/pet-state.mjs 的 TITLES[].name 保留 zh 字面量
//   作为旧数据兼容面，titleName(id, locale) 才是显示用读面。
// - 新增字符串必须三语齐全（verify-i18n 门禁守护键集合与 ru 无 CJK）。

/** 支持的 locale（封闭集合；顺序即设置面板/文档的展示顺序）。 */
export const LOCALES = Object.freeze(['zh', 'en', 'ru'])

/** 归一化 locale：取小写语言前缀，仅接受白名单，其余回退 'zh'。 */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return 'zh'
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  return LOCALES.includes(base) ? base : 'zh'
}

/** 复数形式下标：zh 单形；en one/other；ru one/few/many（西里尔规则）。 */
export function pluralIndex(locale, n) {
  const l = normalizeLocale(locale)
  const count = Number.isFinite(Number(n)) ? Math.abs(Math.trunc(Number(n))) : 0
  if (l === 'ru') {
    const mod10 = count % 10
    const mod100 = count % 100
    if (mod10 === 1 && mod100 !== 11) return 0
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1
    return 2
  }
  if (l === 'en') return count === 1 ? 0 : 1
  return 0
}

/** 占位符替换：`{key}` → vars[key]；缺值时保留原文占位（便于发现漏传）。 */
function interpolate(template, vars) {
  if (vars === null || typeof vars !== 'object') return template
  return template.replace(/\{(\w+)\}/g, (whole, key) => (vars[key] === undefined ? whole : String(vars[key])))
}

/** 称号显示名（id → 当前 locale 的名称；未知 id 原样返回，容忍旧数据）。 */
export const TITLE_NAMES = Object.freeze({
  zh: Object.freeze({
    'first-task': '初次协作',
    helper: '勤劳伙伴',
    veteran: '百炼成钢',
    regular: '常驻伙伴',
    resilient: '越挫越勇',
    social: '广结善缘',
  }),
  en: Object.freeze({
    'first-task': 'First collaboration',
    helper: 'Diligent partner',
    veteran: 'Forged veteran',
    regular: 'Regular companion',
    resilient: 'Unshaken',
    social: 'Social butterfly',
  }),
  ru: Object.freeze({
    'first-task': 'Первое сотрудничество',
    helper: 'Трудолюбивый напарник',
    veteran: 'Закалённый ветеран',
    regular: 'Постоянный спутник',
    resilient: 'Не сдаётся',
    social: 'Душа компании',
  }),
})

/** 称号 id → 显示名（locale 兜底 zh，再兜底 id）。 */
export function titleName(id, locale = 'zh') {
  const l = normalizeLocale(locale)
  return TITLE_NAMES[l]?.[id] ?? TITLE_NAMES.zh[id] ?? id
}

/** 互动回话池（配置缺失/损坏时的兜底；config.mjs 的 DEFAULTS.replies 取 zh 这一份）。 */
export const REPLIES = Object.freeze({
  zh: Object.freeze({
    feed: Object.freeze(['「啊呜——谢谢投喂！」', '「好好吃，能量满满！」', '「嘻嘻，投喂成功！」']),
    play: Object.freeze(['「嘿嘿，再来一次！」', '「玩得好开心～」', '「我赢了！再来！」']),
  }),
  en: Object.freeze({
    feed: Object.freeze(['"Nom nom — thanks for the food!"', '"So tasty, full of energy!"', '"Hehe, feeding successful!"']),
    play: Object.freeze(['"Hehe, one more time!"', '"That was so much fun!"', '"I won! Again!"']),
  }),
  ru: Object.freeze({
    feed: Object.freeze(['«Ам-ам — спасибо за угощение!»', '«Как вкусно, полна сил!»', '«Хи-хи, кормление удалось!»']),
    play: Object.freeze(['«Хи-хи, ещё разок!»', '«Так весело!»', '«Я выиграла! Ещё!»']),
  }),
})

/** 指定 locale 的回话池；未知动作返回空数组（由调用方保持旧的 400 语义）。 */
export function repliesFor(locale, action) {
  const l = normalizeLocale(locale)
  const pool = REPLIES[l]?.[action]
  return Array.isArray(pool) && pool.length > 0 ? pool : []
}

/** 用户是否仍用着 zh 默认回话（readConfig 总会把 DEFAULTS 合进配置，需按值判定）。 */
export function isDefaultReplies(pool, action) {
  const base = REPLIES.zh[action]
  return Array.isArray(base) && Array.isArray(pool) && pool.length === base.length && pool.every((s, i) => s === base[i])
}

/** 通用文案表（记忆日志、状态卡数字、会话记忆气泡）。 */
const DICT = Object.freeze({
  zh: Object.freeze({
    'memory.levelUp': '升到 Lv.{level} 🎉',
    'memory.taskDone': '完成任务「{label}」（第 {n} 个）',
    'memory.failure': '任务失败（第 {n} 次）——没关系，再来',
    'memory.newSession': '新会话开启（第 {n} 个）',
    'memory.resume': '回到旧会话，继续陪伴',
    'memory.untitledTask': '未命名任务',
    'stats.done': ['{n} 任务'],
    'stats.failed': ['{n} 失败'],
    'memory.quote': '「{label}」',
    'memory.listSep': '、',
    'memory.last': '上次你们完成了',
    'memory.branch': '上次在分支前的会话里完成了',
    'memory.more': '等 {n} 项',
  }),
  en: Object.freeze({
    'memory.levelUp': 'Reached Lv.{level} 🎉',
    'memory.taskDone': 'Completed task "{label}" (#{n})',
    'memory.failure': 'Task failed (#{n}) — no worries, try again',
    'memory.newSession': 'New session started (#{n})',
    'memory.resume': 'Back to an earlier session, still here with you',
    'memory.untitledTask': 'Untitled task',
    'stats.done': ['{n} task', '{n} tasks'],
    'stats.failed': ['{n} failure', '{n} failures'],
    'memory.quote': '"{label}"',
    'memory.listSep': ', ',
    'memory.last': 'Last time you completed ',
    'memory.branch': 'Before the branch you completed ',
    'memory.more': ' and {n} total',
  }),
  ru: Object.freeze({
    'memory.levelUp': 'Новый уровень Lv.{level} 🎉',
    'memory.taskDone': 'Задача «{label}» выполнена ({n}-я)',
    'memory.failure': 'Задача не удалась ({n}-я) — не страшно, попробуем ещё',
    'memory.newSession': 'Новая сессия ({n}-я)',
    'memory.resume': 'Вернулись в прежнюю сессию, продолжаем',
    'memory.untitledTask': 'Без названия',
    'stats.done': ['{n} задача', '{n} задачи', '{n} задач'],
    'stats.failed': ['{n} провал', '{n} провала', '{n} провалов'],
    'memory.quote': '«{label}»',
    'memory.listSep': ', ',
    'memory.last': 'В прошлый раз вы завершили ',
    'memory.branch': 'До ответвления вы завершили ',
    'memory.more': ' (всего {n})',
  }),
})

/** 文案键表（供门禁与调用方枚举；不含称号/回话池）。 */
export function dictKeys(locale) {
  return Object.keys(DICT[normalizeLocale(locale)])
}

/** 指定 locale 的文案表副本（只读枚举用；运行时取值走 t()）。 */
export function translations(locale) {
  return { ...DICT[normalizeLocale(locale)] }
}

/**
 * 取文案：缺键回退 zh；数组值按 locale 与 vars.n 选形；最后做 {name} 替换。
 * @param {string} locale
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(locale, key, vars) {
  const l = normalizeLocale(locale)
  const raw = DICT[l]?.[key] ?? DICT.zh[key]
  if (raw === undefined) return key
  const template = Array.isArray(raw) ? raw[Math.min(pluralIndex(l, vars?.n), raw.length - 1)] ?? raw[0] : raw
  return interpolate(template, vars)
}
