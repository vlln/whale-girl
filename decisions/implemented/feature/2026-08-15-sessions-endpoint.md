# Decision: 每会话活动端点 /whale-girl/sessions

Status: implemented

## Problem

桌面伴侣需要"宠物上方 N 个消息框"显示各会话标题与当前动作（深度思考中 / 执行某某工具 / 运行命令行中 / 等待批准）。`/whale-girl/state` 只聚合全局会话感知（sessionThink / sessionWait / turnCompleted），无法区分"哪个会话在做什么"；桌宠消息框必须按会话读取活动。

## Decision

新增 `GET /whale-girl/sessions`，返回 `[{ id, title, activity, since }]` 数组（无 apiVersion——纯列表契约，字段可兼容增补）。`activity` 取值封闭集合：`thinking`（深度思考中）/ `tool:<name>`（执行工具，桌面端对 bash/pwsh 显示"运行命令行中"）/ `waiting`（等待批准）/ `done`（回合完成）。响应 `cache-control: no-store`（活动随事件实时变化）。

数据源是既有 `session/event` 事件流（与 /state 的会话感知同源，不新增宿主依赖）：`turn/start` → thinking、`tool/call`（data.name）→ tool:&lt;name&gt;、`turn/end`（reason.kind === 'blocked' → waiting / 其余 → done）、`session/title`（data.title）→ 标题。纯逻辑在 `.dsh-plugin/src/sessions.mjs`（零宿主依赖，可单测）；Node half 维护 `sessionViews` 账本，事件回调时应用视图更新，`/sessions` 请求时快照。

兜底：未出现在事件流的会话（如插件加载前已存在）用 `sessions.list()` 补录——标题从会话事件日志取最后一个 `session/title`（titleFromLog），`since` 取 `header.createdAt`；列表缺席（headless 无 sessions 服务）时只返回事件视图。列表可用时清理已结束会话的视图（不再出现在列表 → 从响应消失，即"会话结束后框消失"）。

## Alternatives considered

**扩展 /state 加 per-session 数组。** 会改变既有快照契约的消费者语义（apiVersion 1 契约已发布给桌宠），且 /state 高频轮询、/sessions 只在有会话时才有意义，分开端点职责更清晰。

**在 SSE /events 里携带活动载荷。** 需要事件序列、重放与断线语义，超出桌宠轮询 + IPC 下发的需求；SSE 保持刷新信号、/sessions 提供完整事实（与 /state 同一轮询循环，桌宠实现最简）。

**从 tasks/jobs 服务推导活动。** 会话活动（思考/工具/等待）本质是会话事件流的事实，jobs 只是任务的子集；用事件流与 /state 同源，避免两个事实源漂移。

## Consequences

- 桌宠 main 进程与 /state 同循环轮询 /sessions，IPC 下发渲染器，会话结束后消息框消失。
- 事件流与 /state 共用同一 `session/event` 订阅，无新增宿主导入；sessions 服务缺席时降级为仅事件视图。
- 未知字段可兼容增补；`activity` 封闭集合外的新取值由消费端兜底显示。
- 外部消费者仍依赖运行中的 DSH Web profile，并负责断线重连与轮询兜底（与 /state 相同）。
- 本端点是对 #1 外部只读快照契约（external-consumer contract，作者 xiaoshihou514）的按会话补充：/state 提供聚合情绪，/sessions 提供每会话明细，二者共同支撑桌面伴侣等外部消费者。
