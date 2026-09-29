# Decision: 设置面板卡片——官方 settings.plugin.item 槽接入（高频子集）

Status: implemented

## Problem

体验层配置面早已接通宿主 settings（`settings.register('whale-girl', schema, {applies:'live'})`
+ `scope.watch` 热更新 + `/state` configRevision 下发，见 config-system 决策），但 GUI 内
**没有任何配置入口**——用户只能手编 `<dshHome>/settings.yaml`。官方设置面板只渲染注册了
`settings.plugin.item` 槽卡片的命名空间，README 声称的 "(or the settings UI)" 实际不存在。
L1 体验层「用户可感知并有意愿调整的参数」缺最后一块 UI：普通用户无法发现、也无法在 GUI
内调整尺寸/透明度/游走/睡眠/回话文案。

## 当前兼容边界

宿主接口接入部分由 [DSH 0.1.7 兼容决策](../bug-fix/2026-09-29-dsh-017-compat.md) 调整；旧卡片不在目标新宿主中加载。

## Decision

- **client half 注册官方设置面板卡片**：keyed 槽 `settings.plugin.item`（官方
  `ui-settings-plugins` 的 ConfigurablePluginsTab 声明；rc.8 契约为 keyed 槽，缺 key 启动
  即抛），`key` = 设置命名空间 `whale-girl`（与 Node half 的 `settings.register` 同名，
  否则卡片永不出现）。位置：设置 → 插件 → 鲸鱼娘卡。
- **卡片范围 = 高频子集**：`enabled`（网页端显示）/ `size` / `opacity` / `walk.enabled`
  / `sleepAfterMs` 五个高频项 + `replies.feed` / `replies.play` 回话文案池（每行一条）。
  窗口时长类（bubble/welcome/celebrate/error/disappointed）与 pollMs 等低频调校项不进
  卡片——官方 BashCard 同样只编辑 served schema 的子集 by design；settings.yaml 仍是
  全量高级入口。
- **交互对齐官方 CardForm 语义**（参考实现 `vlln/dsh-loop` 的 LoopSettingsForm）：
  `edit` 暂存（draft 整体替换使引用失效）→ `save` 一次性提交（revision-fenced）→ 按宿主
  接受值重读逐字段确认（失败置 `failed`）；`discard` 丢弃；快照内容未变时引用稳定
  （React #185 防线，缓存键 = scope 快照引用 + draft 引用 + saving/failed）。
- **嵌套组（walk/replies）写整个顶层键**：官方 client `settingsScope` 只暴露单段路径
  `set`，深路径（如 'walk.enabled'）会字面落键；宿主 mutate 支持深路径但 client 面不达。
  整组写基于已提交组对象合并叶（幂等，不丢组内其他叶）。默认值不写第二份——表单兜底
  由 index.mjs 传入 CFG_DEFAULTS（verify-config-sync 门禁保证与 src/config.mjs DEFAULTS
  一致）。
- **client inject 声明 `['slots', 'locale', 'settingsScope']`**（cordis 严格注入：未声明
  即抛 `cannot get property without inject`）；apply 内 try/catch 守卫注册——服务缺失或
  注册失败仅「无卡片」，宠物本体照常跑。react 由平台种子表提供（`getStaticModules` 种子
  `react`），esbuild `--external:react`（bundle 内 `require("react")`），不自带运行时。
- **locale 独立命名空间 `settings.whale-girl`**（zh/en 两套），与 README 行为描述一致。
- **无 Node half 改动**：命名空间注册/校验/热更新沿用 config-system；写面仍走宿主
  settings 服务（revision-fenced 文档变更），符合「插件不自建写面」的信任边界。
- **门禁/自证**：新增 `tests/settings-form.test.mjs`（11 例：暂存语义、快照引用稳定、
  组整组合并写、宿主拒绝 → failed、行解析往返）。

## 取代检查

**无重叠**——本记录只覆盖 client 侧卡片表面（槽注册 + 暂存表单 + locale + build
external）；settings 命名空间注册/校验/热更新/写面信任边界归
[config-system](./2026-08-09-config-system.md)，不受本记录影响。

## Alternatives considered

**A：纯 DOM 自绘卡片。** 槽渲染方是 React（web-react 的 SlotOutlet，条目必须是 React
组件返回 ReactNode）——纯 DOM 条目无法进入设置面板。React 由平台种子表提供、零自带
运行时成本，弃纯 DOM 方案。

**B：宠物自身菜单加设置入口（菜单 POST /config 写面）。** 自建写面违反 config-system
已定的「写路径只有用户设置服务/文件——插件不自建写面（防 CSRF/越权）」信任边界；
设置面板经 settingsScope 走 revision-fenced 文档变更，是官方提供的受信任写入口，弃。

**C：全量 17 项进卡片。** 窗口时长/轮询是低频调校参数，铺开会稀释卡片信息密度、拉长
文案与校验面；高频子集 + settings.yaml 高级入口已覆盖全部项，弃。

**D：读写复用 /config 路由做卡片数据源。** 写仍不经插件（决策不变），读却绕开
settingsScope 的 revision 门控与快照语义——重复造第二读通道，弃。

## Consequences

- GUI 用户可配置高频体验项与回话文案池，保存即生效（live 热更新 Node half 已实现，
  /state configRevision 下发客户端无需重启）；README 的 "(or the settings UI)" 表述
  变为真实。
- 新增模块：`lib/client/settings-form.mjs`（纯逻辑，零 React/零宿主依赖，单测 11 例）、
  `lib/client/settings-card.mjs`（React 卡片 + zh/en locale + 注册函数）；`lib/client/index.mjs`
  追加 `inject = ['slots','locale','settingsScope']` 与守卫注册；`scripts/build-client.mjs`
  追加 `--external:react`。
- 实现细节：卡片 key（= 设置命名空间）在 client 以字面量 `SETTINGS_NAMESPACE` 声明并
  注释交叉契约——client bundle 不可 import src/config.mjs（其 import schemastery，浏览器
  不打包）；改 Node half 命名空间时该字面量必须同步（实测守护：key 不同名 → 卡片永不
  出现）。
- 已知边界：卡片不含窗口时长/轮询等低频项（settings.yaml 仍可配全量）；语义层
  （XP/称号/曲线）封闭不变（verify-settings-schema 门禁无关此项）；卡片只在官方设置
  面板存在时出现（slot 声明方卸载 → 注册自动移除）。