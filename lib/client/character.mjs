// 角色清单解析层：manifest 角色索引的纯函数读面（无 DOM、可单测）。
// 契约：
// - manifest 形状（兼容旧读）：顶层 `states` = 单角色 `whale-girl` 简写；
//   或 `{ characters: { <id>: { meta?, states } }, default }`。
// - 角色 character = { id, name?, names?, credit?, meta?, states }；name 是 manifest 的
//   默认/兼容名，names 是可选的 { <locale>: <name> } 本地化表（zh/en/ru；缺项回退 name）。
//   states 是「状态名 → 动画集」的**全量映射**——15 状态必须全部提供 sheet（不再 emoji
//   降级，verify-assets 门禁强制）。
// - 动画集 animation set = manifest.states 条目 { sheet, frames, fps, playback, motion }。
// - 角色 id 限制 [a-z0-9-]（进入 URL 路径，防注入；assets 路由另有路径净化兜底）。
import { STATE_NAMES } from './logic.mjs'
import { normalizeLocale } from '../src/i18n.mjs'

export const DEFAULT_ROLE_ID = 'whale-girl'
/** 角色 id 合法字符集（URL 路径安全；与 verify-assets 门禁一致）。 */
export const ROLE_ID_RE = /^[a-z0-9-]+$/

/** 从 manifest 提取角色索引：旧 `states` 简写 → 单角色。返回 { characters, defaultId }。 */
export function parseCharacters(manifest) {
  const raw = manifest?.characters
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const characters = {}
    for (const [id, ch] of Object.entries(raw)) {
      if (ch === null || typeof ch !== 'object') continue
      characters[id] = {
        id,
        name: typeof ch.name === 'string' ? ch.name : id,
        names: ch.names !== null && typeof ch.names === 'object' && !Array.isArray(ch.names) ? ch.names : undefined,
        credit: typeof ch.credit === 'string' ? ch.credit : undefined,
        meta: ch.meta !== null && typeof ch.meta === 'object' ? ch.meta : {},
        states: ch.states !== null && typeof ch.states === 'object' ? ch.states : {},
      }
    }
    const defaultId = typeof manifest.default === 'string' && manifest.default in characters
      ? manifest.default
      : Object.keys(characters)[0] ?? DEFAULT_ROLE_ID
    return { characters, defaultId }
  }
  // 旧格式：顶层 states = whale-girl 单角色
  return {
    characters: {
      [DEFAULT_ROLE_ID]: {
        id: DEFAULT_ROLE_ID,
        name: DEFAULT_ROLE_ID,
        credit: undefined,
        meta: {},
        states: manifest?.states !== null && typeof manifest?.states === 'object' ? manifest.states : {},
      },
    },
    defaultId: DEFAULT_ROLE_ID,
  }
}

/** 角色 id 列表（按 manifest 声明顺序）。 */
export function listCharacters(manifest) {
  return Object.keys(parseCharacters(manifest).characters)
}

/** 默认角色 id。 */
export function defaultCharacter(manifest) {
  return parseCharacters(manifest).defaultId
}

/** 取角色；不存在返回 null。 */
export function getCharacter(manifest, id) {
  return parseCharacters(manifest).characters[id] ?? null
}

/** 角色显示名：当前 locale 的 names 优先，回退 manifest.name，再回退 id。 */
export function characterName(character, locale = 'zh') {
  const base = typeof character?.name === 'string' && character.name !== '' ? character.name : character?.id
  const localized = character?.names?.[normalizeLocale(locale)]
  return typeof localized === 'string' && localized !== '' ? localized : (base ?? '')
}

/**
 * 状态动画集：角色 states 里取；缺 → undefined（调用方渲染占位符+警告——
 * 不再 emoji 降级；verify-assets 门禁保证 manifest 必含全部 15 状态）。
 */
export function stateOf(character, stateName) {
  return character?.states?.[stateName]
}

/** 状态是否合法（在权威状态集合内）。 */
export function isKnownState(stateName) {
  return STATE_NAMES.includes(stateName)
}
