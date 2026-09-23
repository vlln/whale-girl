# Decision: dsh 0907+ 宿主 API 兼容——jobs 事件流 / agent/created / Config schema / client inject

Status: implemented

## Problem

dsh 0.1.7（2026-09 系列）移除了 whale-girl 依赖的三面宿主 API：

- **0903 jobs seam 重构**：`ctx.jobs.onJobDone(cb)` 删除，任务终态改由
  `ctx.jobs.events.subscribe(filter, listener)` 的 `settled` 事件流承载；`jobs.list(owner)`
  的属主词汇从 agent 对象改为 `SessionId`。
- **0909 agent 初始化改版**：`agent/session-start` 事件改名 `agent/created`（payload.source
  词汇不变：startup/resume/clear/compact）。
- **设置模型改版**：`settings.register(namespace, schema, opts)` 删除，插件配置统一走
  loader 的 `Config` schema 导出 + profile patch `config:` 段，宿主设置 UI 自动生成表单。

后果：npm 0.1.0（及 0831 源码）装到最新 dsh 双半区皆坏——

- Node half 激活失败：`TypeError: ctx.jobs.onJobDone is not a function`（启动日志
  「1 entry did not activate」），宠物路由/事件记账全不注册；即便跳过该行，
  `agent/session-start` 静默不触发（无 welcome/会话 XP）、`jobs.list(agent)` 属主恒不匹配
  （working 状态失明）、`settings.register` 守卫静默跳过（配置面失效）。
- client half 整体 pending：`export const inject` 里的 `settingsScope` 服务在新 dsh 不存在
  （0907 前的内部实验面），inject 是硬等待契约——任一服务缺失整个 client 条目不激活，
  web 页面直接报「Failed to load plugins: whale-girl: pending (waiting for service:
  settingsScope)」，宠物不渲染。

## Decision

Node half 五处适配（`lib/index.mjs`）：

- **任务终态**：`ctx.jobs.events.subscribe({ owners: 'all' }, ...)`，只消费 `settled` 事件；
  `cause: 'teardown'`（属主/服务销毁 force-fail）跳过——非真实任务结果；`killed` 保持中性
  （F4 语义）。`JobView` 的 id/status/label 契约不变，记账逻辑零改动。
- **会话启动**：`ctx.on('agent/created', ...)`，source 语义与 XP 记账不变。
- **任务收集**：`collectTasks` 按会话遍历——`sessions.list()` 的 `session.id` 传
  `jobs.list(caller)`（新 owner fence），unowned 由 `jobs.list()` 兜底，id 去重；inject 移除
  不再使用的 `agents`。
- **配置**：`export const Config = buildSchema()`（loader 解析 profile patch config 段，
  默认值单源于 DEFAULTS），`apply(ctx, config)` 第二参注入；`validateConfig` 跨字段约束
  在 apply 兜底校验，非法整体回退 DEFAULTS。inject 移除 `settings`；/config 端点与
  configRevision 门控不变。

client half 两处适配（`lib/client/index.mjs` + `settings-card.mjs`）：

- **inject 收敛为 `['slots', 'locale']`**——inject 是硬等待契约，只声明 web 组合恒有的
  服务；`settingsScope` 从列表移除。
- **卡片守卫**：`registerWhaleSettingsCard` 探测 `ctx.settingsScope` 缺席即返回 null
  （卡片跳过，宠物照常），配置面由宿主从 Node half `Config` schema 自动生成的表单接管。

## 取代检查

部分取代 [2026-08-09-config-system](../feature/2026-08-09-config-system.md) 的「Node half
settings 接入」节（settings.register/scope.watch → Config 导出/apply 注入；其余配置面
——DEFAULTS/schema/validateConfig、/config、configRevision——不变）；与
[2026-08-12-migrate-to-bundle-format](../simplification/2026-08-12-migrate-to-bundle-format.md)
的 inject 后果描述部分重叠（settings 注入随注册面一并移除；webServer/jobs/sessions 注入
不变）。两条旧记录保持活跃并回链，不归档。

## Alternatives considered

**A：保留 settings.register 探测双路径**（守卫 `typeof register === 'function'`）。新 dsh
恒走 fallback 分支、旧 dsh 走注册分支——两套配置面并存漂移，守卫永假分支成为死代码。弃。

**B：任务终态改用全局事件（`ctx.on('job/...')`）。** dsh 未提供 jobs 全局事件，事件流只
在 registry `events` 上；自制轮询兜底（轮询翻转）已存在但漏记窗口大（F1 的动机）。弃。

**C：collectTasks 维持 agents 遍历。** 新 `list(caller)` 过滤 `owner.id === caller`，传
agent 对象恒 false——owned 任务（subagent/bash 后台任务）永不可见，working 状态失明。弃。

## Consequences

- 兼容 dsh 0.1.7+（0903/0909/设置模型改版之后）；更早 dsh 不再支持（bundle 形态本身面向
  官方机制演进，见 [2026-08-12-migrate-to-bundle-format](../simplification/2026-08-12-migrate-to-bundle-format.md)）。
- 配置存储从 `<dshHome>/settings.yaml` 迁到 profile patch `config:` 段（宿主设置 UI 自动
  表单编辑）；配置变更经 loader 重挂载热生效（免 web 重启），账本由磁盘持久化保证连续。
  settings.yaml 旧文档只作为宿主一次性 legacy 导入源。
- client 设置卡片（`settings.plugin.item` 槽，2026-08-31）依赖的 `settingsScope` 服务在
  0907+ dsh 不存在——卡片守卫跳过，宠物本体不受影响，配置面由宿主自动表单接管；
  卡片迁移到新 client 设置面或整体移除为后续项（[2026-08-31-settings-panel-card](../feature/2026-08-31-settings-panel-card.md) 的卡片路径现处休眠态）。
- 已在 0.1.0 时代安装又卸载的 profile 可能残留 `- id: whale-girl disabled: true` 用户层
  patch 条目（上次失败的禁用痕迹）——重装前须清除，否则新装即被禁用。
- 验证：141 单测全绿 + 11 门禁全过（含 client.js 逐字节新鲜度）；隔离 profile 源码安装
  （link:）端到端——Node half 无激活告警、/state、/config（schema 默认值完整下发）、
  /interact 200；浏览器冒烟（verify-client-smoke，headless Chrome）client apply 成功、
  宠物以 sprite 渲染。
