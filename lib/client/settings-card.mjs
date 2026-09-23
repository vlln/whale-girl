// whale-girl 设置面板卡片（client half，React）——设置 → 插件 槽（settings.plugin.item，
// 官方 ui-settings-plugins 声明；rc.8 契约为 keyed 槽，key = 设置命名空间 'whale-girl'）。
// 契约（plugin-registry make-dsh-plugin skill 的 settings-panel.md）：
// - 注册：ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name, key, locale,
//   inject }, Card))——keyed 槽缺 key 启动即抛；key 与 Node half 的 settings.register 命名空间
//   同名，否则卡片永不出现。
// - 传输：ctx.settingsScope.bind({namespace})，revision-fenced 文档变更（set 单字段）；
//   语义在 settings-form.mjs（对齐官方 CardForm：edit 暂存 → save 提交 → discard 丢弃）。
// - 官方没有 Switch 组件：自绘轨道/滑块（开 brand-primary / 关 border-l2+bg-layer-2，滑块
//   label-primary-inverted，focus 环 interactive-bg-hover，role="switch"+aria-checked）。
// - locale 独立命名空间 settings.whale-girl（zh/en 两套，与 README 行为描述一致）。
// - 快照引用稳定由 settings-form.mjs 的 WhaleSettingsForm 保证（React #185 血泪）。
// 纯 DOM 卡片不可行：槽渲染方是 React（web-react 的 SlotOutlet），组件必须是 React 组件；
// react 由平台种子表提供（esbuild --external:react，bundle 内 require('react')）。

import React from 'react'
import { CARD_FIELDS, parseLines, serializeLines, WhaleSettingsForm } from './settings-form.mjs'

/** 卡片 locale 命名空间（独立于设置命名空间 'whale-girl'）。 */
export const SETTINGS_NS = 'settings.whale-girl'

/** 卡片文案（zh/en；与 README 配置节行为描述保持一致）。 */
export const zh = {
  title: '鲸鱼娘',
  description: '尺寸、透明度、游走与回话文案（保存即生效）',
  unsaved: '未保存',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '本次保存未全部生效，已保留供你修改。',
  readOnly: '当前部署只读，无法修改。',
  collapse: '收起',
  expand: '展开',
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
  description: 'Size, opacity, wandering and reply copy — saves live',
  unsaved: 'Unsaved',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The deployment did not accept all values; they were left for you to correct.',
  readOnly: 'This deployment is read-only.',
  collapse: 'Collapse',
  expand: 'Expand',
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

/** 官方质感自绘 Switch（无官方组件；语义 role="switch" + aria-checked）。 */
function Switch({ checked, disabled, label, onChange }) {
  const [focused, setFocused] = React.useState(false)
  return el('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    disabled,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onClick: () => { onChange(!checked) },
    style: {
      flex: 'none', width: 34, height: 20, borderRadius: 999, border: '1px solid',
      cursor: disabled ? 'not-allowed' : 'pointer', appearance: 'none', padding: 0,
      position: 'relative', boxSizing: 'border-box', transition: 'background .16s, border-color .16s',
      background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
      borderColor: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
      opacity: disabled ? 0.4 : 1,
      outline: focused ? '2px solid var(--dsw-alias-interactive-bg-hover)' : 'none',
      outlineOffset: 2,
    },
  }, el('span', {
    style: {
      position: 'absolute', top: 2, left: checked ? 16 : 2, width: 14, height: 14,
      borderRadius: 999, background: 'var(--dsw-alias-label-primary-inverted)',
      transition: 'left .16s',
    },
  }))
}

/** 数字输入（本地文本暂存，失焦/回车提交解析后的值；解析失败回退当前值）。 */
function NumberField({ value, min, max, step, disabled, label, onChange }) {
  const initial = value === undefined || value === null ? '' : String(value)
  const [text, setText] = React.useState(initial)
  const [lastKey, setLastKey] = React.useState(initial)
  // 渲染期同步：外部值变化（保存生效/他端写入）时重置文本；lastKey 防重渲循环。
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
  return el('input', {
    type: 'number', value: text, min, max, step, disabled,
    'aria-label': label,
    onChange: (e) => { setText(e.target.value) },
    onBlur: commit,
    onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur() },
    style: {
      flex: 'none', width: 104, padding: '4px 8px', borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13,
      textAlign: 'right', boxSizing: 'border-box', opacity: disabled ? 0.4 : 1,
    },
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
      flex: 'none', width: 220, padding: '4px 8px', borderRadius: 8, resize: 'vertical',
      border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 12,
      lineHeight: 1.5, boxSizing: 'border-box', opacity: disabled ? 0.4 : 1,
    },
  })
}

/** 设置 → 插件 卡片（keyed 槽组件；chrome 对齐官方 BashCard/AgentLoopCard：折叠头 +
 * 未保存徽章 + 字段行 + 保存/放弃脚注；dsw alias tokens 从应用 CSS 取）。 */
export function WhaleSettingsCard(props) {
  const state = props.useWhaleSettings((s) => s)
  const [open, setOpen] = React.useState(false)
  const [hover, setHover] = React.useState(false)
  if (!state.available) return null
  const disabled = !state.writable
  const blocked = !state.dirty || state.saving
  const t = props.t

  const row = (def, index) => {
    const control = def.kind === 'toggle'
      ? el(Switch, { checked: state.fields[def.path] === true, disabled, label: t(def.labelKey), onChange: (checked) => { props.edit(def.path, checked) } })
      : def.kind === 'number'
        ? el(NumberField, { value: state.fields[def.path], min: def.min, max: def.max, step: def.step, disabled, label: t(def.labelKey), onChange: (value) => { props.edit(def.path, value) } })
        : el(LinesField, { value: state.fields[def.path], disabled, label: t(def.labelKey), onChange: (lines) => { props.edit(def.path, lines) } })
    return el('div', {
      key: def.path,
      style: {
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
        borderBottom: index < CARD_FIELDS.length - 1 ? '1px solid var(--dsw-alias-border-l1)' : 'none',
      },
    }, el('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
      el('span', { style: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' } }, t(def.labelKey)),
      el('span', { style: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'pre-line' } }, t(`${def.labelKey}.hint`)),
    ), control)
  }

  return el('li', {
    'data-whale-girl-settings-card': '',
    onMouseEnter: () => { setHover(true) },
    onMouseLeave: () => { setHover(false) },
    style: {
      listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
      background: open || hover ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
      borderColor: open || hover ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-border-l2)',
      transition: 'border-color .16s, background .16s', boxSizing: 'border-box',
    },
  },
  el('button', {
    type: 'button',
    'aria-expanded': open,
    'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`,
    onClick: () => { setOpen(!open) },
    style: {
      width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit',
      color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex',
      alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
    },
  },
  el('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
    el('span', { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' } }, t('title')),
    el('span', { style: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, t('description')),
  ),
  state.dirty
    ? el('span', {
      style: {
        flex: 'none', borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px',
        fontWeight: 500, whiteSpace: 'nowrap', background: 'var(--dsw-alias-bg-module-platform)',
        color: 'var(--dsw-alias-label-secondary)',
      },
    }, t('unsaved'))
    : null,
  el('span', { style: { flex: 'none', display: 'flex', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s', transform: open ? 'rotate(180deg)' : 'none' } },
    el('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, el('path', {
      d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    })),
  )),
  open
    ? el('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 } },
      disabled ? el('p', { role: 'status', style: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, t('readOnly')) : null,
      el('div', { style: { display: 'flex', flexDirection: 'column', padding: '12px 0', gap: 0 } },
        CARD_FIELDS.map((def, index) => row(def, index)),
      ),
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l2)' } },
        state.failed ? el('p', { role: 'status', style: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' } }, t('saveFailed')) : null,
        el('button', {
          type: 'button', disabled: blocked, onClick: () => { props.discard() },
          style: {
            appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
            padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer',
            background: 'transparent', color: 'var(--dsw-alias-label-primary)', opacity: blocked ? 0.4 : 1,
          },
        }, t('discard')),
        el('button', {
          type: 'button', disabled: blocked, onClick: () => { void props.save() },
          style: {
            appearance: 'none', border: '1px solid transparent', borderRadius: 8,
            padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer',
            background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)',
            opacity: blocked ? 0.4 : 1,
          },
        }, state.saving ? t('saving') : t('save')),
      ),
    )
    : null,
  )
}

/**
 * 注册设置卡片（keyed 槽 + locale）。返回 disposer（随 apply dispose 调用）；
 * settingsScope 服务缺席（0907+ dsh 设置模型改版后不存在）返回 null——卡片跳过，
 * 配置面由宿主从 Node half Config schema 自动生成的表单接管。
 * @param {object} ctx 浏览器 half 上下文（inject 声明 slots/locale）
 * @param {string} namespace 设置命名空间（Node half Config 同名，= 卡片 key）
 * @param {object} defaults 叶默认值兜底（index.mjs 传 CFG_DEFAULTS）
 */
export function registerWhaleSettingsCard(ctx, namespace, defaults) {
  if (typeof ctx.settingsScope !== 'object' || ctx.settingsScope === null) return null
  const scope = ctx.settingsScope.bind({ namespace })
  const form = new WhaleSettingsForm(scope, defaults)
  const offLocale = ctx.locale.register(SETTINGS_NS, { zh, en })
  // slots.inject：等槽声明（ui-settings-plugins 的 ConfigurablePluginsTab 挂载）后注册，
  // 声明方卸载时自动移除；先注册 locale 再注册槽（t 解析需字典在位）。
  const offSlot = ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      key: namespace,
      locale: SETTINGS_NS,
      inject: () => ({
        hooks: {
          whaleSettings: { getSnapshot: form.getSnapshot, subscribe: form.subscribe },
        },
        edit: form.edit,
        save: form.save,
        discard: form.discard,
      }),
    }, WhaleSettingsCard))
  return () => { offSlot(); offLocale() }
}