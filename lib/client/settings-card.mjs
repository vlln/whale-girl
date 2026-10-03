// whale-girl 设置面板卡片（client half，React）——挂在「设置 → 内置插件」的标签页
// （settings.plugins.tab，官方 ui-settings-plugins 声明为 children 列表槽）。
//
// 注册契约（DSH 0.2.x）：ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
//   { name, id, order, label, locale, inject }, Card))——id 唯一；inject 返回的 hooks 成为
//   props.use<Key>，其余键成为普通 props。
// 传输契约：ctx.configForms.get(条目 id)，由官方 client settings 包提供；0.2.x 把插件设置
//   统一为「插件自身的 Cordis Config」（Node half 导出 volatile Config），以 profile 条目 id
//   （= 'whale-girl'）为键。快照形状 { status, value, writable, … } + set(field, value)
//   即本卡片的全部数据面。（0.1.x 的 ctx.settingsScope 在 0.2.x 已整个移除。）
//
// 保存语义（对齐官方通用设置页）：**改动即时写入，没有保存/放弃按钮，也没有折叠**——
//   官方通用设置页的开关、数字、选项都是「改即落库」（其 README 对开关的原文是
//   "follows accepted changes immediately, and disables duplicate input while a write
//   settles"），而 SettingsForm 那套「页脚保存」只属于部分官方页面。本卡片跟随前者：
//   - 开关：点击即写。
//   - 数字 / 文案池：本地缓冲，失焦或回车即写（不做逐键写入）。
//   写入失败时卡片底部显示一条提示；值以宿主回读的快照为准（不会停留在未落库的输入上）。
//
// 视觉契约（DSH 设计标准）：控件一律取自官方 @deepseek-ai/dsh-client-ui-primitives——
//   开关用官方 Switch（其自带 `corner-shape: round`，退出主题层的全局超椭圆，否则滑块会被
//   渲染成圆角方块）、数字用官方 Input、卡片底色/描边用设置面板专用 token
//   settings-card-fill / settings-card-stroke，圆角 --dsw-radius-lg，字段行分隔线
//   0.5px border-l2。仍为自绘的只有字段行布局与多行文案池（官方无「Enter 换行」语义的
//   多行控件；InlineEditor 是 Enter 提交）。
//
// 字段规格与派生在 ./settings-fields.mjs（纯函数，被 tests/settings-fields.test.mjs 守住）。
// locale 独立命名空间 settings.whale-girl（zh/en 两套）。
// react 与 primitives 均由平台种子表提供（esbuild 声明为 external，bundle 内 require）。

import React from 'react'
import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CARD_FIELDS, deriveState, parseLines, serializeLines, writeField } from './settings-fields.mjs'

/** 卡片 locale 命名空间（独立于设置命名空间 'whale-girl'）。 */
export const SETTINGS_NS = 'settings.whale-girl'

/** 卡片文案（zh/en；与 README 配置节行为描述保持一致）。 */
export const zh = {
  title: '鲸鱼娘',
  description: '尺寸、透明度、游走与回话文案（改动即时生效）',
  writeFailed: '刚才的改动未被接受，已回读当前值。',
  readOnly: '当前部署只读，无法修改。',
  enabled: '网页端显示',
  'enabled.hint': '关闭后网页端宠物不渲染（桌面伴侣并存时用）。',
  size: '尺寸',
  'size.hint': '宠物绘制尺寸（64–160 px）。',
  opacity: '透明度',
  'opacity.hint': '常态透明度（0.2–1）。',
  walk: '游走',
  'walk.hint': '关闭后宠物不再四处游走。',
  sleep: '睡眠等待',
  'sleep.hint': '空闲多久进入睡眠（毫秒）。',
  feed: '投喂回话',
  'feed.hint': '每行一条，空行忽略；清空回退内置文案。',
  play: '玩耍回话',
  'play.hint': '每行一条，空行忽略；清空回退内置文案。',
}

export const en = {
  title: 'Whale Girl',
  description: 'Size, opacity, wandering and reply copy — applied live',
  writeFailed: 'The deployment did not accept that change; the current value was read back.',
  readOnly: 'This deployment is read-only.',
  enabled: 'Show on page',
  'enabled.hint': 'Off hides the in-page pet (e.g. while a desktop companion runs).',
  size: 'Size',
  'size.hint': 'Pet render size (64–160 px).',
  opacity: 'Opacity',
  'opacity.hint': 'Default opacity (0.2–1).',
  walk: 'Wander',
  'walk.hint': 'Off stops the pet wandering.',
  sleep: 'Sleep delay',
  'sleep.hint': 'Idle time before sleeping (ms).',
  feed: 'Feed replies',
  'feed.hint': 'One per line, empty lines ignored; empty falls back to built-in copy.',
  play: 'Play replies',
  'play.hint': 'One per line, empty lines ignored; empty falls back to built-in copy.',
}

const el = React.createElement


/** 数字输入（本地文本缓冲，失焦/回车提交解析后的值；解析失败回退当前值）。 */
function NumberField({ value, min, max, step, disabled, label, onChange }) {
  const initial = value === undefined || value === null ? '' : String(value)
  const [text, setText] = React.useState(initial)
  const [lastKey, setLastKey] = React.useState(initial)
  // 渲染期同步：外部值变化（写成功回读/他端写入）时重置文本；lastKey 防重渲循环。
  if (initial !== lastKey) {
    setLastKey(initial)
    setText(initial)
  }
  const commit = () => {
    const parsed = Number(text)
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      setText(initial)
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    onChange(clamped)
    if (clamped !== parsed) setText(String(clamped))
  }
  // 官方 Input：外框规范由库负责（高 32 / 0.5px border-l4 / radius-md / bg-layer-1），
  // style 转发给内层 input，故宽度与右对齐在此指定。范围校验仍由上面的 commit 做。
  return el(Input, {
    type: 'text',
    inputMode: 'numeric',
    value: text,
    disabled,
    'aria-label': label,
    onChange: (e) => { setText(e.target.value) },
    onBlur: commit,
    onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur() },
    style: { width: 88, textAlign: 'right' },
  })
}

/** 文案池输入（textarea，每行一条；失焦提交 parseLines 结果）。 */
function LinesField({ value, disabled, label, onChange }) {
  const initial = serializeLines(value)
  const [text, setText] = React.useState(initial)
  const [lastKey, setLastKey] = React.useState(initial)
  if (initial !== lastKey) {
    setLastKey(initial)
    setText(initial)
  }
  return el('textarea', {
    rows: 3,
    value: text,
    disabled,
    'aria-label': label,
    onChange: (e) => { setText(e.target.value) },
    onBlur: () => { onChange(parseLines(text)) },
    style: {
      flex: 'none', width: 240, padding: '6px 8px', resize: 'vertical',
      border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: 'var(--dsw-radius-md)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 14,
      lineHeight: 1.5, boxSizing: 'border-box', opacity: disabled ? 0.4 : 1,
    },
  })
}

/** 设置 → 插件 卡片（keyed 槽组件）：标题 + 描述 + 字段行，改动即时写入。
 * 没有折叠（本卡片就是该标签页的全部内容）、没有保存/放弃脚注（见文件头保存语义）。 */
export function WhaleSettingsCard(props) {
  const state = props.useWhaleSettings((s) => s)
  const [failed, setFailed] = React.useState(false)
  if (!state.available) return null
  const disabled = !state.writable
  const t = props.t

  // 即时写入：失败不清空输入（值以宿主回读的快照为准），只在底部提示一次。
  const commit = (def, value) => {
    setFailed(false)
    Promise.resolve(props.write(def.path, value)).catch(() => { setFailed(true) })
  }

  const row = (def, index) => {
    const control = def.kind === 'toggle'
      ? el(Switch, { checked: state.fields[def.path] === true, disabled, label: t(def.labelKey), onChange: (checked) => { commit(def, checked) } })
      : def.kind === 'number'
        ? el(NumberField, { value: state.fields[def.path], min: def.min, max: def.max, step: def.step, disabled, label: t(def.labelKey), onChange: (value) => { commit(def, value) } })
        : el(LinesField, { value: state.fields[def.path], disabled, label: t(def.labelKey), onChange: (lines) => { commit(def, lines) } })
    return el('div', {
      key: def.path,
      style: {
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
        borderBottom: index < CARD_FIELDS.length - 1 ? '0.5px solid var(--dsw-alias-border-l2)' : 'none',
      },
    }, el('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
      el('span', { style: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' } }, t(def.labelKey)),
      el('span', { style: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'pre-line' } }, t(`${def.labelKey}.hint`)),
    ), control)
  }

  return el('li', {
    'data-whale-girl-settings-card': '',
    style: {
      listStyle: 'none', border: '1px solid var(--dsw-alias-settings-card-stroke)',
      borderRadius: 'var(--dsw-radius-lg)', background: 'var(--dsw-alias-settings-card-fill)',
      boxSizing: 'border-box',
    },
  },
  el('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px 0' } },
    el('span', { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' } }, t('title')),
    el('span', { style: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, t('description')),
  ),
  el('div', { style: { borderTop: '0.5px solid var(--dsw-alias-border-l2)', margin: '12px 16px 12px' } },
    disabled ? el('p', { role: 'status', style: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, t('readOnly')) : null,
    el('div', { style: { display: 'flex', flexDirection: 'column', padding: '12px 0 0', gap: 0 } },
      CARD_FIELDS.map((def, index) => row(def, index)),
    ),
    failed ? el('p', { role: 'status', style: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' } }, t('writeFailed')) : null,
  ))
}

/**
 * 注册设置卡片（settings.plugins.tab 列表槽 + locale）。返回 disposer（随 apply dispose 调用）。
 * @param {object} ctx 浏览器 half 上下文（inject 声明 slots/locale/configForms）
 * @param {string} namespace 设置命名空间 = profile 条目 id（0.2.x 的表单键）
 * @param {object} defaults 叶默认值兜底（index.mjs 传 CFG_DEFAULTS）
 */
export function registerWhaleSettingsCard(ctx, namespace, defaults) {
  const scope = ctx.configForms.get(namespace)
  const offLocale = ctx.locale.register(SETTINGS_NS, { zh, en })
  // 快照引用必须稳定：hooks 走 useSyncExternalStore，内容未变时返回同一对象，
  // 否则无限重渲（React #185）。宿主每次变更替换快照对象，故按对象身份缓存。
  let cache
  const getSnapshot = () => {
    const snap = scope.getSnapshot()
    if (cache !== undefined && cache.snap === snap) return cache.state
    cache = { snap, state: deriveState(snap, defaults) }
    return cache.state
  }
  // 0.2.x：列表槽 settings.plugins.tab（「设置 → 内置插件」下的标签页）。id 用设置
  // 命名空间（= profile 条目 id），label 由本卡片的 locale 字典解析。
  const offSlot = ctx.slots.inject('settings.plugins.tab', () =>
    ctx.slots.register({
      name: 'settings.plugins.tab',
      id: namespace,
      order: 30,
      label: () => ctx.locale.bind(SETTINGS_NS)('title'),
      locale: SETTINGS_NS,
      inject: () => ({
        hooks: { whaleSettings: { getSnapshot, subscribe: (listener) => scope.subscribe(listener) } },
        write: (path, value) => writeField(scope, path, value),
      }),
    }, WhaleSettingsCard))
  return () => { offSlot(); offLocale() }
}
