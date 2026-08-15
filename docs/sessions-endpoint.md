# 每会话活动端点

`GET /whale-girl/sessions` 返回每个运行中会话一行——会话标题与其当前活动。它是 `/whale-girl/state` 聚合情绪（sessionThink / sessionWait）的按会话补充：外部消费者（如桌面伴侣的消息气泡）从这里按会话读取明细。

## 响应

```json
[
  {
    "id": "session-<id>",
    "title": "会话标题或 null",
    "activity": "thinking",
    "since": 1786793963547
  }
]
```

- `activity` 是封闭集合：`thinking`（回合进行中，深度思考）、`tool:<name>`（工具调用运行中；`bash`/`pwsh` 表示命令行执行中）、`waiting`（回合被阻塞等待批准）、`done`（回合完成）。
- `title` 取会话日志中最近的 `session/title`，或 `sessionTitle` 服务值；未知时为 `null`。
- `since` 为会话开始时间（Unix epoch 毫秒）。
- 会话离开 `sessions.list()` 后其行被移除——已结束会话的气泡随之消失。

`cache-control: no-store`；活动随会话事件实时变化，消费者应轮询或在每次 `/whale-girl/events` 信号后重新读取。

## 推导

每条 `session/event` 折叠进每会话视图：

| 事件 | 效果 |
|---|---|
| `turn/start` | 活动 `thinking` |
| `tool/call` | 活动 `tool:<data.name>` |
| `turn/end`（`reason.kind === 'blocked'`） | 活动 `waiting` |
| `turn/end`（其他原因） | 活动 `done` |
| `session/title` | 标题 |

未出现在事件流的会话（插件加载前已存在）由 `sessions.list()` 兜底补录（日志标题、`header.createdAt`）。
