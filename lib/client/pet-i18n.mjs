// 宠物 UI 文案（client-only）：namespace `whale-girl.pet` 的字典 + 离线兜底读面。
// 契约：
// - PET_DICT 是注册给宿主 locale 服务的唯一字典（zh/en/ru 同一键集合，verify-i18n 门禁守护）；
//   带数字的"复数"文案不在此表（宿主 bind 不做复数），走 ../src/i18n.mjs 的 t()。
// - petText(locale, key, vars) 是字典的本地读面：locale 服务缺席/注册失败时仍能渲染，
//   保证「没有 locale 服务 → 宠物照常跑」的既有降级契约。
// - 显示的标题/按钮/aria 全部经此模块；改键名必须同改 client/index.mjs 调用点。
import { normalizeLocale } from '../src/i18n.mjs'

/** 卡片/宠物 UI 的 locale 命名空间（独立于设置命名空间 'settings.whale-girl'）。 */
export const PET_NS = 'whale-girl.pet'

export const PET_DICT = Object.freeze({
  zh: Object.freeze({
    'pet.label': '桌面宠物',
    'pet.menu': '互动菜单：回车或空格打开',
    'menu.feed': '🍗 喂食',
    'menu.play': '🎾 玩耍',
    'menu.role': '🎭 更换',
    'menu.noRole': '暂无其他角色',
    'menu.switchRole': '切换到下一个角色',
    'status.offline': '📡 离线…',
    'titles.wrap': '称号「{names}」',
    'titles.sep': '」「',
  }),
  en: Object.freeze({
    'pet.label': 'Desktop pet',
    'pet.menu': 'Interaction menu: press Enter or Space',
    'menu.feed': '🍗 Feed',
    'menu.play': '🎾 Play',
    'menu.role': '🎭 Switch',
    'menu.noRole': 'No other characters',
    'menu.switchRole': 'Switch to the next character',
    'status.offline': '📡 Offline…',
    'titles.wrap': 'Titles: {names}',
    'titles.sep': ', ',
  }),
  ru: Object.freeze({
    'pet.label': 'Домашний питомец',
    'pet.menu': 'Меню питомца: Enter или пробел',
    'menu.feed': '🍗 Покормить',
    'menu.play': '🎾 Поиграть',
    'menu.role': '🎭 Сменить',
    'menu.noRole': 'Других персонажей нет',
    'menu.switchRole': 'Сменить на следующего персонажа',
    'status.offline': '📡 Нет связи…',
    'titles.wrap': 'Звания: {names}',
    'titles.sep': ', ',
  }),
})

/** 占位符替换（`{name}` → vars.name）；缺值保留原文，便于发现漏传。 */
export function withVars(text, vars) {
  if (vars === null || typeof vars !== 'object') return text
  return text.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined ? whole : String(vars[name])))
}

/** 字典本地读面（locale 服务缺席时的兜底；缺键回退 zh，再回退键名）。 */
export function petText(locale, key, vars) {
  const l = normalizeLocale(locale)
  return withVars(PET_DICT[l]?.[key] ?? PET_DICT.zh[key] ?? key, vars)
}
