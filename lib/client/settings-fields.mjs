// 设置卡字段规格与派生（纯计算：零 React、零 DOM、零宿主依赖，可单测）。
//
// 契约：
// - `CARD_FIELDS` 是卡片字段的单一来源：叶路径 → 控件类型（toggle/number/lines）、范围、
//   以及「组字段」标记。组字段（`walk.enabled`、`replies.feed`）在界面上各占一行，但写入
//   必须整组替换——官方 `ConfigFormController` 的 `set` 只接受单段路径（`'walk.enabled'`
//   会字面落键），故由 `groupWrite` 合并成 `{ key, value }` 再提交。
// - `deriveState` 把 scope 快照派生成卡片渲染所需的 `{ available, writable, fields }`。
//   默认值不在此写第二份——由 index.mjs 传 `CFG_DEFAULTS`（verify-config-sync 门禁保证
//   其与 `src/config.mjs` 的 DEFAULTS 一致）。
// - 快照引用稳定性由调用方缓存（settings-card.mjs 的注册函数）：hooks 走
//   `useSyncExternalStore`，内容未变时必须返回同一对象，否则无限重渲（React #185）。
//
// 归属测试：tests/settings-fields.test.mjs（叶取值、组写入合并、快照派生、字段表完整性）。

/** 卡片字段表（path = 设置叶路径；labelKey = locale 文案键；组字段用 group 标注写入的顶层键）。
 * min/max/step 与 `src/config.mjs` 的 buildSchema clamp 对齐（界面边界，不是默认值）。 */
export const CARD_FIELDS = [
  { path: 'enabled', labelKey: 'enabled', kind: 'toggle' },
  { path: 'size', labelKey: 'size', kind: 'number', min: 64, max: 160, step: 1 },
  { path: 'opacity', labelKey: 'opacity', kind: 'number', min: 0.2, max: 1, step: 0.05 },
  { path: 'walk.enabled', labelKey: 'walk', kind: 'toggle', group: 'walk' },
  { path: 'sleepAfterMs', labelKey: 'sleep', kind: 'number', min: 5000, max: 600000, step: 1000 },
  { path: 'replies.feed', labelKey: 'feed', kind: 'lines', group: 'replies' },
  { path: 'replies.play', labelKey: 'play', kind: 'lines', group: 'replies' },
]

/** 按点分路径读叶值；路径段缺失返回 undefined。 */
export function leafOf(value, path) {
  let cur = value
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[seg]
  }
  return cur
}

/** 组字段的写入值：基于已提交组对象合并叶（幂等，不丢组内其他叶）。 */
export function groupWrite(committed, path, value) {
  const group = path.slice(0, path.indexOf('.'))
  const leaf = path.slice(path.indexOf('.') + 1)
  const base = (() => {
    const cur = committed === null || typeof committed !== 'object' ? undefined : committed[group]
    return cur !== null && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur } : {}
  })()
  return { key: group, value: { ...base, [leaf]: value } }
}

/** 文案池文本 ↔ 数组：按行拆分/trim/去空；行尾空行不产生空串。 */
export function parseLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function serializeLines(lines) {
  return (Array.isArray(lines) ? lines : []).join('\n')
}

/**
 * 由 scope 快照派生卡片状态。
 * @param {object} snap ConfigFormController 快照（{ status, value, writable, … }）
 * @param {object} defaults 叶默认值兜底（index.mjs 传 CFG_DEFAULTS）
 * @returns {{ available: boolean, writable: boolean, fields: Record<string, unknown> }}
 */
export function deriveState(snap, defaults) {
  const committed = snap.value ?? {}
  const fields = {}
  for (const def of CARD_FIELDS) {
    const fromCommitted = leafOf(committed, def.path)
    fields[def.path] = fromCommitted !== undefined ? fromCommitted : leafOf(defaults, def.path)
  }
  return {
    available: snap.status !== 'unavailable',
    writable: snap.writable === true,
    fields,
  }
}

/**
 * 立刻写入一个字段（即时保存语义：不暂存、无保存按钮）。
 * 组字段合并成整组对象再提交；其余按叶路径单键提交。
 * @param {object} scope ConfigFormController
 * @param {string} path 字段叶路径（CARD_FIELDS 的 path）
 * @param {unknown} value 新值
 * @returns {Promise<void>} 宿主接受/拒绝由调用方处理（失败时快照重读即当前真值）
 */
export function writeField(scope, path, value) {
  const def = CARD_FIELDS.find((candidate) => candidate.path === path)
  if (def !== undefined && def.group !== undefined) {
    const { key, value: next } = groupWrite(scope.getSnapshot().value ?? {}, path, value)
    return scope.set(key, next)
  }
  return scope.set(path, value)
}
