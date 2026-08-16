# Decision: 桌面伴侣作为独立外部消费者（desktop/）

Status: implemented

> 承接 [GUI 内宠物架构（A 模式）](2026-08-08-in-gui-pet-architecture.md) 的 B' 方向考量——
> 该决策把「OS 原生常驻渲染」列为 future feature；本决策将其落地为独立 `desktop/` 应用，
> 不改动 A 模式的插件本体。

## Problem

A 模式宠物只在 DSH Web GUI 页面内可见、依赖页面焦点；用户不便把鲸鱼娘「带到桌面」独立陪伴。
需要一个**不修改插件本体**的原生桌面渲染方案，避免双代码/双账本。

## Decision

新增 **`desktop/` 独立应用**（Node.js ESM + Electron 可选渲染壳），作为**外部 HTTP 消费者**：

- **不改动 whale-girl 本体**：不碰 `lib/`、`lib/client.js`、`lib/assets/`、`tests/`、`scripts/gates/`。
- **消费既有公开端点**：`GET /state`（非消费式快照）、`GET /events`（SSE 即时刷新）、
  `POST /presence`（心跳上下线）、`POST /interact`（feed/play）、`GET /config`、`GET /assets/*`
  （manifest + sprite dataURL 经 IPC 喂给 renderer，renderer 零网络、无 CORS 面）。
- **presence 契约**：每 15s `{online:true}`（whale-girl `PRESENCE_TTL_MS=45s`，余量 3 次心跳）；
  退出 `{online:false}`；崩溃靠 TTL 45s 自动过期回网页端。桌面在线时网页端隐藏宠物，避免双宠。
- **状态机/调度**：对齐 `lib/client/logic.mjs` 的 `pickState` 优先级（burst > 互动瞬发 > wait >
  回合完成 > working 插曲 > think > joy > sleep > walk > idle），纯 Node、无 DOM，复用同一状态集合。
- **渲染**：Electron 透明置顶窗 Canvas 帧播放；点击投喂/拖拽换位、资历角标。
- **headless**：`--headless` 只跑心跳+轮询+SSE（CI / 无桌面环境自测）。

架构边界：

- 桌面端**只写**两个公开端点（presence 心跳、interact 乐趣），**绝不写账本**（XP/称号由
  whale-girl 独占，保持积累不变量）。
- 两个代码库边界清晰：`desktop/` 自带 `package.json`（独立 app），不进插件的
  `bundles/files` 白名单，`dsh plugin` 安装流程不受影响。

## Alternatives considered

- **并入插件 client half（C 模式）**：在 bundle 里同时渲染网页与桌面，会撑大客户端、
  混入平台原生依赖，且 desktop 渲染与网页渲染是不同生命周期，单一 bundle 难兼顾。
- **只做心跳+托盘、无渲染（精简 MVP）**：落地快但无化身，弱交互；本实现保留其核心（can run
  headless）并叠加渲染壳，两全。
- **Tauri/Electron 原生重写状态机**：脱离 whale-girl 契约，风险高、难回滚；本实现严格复用
  whale-girl 端点与状态集合，集成成本最低。

## Consequences

- 桌面端生命周期独立：启动/退出/崩溃不影响插件本体；崩溃时经 presence TTL 自动恢复网页宠物。
- 维护成本：两份代码（插件 + desktop/）需同步契约；本实现以 `DESIGN.md`+`BUILD-RUN.md` 记录
  契约，并以端到端测试锁住（`/state /presence /interact /config /manifest /sprite`）。
- 渲染层零网络：manifest/sprite 由 desktop 主进程拉取转 dataURL，renderer 无 fetch/CORS，
  与 whale-girl 的 assets 净化路径解耦。
- 安全面：`/presence`、`/interact` 本地调用不带 Origin/Sec-Fetch-Site → `isCrossOrigin` 判定
  同源放行；端到端测试覆盖。
