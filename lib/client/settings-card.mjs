// whale-girl 设置面板卡片（client half，React）——挂在「设置 → 内置插件」的标签页
// （settings.plugins.tab，官方 ui-settings-plugins 声明为 children 列表槽）。
//
// 注册契约（DSH 0.2.x）：ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
//   { name, id, order, label, locale, inject }, Card))——id 唯一；inject 返回的 hooks 成为
//   props.use<Key>，其余键成为普通 props。
// 传输契约：ctx.configForms.get(条目 id)，由官方 @deepseek-ai/dsh-client-ui-settings 提供；
//   0.2.x 把插件设置统一为「插件自身的 Cordis Config」（Node half 导出 volatile Config），
//   以 profile 条目 id（= 'whale-girl'）为键。ConfigFormController 的快照形状
//   { status, value, writable, … } 与 set(field, value) 正好匹配本表单的既有接口。
//   （0.1.x 的 ctx.settingsScope 在 0.2.x 已整个移除。）
//
// 视觉契约（DSH 设计标准）：**控件一律取自官方 @deepseek-ai/dsh-client-ui-primitives**，
// 该库 README 明确禁止复制库内已有控件；本文件此前自绘的开关即属违规：
//   - 开关 → 官方 Switch。官方用 `corner-shape: round` 退出全局超椭圆（superellipse），
//     自绘版只写 borderRadius:999 没有这个 opt-out，圆滑块会被渲染成圆角方块。
//   - 数字输入 → 官方 Input（其 style 转发给内层 input）。
//   - 按钮 → 官方 Button（outline 放弃修改 / primary 保存）。
//   - 卡片底色与描边 → 官方设置面板专用 token settings-card-fill / settings-card-stroke；
//     圆角用 --dsw-radius-lg，分隔线用 0.5px border-l2（对齐官方字段行规范）。
// 仍为自绘的只有两处，均为官方确无对应控件者（库 README 允许「需求确实特殊」时自绘）：
//   - 字段行布局：官方自身也在功能包内自绘行（见 ui-theme 的 FontSizeRow），控件仍取官方件。
//   - 多行文案池：官方无「Enter 换行」语义的多行控件（InlineEditor 是 Enter 提交，与
//     逐行编辑冲突）。
// 卡片形态（名称在上、描述在下）沿用官方 README 认定的先例（ui-settings-plugins 的 PluginCard）。
//
// locale 独立命名空间 settings.whale-girl（zh/en 两套）。
// react 与 primitives 均由平台种子表提供（esbuild 声明为 external，bundle 内 require）。

import React from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
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
        borderBottom: index < CARD_FIELDS.length - 1 ? '0.5px solid var(--dsw-alias-border-l2)' : 'none',
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
      listStyle: 'none', border: '1px solid var(--dsw-alias-settings-card-stroke)',
      borderRadius: 'var(--dsw-radius-lg)', background: 'var(--dsw-alias-settings-card-fill)',
      borderColor: open || hover ? 'var(--dsw-alias-border-l3)' : 'var(--dsw-alias-settings-card-stroke)',
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
    ? el('div', { style: { borderTop: '0.5px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 } },
      disabled ? el('p', { role: 'status', style: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, t('readOnly')) : null,
      el('div', { style: { display: 'flex', flexDirection: 'column', padding: '12px 0', gap: 0 } },
        CARD_FIELDS.map((def, index) => row(def, index)),
      ),
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
        state.failed ? el('p', { role: 'status', style: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' } }, t('saveFailed')) : null,
        el(Button, {
          variant: 'outline', size: 'sm', disabled: blocked,
          onClick: () => { props.discard() },
        }, t('discard')),
        el(Button, {
          variant: 'primary', size: 'sm', disabled: blocked,
          onClick: () => { void props.save() },
        }, state.saving ? t('saving') : t('save')),
      ),
    )
    : null,
  )
}

/**
 * 注册设置卡片（settings.plugins.tab 列表槽 + locale）。返回 disposer（随 apply dispose 调用）。
 * @param {object} ctx 浏览器 half 上下文（inject 声明 slots/locale/configForms）
 * @param {string} namespace 设置命名空间 = profile 条目 id（0.2.x 的表单键）
 * @param {object} defaults 叶默认值兜底（index.mjs 传 CFG_DEFAULTS）
 */
export function registerWhaleSettingsCard(ctx, namespace, defaults) {
  const scope = ctx.configForms.get(namespace)
  const form = new WhaleSettingsForm(scope, defaults)
  const offLocale = ctx.locale.register(SETTINGS_NS, { zh, en })
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