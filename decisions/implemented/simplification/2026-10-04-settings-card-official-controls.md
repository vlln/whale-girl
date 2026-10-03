# Decision: 设置卡控件改用官方 primitives（消除自绘开关的 superellipse 偏差）

Status: implemented

## Problem

设置卡的自绘控件与 DSH 设计体系不一致，用户实测反馈"切换开关不是圆的而是方的"。

根因不是手误，而是主题层的一个全局设定：`dsh-client-ui-theme` 启用 **superellipse（超椭圆）**
圆角（`superellipse` 字样只在主题包里出现），因此默认所有圆角都是"方圆"的。官方 `Switch`
为此在轨道与滑块上显式写 `corner-shape: round` 退出该设定：

```css
/* The capsule track and circular thumb opt out of the global superellipse. */
.switch { width: 36px; height: 20px; border-radius: 999px; corner-shape: round; }
.thumb  { width: 16px; height: 16px; border-radius: 50%;  corner-shape: round; }
```

本卡片的自绘开关只写了 `borderRadius: 999`，没有该 opt-out，于是"圆"滑块被渲染成**圆角方块**、
轨道端点也不足以成为胶囊。截图放大对比已确认这一差异。

更根本的问题：`@deepseek-ai/dsh-client-ui-primitives` 的 README 明确写着——

> Writing your own component in your own package is fine when the need is genuinely specific.
> **What is not fine is copying a control that already exists here** — and once a second package
> needs the same control, it belongs in this package.

而该库**确实提供** `Switch`、`Input`、`Button`。本文件的自绘开关与数字输入属于"复制库内已有控件"。
同理，卡片容器用的是通用 `border-l2`/`bg-layer-*` 与裸数值圆角 12，而 DSH 有**设置面板专用
token**：`--dsw-alias-settings-card-fill`、`--dsw-alias-settings-card-stroke`，圆角走
`--dsw-radius-*` 标度（xs4/sm8/md12/lg16/xl20/panel28）；字段分隔线与字段字号也没有对齐官方
字段行规范（0.5px `border-l2`、标签 13/500、提示 12 tertiary、输入框高 34 或 32 / 0.5px
`border-l4` / `radius-md`）。

## Decision

- **开关换用官方 `Switch`**。其 props（`checked`/`disabled`/`label`/`onChange`）与原自绘版逐一同名，
  调用点无需改动；`corner-shape: round` 由库负责，方形滑块问题从根上消失。
- **数字输入换用官方 `Input`**（其 `style` 转发给内层 `input`，故宽度与右对齐在调用侧指定，
  范围校验仍由本组件的失焦提交负责）。
- **脚注按钮换用官方 `Button`**（`variant: 'outline'` 放弃修改 / `variant: 'primary'` 保存，
  `size: 'sm'`），删除手写的按钮样式与 hover/focus 处理。
- **卡片容器改用官方设置面板 token**：底色 `settings-card-fill`、描边 `settings-card-stroke`、
  圆角 `--dsw-radius-lg`；字段行分隔线统一为 `0.5px solid var(--dsw-alias-border-l2)`；
  文案池 textarea 按官方输入框规范重排（0.5px `border-l4`、`radius-md`、`bg-layer-1`、14px）。
- **保留两处自绘，并在文件头注释里写明理由**：字段行布局（官方自身也在功能包内自绘行——
  `ui-theme` 的 `FontSizeRow` 即先例，控件仍取官方件）与多行文案池（库内无「Enter 换行」语义的
  多行控件；`InlineEditor` 是 Enter 提交，与逐行编辑语义冲突）。
- **不动暂存模型**（`settings-form.mjs` 的 `WhaleSettingsForm`）。它已按官方 `ConfigFormController`
  的快照形状与 `set(field, value)` 工作，且 `tests/settings-form.test.mjs` 正在守护其语义；
  本次只换"看得到的控件"，不改数据通路。
- 构建脚本为 `@deepseek-ai/dsh-client-ui-primitives` 增加 `--external`——该模块与 react 一样由
  平台种子表提供，不打进 bundle。

## Alternatives considered

**只给自绘开关补 `corner-shape: round` 与官方几何参数。** 改动最小、当场修好观感，但自绘开关本身
仍违反"不得复制库内已有控件"的约定，下次主题层变动又会漂移；数字输入、按钮、卡片 token 的同类
偏差也仍在。

**整套换成 `SettingsForm` + `SettingsValueField` + `SettingsFormModel`（官方设置页的完整套件）。**
这些正是官方 `ui-settings-shell`/`-agent-loop`/`-web-search`/`-subagent` 的用法，也能白拿
"已覆盖 / 恢复默认"的官方能力。未采用的原因是它带来两处**行为**变化，超出了"迁移设计风格"的范围：
其一是字段行布局由"标签在左、控件在右"变为"标签在上、输入框在下"（`SettingsValueField` 的固定
形态），而用户对照的 DSH 通用设置页是前者；其二是 `SettingsForm` 只在**卸载时**丢弃草稿
（"saves only on its button, and discards on unmount"），没有"放弃修改"按钮，会移除本卡片现有的
显式放弃操作。若维护者倾向全面对齐插件设置页范式，可在其上继续演进。

**把文案池也换成官方 `InlineEditor`。** 用官方控件换掉自绘 textarea，但 `InlineEditor` 的
Enter 语义是"提交"、Shift+Enter 才是换行，与"每行一条文案"的编辑手势直接冲突。

## Consequences

- 观感回到 DS H体系内：开关为胶囊+正圆，按钮、输入框、卡片底色描边、分隔线与字号均取自官方
  控件与 token；此后主题层调整圆角标度时，本卡片自动跟随。
- 客户端产物新增一个运行时模块依赖（`require("@deepseek-ai/dsh-client-ui-primitives")`）。该路径
  已有先例：官方各设置页与第三方插件 `@smalltailqwq/dsh-client-ui-skin-*` 均如此引用。
- 逻辑零改动：注册方式、`configForms` 数据通路、字段集合（7 项）、暂存/保存/放弃语义、
  `settings-form.mjs` 与其单测全部保持不变。
- 已知限制 1：**改动本身未经真机目视验证**（本次在 CLI 与单测层面验证）。已通过 11 个门禁与
  141 项仓库测试；`build-client --check` 产物新鲜；隔离单测（mock ctx，20 项断言）覆盖注册接线与
  "编辑 → 保存"数据通路。官方组件若与本卡片的行布局假设不符，最坏表现是样式偏差，不影响功能。
- 已知限制 2：文案池 textarea 为自绘，其外观与官方 `Input` 的对照只能靠 token 数值一致来保证。
