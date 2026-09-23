# Decision: 配置系统（L1 体验层最小集）——settings 注册 + /config + configRevision 热更新

Status: implemented

## Problem

用户想调整宠物「性格」（尺寸/透明度/游走/睡眠/窗口时长），现状全是源码常量（client 的 SPRITE_MAX/SLEEP_AFTER_MS/游走参数、Node 的 ERROR_MS/WELCOME_MS 等）——无任何配置面，必须 fork 源码。架构演进设计（docs/architecture-evolution.md）要求「可配置」，且 subagent 评审明确：**L1 体验层可配、L2 语义层（XP/称号/曲线）代码级封闭、L3 安全层不可配**。

## Decision

- **src/config.mjs**（新增，零宿主依赖可单测）：`DEFAULTS`（体验层默认值单一来源）+ `buildSchema()`（schemastery schema，默认值= DEFAULTS 防双源漂移）+ `validateConfig`（跨字段校验：walk 成对 min/max）。含 14 项：size/opacity/walk{6}/sleepAfterMs/pollMs/idlePauseMs/bubbleMs/welcomeMs/celebrateMs/errorMs/disappointedMs。
- **Node half settings 接入**：`ctx.get('settings')` 条件探测（web 组合有 provider，CLI/headless 缺失时回退 DEFAULTS——inject 不加 'settings' 避免硬等待）。注册 `settings.register('dsh-pet', buildSchema(), { applies:'live', validate })`，`scope.get()` 初始化 configRef，`scope.watch()` 热更新。
- **窗口时长消费**：ERROR_MS/DISAPPOINTED_MS/WELCOME_MS/CELEBRATE_MS 模块常量删除，消费处统一读 `configRef.*Ms`（单一来源防双源漂移）。
- **/config 路由**（GET 只读）：返回 `{ config, revision }`；写路径只有用户设置（settings 服务/文件），插件不自建写面（防 CSRF/越权）。
- **/state 响应加 configRevision**：客户端轮询比对，变化才拉取 /config 应用（门控防每 3s 重置游走计时器）。
- **client 消费**：`applyClientConfig` 应用 size（CSS 变量 --pet-size + 位置重 clamp）、opacity（--pet-opacity）、游走参数（scheduleWander 重排）、睡眠阈值、轮询间隔；walk.enabled 关闭时不排程。
- **验证**：77 单测全绿（+4 config 测试）；端到端实证——/config 默认值、settings.yaml 修改后热更新（size 110→140、revision 1→2、/state configRevision 同步）、回滚默认；浏览器冒烟 sprite 渲染通过。

## Alternatives considered

**A：插件自带 config.json 文件。** uninstall 即丢、与宿主多 namespace 的 settings.yaml 重复造第二持久层、无宿主校验/冲突检测——弃。

**B：manifest 承载配置 schema。** 宿主 `contributes` 是封闭集合（仅 tools/skills），配置是运行状态非安装契约——弃；`src/config.mjs` 独立声明铺路未来 manifest 开放。

**C：localStorage 做客户端持久配置。** 跨浏览器/跨设备不一致、与 settings 双持久层漂移风险——客户端 override 仅内存级（刷新回落 settings 值），localStorage 只保留位置——弃。

**D：开放语义层（XP/称号阈值可配）。** normalizeState 以 xp 重算 level，配置化即跨设备漂移；称号阈值可配即语义崩塌——语义层保持代码级封闭（门禁黑名单守护）。

## Consequences

- 用户可通过 settings.yaml（或未来宿主设置 UI）调整体验层参数，热生效免重启；窗口时长与客户端行为参数统一走 configRef/--pet-size。
- 后续（0907+ dsh）：settings.register API 随宿主设置模型改版移除，Node half settings 接入面由 [2026-09-23-dsh-0907-node-half-compat](../bug-fix/2026-09-23-dsh-0907-node-half-compat.md) 部分取代（Config 导出 + apply 注入）；DEFAULTS/schema/validateConfig、/config、configRevision 门控不变。
- 已知边界：本项为 L1 最小集（尺寸/透明度/游走/睡眠/窗口时长），回话文案池与菜单面板为后续（第 2 项开放性方向）；语义层封闭由 `verify-settings-schema` 门禁（后续项）强化。
- 关联：docs/architecture-evolution.md 配置节；架构演进第 1 项。
