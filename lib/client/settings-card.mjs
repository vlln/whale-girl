// whale-girl 包页配置卡片（client half，React）——官方 plugins.bundle.config 槽（keyed 槽，
// key = bundle 包名；dsh-client-ui-plugin-manager 声明），渲染在 Plugins 页 whale-girl 包页
// 的描述与行清单之间。该槽是自有 bundle 的配置位；`plugins.item` 是安装自带官方设置页的语义位，
// 第三方插件占它会被列进「官方」组（见 decisions/implemented/bug-fix/2026-10-04-settings-card-bundle-slot.md）。
// 页面只请求 page 视图：chrome（图标/标题/描述）由包页画，本组件只画字段区。
//
// 契约（client 半运行时缝）：
// - 注册：ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name, key,
//   locale, inject }, Card))——keyed 槽缺 key 启动即抛；key 必须等于 bundle 包名（whale-girl）
//   才会出现在包页，同时等于 Node half 的配置命名空间。
//   注册经 configForms.whileServed([namespace])：宿主不服务该命名空间时不注册，不给空卡片。
// - 传输：ctx.configForms.get(namespace)（官方 ConfigFormController，revision-fenced 文档
//   变更；写走 mutate 深路径 + CAS revision，见 settings-fields.mjs）。
//
// 保存语义（对齐官方通用设置页）：**改动即时写入，没有保存/放弃按钮**——官方通用设置页的开关、
// 数字、选项都是「改即落库」（其 README 对开关的原文是 "follows accepted changes immediately,
// and disables duplicate input while a write settles"），而 SettingsForm 那套「页脚保存」只属于
// 部分官方页面。本卡片跟随前者：
//   - 开关：点击即写。
//   - 数字 / 文案池：本地缓冲，失焦或回车即写（不做逐键写入）。
//   写入未被接受时字段区下方显示一条提示；值以宿主回读的快照为准（不会停留在未落库的输入上）。
//
// 视觉契约（DSH 设计标准）：控件一律取自官方 @deepseek-ai/dsh-client-ui-primitives——
//   开关用官方 Switch（其自带 `corner-shape: round`，退出主题层的全局超椭圆，否则圆滑块会被
//   渲染成圆角方块）、数字用官方 Input；字段行分隔线统一 0.5px border-l2，文案池 textarea 按
//   官方输入框规范重排（0.5px border-l4 / radius-md / bg-layer-1 / 14px）。卡片底色与描边不属于
//   本组件——`plugins.bundle.config` 的卡片 chrome 由包页画。
// 仍为自绘的只有两处，均为官方确无对应控件者：字段行布局（官方自身也在功能包内自绘行——
//   ui-theme 的 FontSizeRow 即先例，控件仍取官方件）与多行文案池（库内无「Enter 换行」语义的
//   多行控件；InlineEditor 是 Enter 提交，与逐行编辑语义冲突）。
//
// 字段规格与派生在 ./settings-fields.mjs（纯函数，被 tests/settings-fields.test.mjs 守住）。
// 纯 DOM 卡片不可行：槽渲染方是 React（web-react 的 SlotOutlet），组件必须是 React 组件；
// react 与 primitives 均由平台种子表提供（esbuild 声明为 external，bundle 内 require）。

import React from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CARD_FIELDS, deriveState, parseLines, serializeLines, writeField } from './settings-fields.mjs'
import { ROW_INITIAL, deriveUpdateRow, outcomeOf, reduceRow } from './update-state.mjs'
import { UPDATE_PATH } from '../src/routes.mjs'

import { SETTINGS_NS, zh, en, ru } from './settings-text.mjs'
export { SETTINGS_NS, zh, en, ru }

const el = React.createElement

/** 数字输入（本地文本缓冲，失焦/回车提交解析后的值；解析失败回退当前值）。 */
function NumberField({ value, min, max, step, disabled, label, onChange, resetToken }) {
  const initial = value === undefined || value === null ? '' : String(value)
  const [text, setText] = React.useState(initial)
  const [lastKey, setLastKey] = React.useState(initial)
  const [lastReset, setLastReset] = React.useState(resetToken)
  // 渲染期同步：外部值变化（写成功回读/他端写入）或写入被拒（resetToken 递增）时重置文本；
  // 被拒时宿主值不变，只有 resetToken 能触发回读——否则输入会停在未落库的内容上。
  if (initial !== lastKey || resetToken !== lastReset) {
    setLastKey(initial)
    setLastReset(resetToken)
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
function LinesField({ value, disabled, label, onChange, resetToken }) {
  const initial = serializeLines(value)
  const [text, setText] = React.useState(initial)
  const [lastKey, setLastKey] = React.useState(initial)
  const [lastReset, setLastReset] = React.useState(resetToken)
  // 同 NumberField：被拒时宿主值不变，靠 resetToken 把输入回读成宿主值。
  if (initial !== lastKey || resetToken !== lastReset) {
    setLastKey(initial)
    setLastReset(resetToken)
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

/**
 * 更新行（配置卡片首行）：状态 + 按钮，检查上游并在有新版时执行更新。
 * 刻意不再显示一遍当前版本——包页的「来源信息」已经由页面画出所装版本与安装来源，这里只补
 * 页面没有的那件事：上游有没有新版、以及一键更新。有新版时状态行给出目标（git 装短提交、
 * registry 装版本号）。更新动作由 Node half 交给宿主的 profile 包管理服务完成（拿 profile 写锁、
 * 跑 pnpm、失败时回滚 manifest 与锁文件），这里只发起请求与呈现状态。文案跟随 macOS 的
 * 「检查更新…」约定：动词 + 省略号表示会有一段进行中的操作；版本号原样显示（不额外加 v）。
 */
function UpdateRow({ t }) {
  // 状态迁移走纯函数（reduceRow）：组件只派发事件，不再手工同步几个 useState——漏设一次就差状态/差色。
  const [row, setRow] = React.useState(ROW_INITIAL)
  const dispatch = (event) => { setRow((state) => reduceRow(state, event)) }
  const labelId = React.useId()
  const statusId = React.useId()

  const load = React.useCallback(async () => {
    setRow((state) => reduceRow(state, { type: 'check-started' }))
    try {
      const response = await fetch(UPDATE_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const info = await response.json()
      setRow((state) => reduceRow(state, { type: 'checked', info }))
    } catch {
      setRow((state) => reduceRow(state, { type: 'check-failed' }))
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const run = async () => {
    dispatch({ type: 'update-started' })
    try {
      const response = await fetch(UPDATE_PATH, { method: 'POST', headers: { accept: 'application/json' } })
      const payload = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      // 宿主的应用结果是权威：失败/取消不该显示成「已更新」，热发布也不该提示重启。
      dispatch({ type: 'settled', ...outcomeOf(payload, t) })
    } catch {
      // 请求本身失败也要按失败呈现（含报错色）。
      dispatch({ type: 'settled', phase: 'ready', notice: t('updateFailed'), tone: 'error' })
    }
  }

  const { status, tone, action } = deriveUpdateRow({ ...row, translate: t, onCheck: load, onUpdate: run })

  return el('div', {
    'data-whale-girl-update': '',
    role: 'group',
    'aria-labelledby': labelId,
    'aria-describedby': statusId,
    style: {
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
      borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
    },
  },
  el('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
    el('span', { id: labelId, style: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' } }, t('update')),
    el('span', {
      id: statusId,
      role: 'status',
      style: {
        fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-line',
        color: tone === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)',
      },
    }, status),
  ),
  el('span', { style: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8 } },
    el(Button, {
      variant: action.primary === true ? 'primary' : 'outline',
      size: 'sm',
      disabled: action.disabled,
      'aria-describedby': statusId,
      onClick: () => { void action.run() },
    }, action.label),
  ))
}

/** 包页配置表单（plugins.bundle.config 槽组件；包页画图标/标题/描述，
 * 本组件只画 page 的字段区；改动即时写入，无保存脚注）。 */
export function WhaleSettingsCard(props) {
  // hooks 先于视图分支（React 钩子顺序稳定）。包页只请求 page；summary 保留一行描述的兜底，
  // 防宿主在别处以 summary 渲染同一注册。
  const state = props.useWhaleSettings((s) => s)
  const [failed, setFailed] = React.useState(false)
  const [resetToken, setResetToken] = React.useState(0)
  const t = props.t
  if (props.view === 'summary') return t('description')
  if (!state.available) return null
  const disabled = !state.writable

  // 即时写入：未获接受时在字段区下方提示一次，并递增 resetToken 让文本输入回读宿主值
  // （开关由快照派生，自动回位）。
  const commit = (def, value) => {
    setFailed(false)
    Promise.resolve(props.write(def.path, value)).catch(() => {
      setFailed(true)
      setResetToken((n) => n + 1)
    })
  }

  const row = (def, index) => {
    const control = def.kind === 'toggle'
      ? el(Switch, { checked: state.fields[def.path] === true, disabled, label: t(def.labelKey), onChange: (checked) => { commit(def, checked) } })
      : def.kind === 'number'
        ? el(NumberField, { value: state.fields[def.path], min: def.min, max: def.max, step: def.step, disabled, label: t(def.labelKey), onChange: (value) => { commit(def, value) }, resetToken })
        : el(LinesField, { value: state.fields[def.path], disabled, label: t(def.labelKey), onChange: (lines) => { commit(def, lines) }, resetToken })
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

  return el('div', {
    'data-whale-girl-settings-card': '',
    style: { display: 'flex', flexDirection: 'column', boxSizing: 'border-box' },
  },
  disabled ? el('p', { role: 'status', style: { margin: '0 0 8px', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, t('readOnly')) : null,
  el('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
    el(UpdateRow, { key: 'update', t }),
    CARD_FIELDS.map((def, index) => row(def, index)),
  ),
  failed ? el('p', { role: 'status', style: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)' } }, t('writeFailed')) : null,
  )
}

/**
 * 注册包页配置卡片（`plugins.bundle.config` keyed 槽 + locale）。返回 disposer（随 apply dispose 调用）。
 * @param {object} ctx 浏览器 half 上下文（inject 声明 slots/locale/configForms）
 * @param {string} namespace 设置命名空间（= 条目 id，配置读写用）
 * @param {object} defaults 叶默认值兜底（index.mjs 传 CFG_DEFAULTS）
 */
export function registerWhaleSettingsCard(ctx, namespace, defaults) {
  const scope = ctx.configForms.get(namespace)
  const offLocale = ctx.locale.register(SETTINGS_NS, { zh, en, ru })
  // 快照引用必须稳定：hooks 走 useSyncExternalStore，内容未变时返回同一对象，
  // 否则无限重渲（React #185）。宿主每次变更替换快照对象，故按对象身份缓存。
  let cache
  const getSnapshot = () => {
    const snap = scope.getSnapshot()
    if (cache !== undefined && cache.snap === snap) return cache.state
    cache = { snap, state: deriveState(snap, defaults) }
    return cache.state
  }
  // 注册经 whileServed：命名空间进宿主 describe 镜像后才注册（宿主不服务该命名空间时不留配置区），
  // 离开后自动移除。slots.inject 等槽声明（插件管理页挂载）后注册。
  // 槽选 plugins.bundle.config：自有 bundle 的配置位，key = 包名；plugins.item 只属于安装自带的
  // 官方设置页（占它会把第三方卡片列进「官方」组），故不用。
  const offServed = ctx.configForms.whileServed([namespace], () =>
    ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register({
        name: 'plugins.bundle.config',
        key: namespace, // keyed 槽：key 必须等于 bundle 包名才会渲染在包页
        locale: SETTINGS_NS,
        inject: () => ({
          hooks: { whaleSettings: { getSnapshot, subscribe: (listener) => scope.subscribe(listener) } },
          write: (path, value) => writeField(scope, path, value),
        }),
      }, WhaleSettingsCard)))
  return () => { offServed(); offLocale() }
}
