# whale-girl 桌面伴侣 — 设计方案（DESIGN.md）

> 版本：v1 · 状态：方案设计 · 归属任务：t1
> 工作区：`C:\Users\12258\whale-girl-desktop\`
> 描述对象：为 DSH Web GUI 内的桌面宠物插件 whale-girl 开发一个**独立桌面伴侣应用**，
> 使其化身显示在桌面上（宠物跑到屏幕角落、常驻），并满足对 whale-girl 既有端点的消费契约。

---

## 1. 背景与目标

whale-girl 是一款 DSH Web GUI 插件（`C:\Users\12258\.dsh\profiles\web\node_modules\whale-girl\`），
提供网页内自渲染的桌面宠物（QQ 宠物形态）。宠物只有在浏览器开着 DSH 页面时可见、依赖页面焦点，
用户不便将其"带到桌面"独立陪伴。

**目标**：构建一个独立的**桌面伴侣进程**（非浏览器页面），把 whale-girl 的化身渲染到操作系统桌面，
常驻于屏幕，并实时消费 whale-girl 的状态/事件。网页端在桌面伴侣在线时**隐藏自己的宠物**，
避免"双宠物"。

**约束与前提（已验证的环境事实）**：
- whale-girl Node half 注册的路由前缀是 `/whale-girl`（单一来源 `lib/src/routes.mjs`）。
- 端点集合：`GET /whale-girl/state`、`POST /whale-girl/interact`、`GET /whale-girl/config`、
  `GET /whale-girl/assets/*`、`/whale-girl/assets/manifest.json`、`GET /whale-girl/events`（SSE）、
  `POST /whale-girl/presence`、`GET /whale-girl/sessions`。
- DSH web 服务在 `http://127.0.0.1:3080`。
- presence 契约（`lib/src/presence.mjs`）：`PRESENCE_TTL_MS = 45s`，桌面端每 15s `POST /presence {online:true}` 续命；
  `{online:false}` 立即下线，网页端宠物恢复显示。
- 状态是**非消费式快照**（`/state` 返回 `pet` + `activity`，可被 Web 与外部伴侣同时观察）。
- 无第三方渲染依赖：whale-girl 是 sprite sheet 帧播放（浏览器 Canvas）。

---

## 2. 技术选型

### 2.1 运行时与语言
采用 **Node.js（≥18，ESM）+ Electron 的可选外壳**，拆成两层：

| 层 | 技术 | 理由 |
|---|---|---|
| 核心伴侣逻辑 | Node.js ESM（`lib/`） | 复用 whale-girl 相同的 ESM 形态；纯 HTTP 客户端，零 GUI 依赖，可在 headless 下跑通心跳 |
| 桌面渲染外壳 | Electron（可选项） | 让 sprite 播到真实桌面（透明窗口、置顶）；Electron 自带 Canvas + 透明 frameless 窗口 |
| 状态/事件消费 | 原生 `fetch` + `EventSource` | 复用 whale-girl 的 `/state` 轮询 + `/events` SSE 通道 |

> **决策要点**：**不修改 whale-girl 本体**。桌面伴侣只做**外部 HTTP 消费者**，
> 通过 `/state`、`/events`、`/presence` 等既有公开端点交互 —— 这是风险最低、可回滚的集成方式。

### 2.2 渲染方案二选一（外壳内部）
1. **Electron 透明窗 + Canvas 帧播放**：沿用 whale-girl sprite 资产，逐帧 `drawImage`。
   - 优点：与网页端一致、可加点击投喂交互；缺点：打包体积大。
2. **原生无壳（仅 Node）+ 系统托盘/快捷键**：不做真实桌面绘制，只做心跳 + 状态回读，
   在托盘提示/通知里展示宠物状态。
   - 优点：极轻；缺点：无化身、交互弱。

**推荐**：优先做**方案 2 的完整版 + 方案 1 的渲染**——即 Electron 透明窗负责画宠物，Node 核心负责
状态与心跳。若首版要最快落地，可先交付**方案 2（无窗、纯心跳 + 托盘）**作为 MVP，再升级到渲染。

### 2.3 依赖
- Node 侧：`node:fs` / `node:path` / `node:http`（或直接 `fetch`）——**不新增第三方运行时依赖**。
- Electron 侧（可选）：`electron`。
- 测试：`node --test`（与 whale-girl 仓库同风格）。

---

## 3. 通信契约（桌面伴侣 ⇄ whale-girl）

> 前缀 `/whale-girl`；基础 `BaseURL = http://127.0.0.1:3080`。

### 3.1 轮询状态 —— `GET /whale-girl/state`
- 方法：`GET`，禁缓存（`cache-control: no-store`）。
- 响应体：
  ```jsonc
  {
    "apiVersion": <number>,
    "pet": {
      "level": <number>,
      "xp": <number>,
      "stats": { "tasksDone": 0, "failures": 0, "sessions": 0, "activeMs": 0, "firstSeenAt": <number|null> },
      "titles": [<string>],
      "memory": [<string>],
      "updatedAt": <number>
    },
    "activity": {
      "name": "idle|working|welcome|celebrate|error|disappointed",
      "until": <number>,
      "sessionThink": <bool>,
      "sessionWait": <bool>,
      "turnCompleted": <bool>,
      "turnCompletedUntil": <number>
    },
    "configRevision": <number>,
    "companionOnline": <bool>   // 是否已有桌面伴侣在线（桌面端应观察，避免自举冲突）
  }
  ```
- **非消费式**：`activity` 带 `until` 绝对截止，多个消费者（网页 + 桌面）同时观察同一回合完成，互不干扰。

### 3.2 即时事件 —— `GET /whale-girl/events`（SSE）
- `Content-Type: text/event-stream`；`retry: 3000`；心跳 25s `: ping` 注释行。
- 事件行：`data: {"type":"event"}\n\n`——收到后客户端应**立即重新 `/state`**（把延迟从 pollMs 降到单次往返）。
- 触发点：回合完成/失败、会话启动、请求错误、turn 边沿（think 陪伴/回合完成）等。
- **桌面端用法**：`EventSource` 订阅；`onmessage` 触发 `refreshState()`。
- **兜底**：SSE 断线时靠 `/state` 轮询（默认 3s）保证宠物照常。

### 3.3 在场心跳 —— `POST /whale-girl/presence`
- 请求体：`{ "online": true }`（续命窗口 45s）；每 **15s** 发送一次。
- 下线/退出：`{ "online": false }` 立即下线；崩溃/进程结束则心跳过期（45s）自动下线，网页端宠物恢复。
- 响应：`{ "online": <bool> }`。
- **语义**：显示层写面，无账本影响；与 `/interact` 同级安全面（跨源校验 + 请求体上限 1KB）。
- **重要**：心跳期间的 `/state` 的 `companionOnline = true` → 桌面端应据此确认"自己生效"；
  网页端（配置 `enabled`）收到 `companionOnline=true` 时**隐藏网页宠物**，避免双宠物。

### 3.4 互动 —— `POST /whale-girl/interact`
- 请求体：`{ "action": "feed" | "play" }`。需**同源 CSRF 校验通过**（见 3.6）。
- 响应：`{ "pet": <state>, "reply": "<回话>" }`。
- 纯乐趣、零负反馈：状态不变。

### 3.5 只读配置 —— `GET /whale-girl/config`
- 返回 `{ "config": { ... }, "revision": <number> }`。桌面端按 `configRevision` 判断是否需要重应用体验参数。

### 3.6 每会话活动 —— `GET /whale-girl/sessions`
- 返回数组：`[{ id, title, activity: "thinking|tool:<name>|waiting|done", since }]`。
- 供桌面伴侣的消息框展示"当前 DSH 在做任务 / 在等你"。

### 3.7 资产 —— `GET /whale-girl/assets/*`
- sprite sheet 与 manifest：`GET /whale-girl/assets/manifest.json`（帧布局、尺寸、动画序列）。
- 桌面端拉取后本地帧播放；`cache-control: no-cache`，替换同名 sheet 后须重新校验（避免旧图）。

### 3.8 安全面（契约红线）
- `/interact`、`/presence`：跨源请求被拒（`Sec-Fetch-Site` 非 `same-origin`/`none` 且不带 Origin → 403）。
  **桌面端本地 HTTP 调用通常不带 Origin / Sec-Fetch-Site，应被识别为同源；如被拒，需对齐 Origin 语义，
  由桌面端显式设置正确请求头（走 localhost 同源语义）。**（实现时验证）
- 请求体上限 1KB（`/interact`、`/presence`）。

### 3.9 时序
```
Desktop进程启动
  ├─ 立即 POST /presence {online:true}          // 宣告在线
  ├─ 启动 15s 心跳定时器 → POST /presence {online:true}
  ├─ 启动刷新循环：fetch /state（每 3s）+ EventSource /events（即时触发）
  ├─ 按需拉 assets manifest + sprite → 桌面渲染
  └─ 退出：POST /presence {online:false} → 进程结束
网页端                                  同时
  ├─ /state.companionOnline === true → 隐藏网页宠物（避免双宠）
  └─ /state.companionOnline === false → 恢复网页宠物
```

---

## 4. 功能清单

### 4.1 P0 —— 核心（MVP，必须）
- **P0-1 在场心跳**：每 15s `POST /presence {online:true}`；退出时 `{online:false}`；崩溃自动过期。
  （使网页端隐藏宠物，桌面化身成为"唯一宠物"）
- **P0-2 状态轮询**：每 3s（`pollMs`）`GET /state`，解析 `pet` + `activity`。
- **P0-3 事件即时刷新**：`EventSource /events`，收到事件立即重新 `/state`。
- **P0-4 桌面渲染（Electron）**：按 `manifest.json` 播放 sprite 帧；activity →
  对应动画倾向（idle/working/welcome/celebrate/error/disappointed）；宠物一角常驻、透明置顶。
- **P0-5 登出/关闭清理**：Ctrl+Q / 托盘退出 → 显式下线 + 释放。

### 4.2 P1 —— 体验增强
- **P1-1 点击互动**：点击宠物 → `POST /interact {action:feed/play}`，展示气泡回话。
- **P1-2 资历角标**：显示 `Lv.${level}`、XP、已解锁称号；结算回合完成 `celebrate`。
- **P1-3 会话状态显示**：消费 `/sessions`，托盘/气泡提示"DSH 思考中 / 等待你批准"。
- **P1-4 配置跟随**：消费 `/config`，按 `configRevision` 跟随 size/opacity/窗口时长等。

### 4.3 P2 —— 进阶
- **P2-1 崩溃自恢复**：监听进程退出信号，非正常退出也兜底自然过期不污染。
- **P2-2 多屏/工作区**：记忆上次位置，开机自启（系统托盘）。
- **P2-3 主题/淡入淡出**：透明度动画、过节彩蛋。

> 交付顺序：P0（心跳+轮询+SSE+渲染）→ P1 → P2。

---

## 5. 目录结构（建议）

```
C:\Users\12258\whale-girl-desktop\
├─ DESIGN.md                 # 本文件
├─ package.json              # ESM, main: lib/index.mjs
├─ lib/
│  ├─ index.mjs              # 桌面伴侣入口：组装 client + heartbeat + render
│  ├─ client/
│  │  ├─ http.mjs            # fetch 封装：/state /interact /config /sessions /presence
│  │  ├─ events.mjs          # EventSource 订阅 + 重连
│  │  ├─ state.mjs           # 状态机：activity → 动画意图映射
│  │  └─ heartbeat.mjs       # 15s presence 心跳 + 退出清理
│  ├─ render/
│  │  ├─ window.mjs          # Electron 透明置顶窗
│  │  └─ sprite.mjs          # manifest 解析 + 帧播放
│  └─ src/
│     └─ config.mjs          # 桌面端本地配置（BaseURL、pollMs 等）
├─ assets/                   # （可选）本地图标/托盘图
└─ test/
   └─ contract.test.mjs      # 校验本端点到 whale-girl 契约的测试
```

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `/presence` 或 `/interact` 因跨源判定拒绝本地调用 | 心跳失败、桌面化身上不了线 | 本地调用对齐同源语义；验证请求头；必要时为桌面端走受信 Origin 白名单（不放宽安全面） |
| SSE 断线/代理空闲断开 | 事件延迟 | 心跳 25s 应对代理；`retry:3000` 自动重连；`/state` 轮询兜底 + `EventSource` 内建重连 |
| 网页端未配置 `enabled=false` 出双宠 | 两处显示同一宠物 | 网页端读取 `companionOnline` 自行隐藏（whale-girl 已具备该字段）；桌面端确保心跳存活 |
| 状态是累积账本、无净负反馈 | 桌面端只能加互动、不能改账本 | 恪守只读 + `interact` 乐趣动作；不进任何写面（账本由 whale-girl 独占） |
| CSS/原点 403（assets 穿越防护） | 资产加载失败 | 走 `manifest.json` 相对路径，请求净化路径；不做含 `\` 段的请求 |
| 进程崩溃未发 `{online:false}` | 网页宠物 45s 才恢复 | 属设计内兜底：TTL 过期即自动恢复，无需手动开关 |

---

## 7. 验收要点
1. 桌面进程启动后 `/state.companionOnline === true`；网页端隐藏宠物。
2. 每 15s 心跳，窗口一直有效；进程退出（含 Ctrl+C）→ 网页宠物 45s 内恢复。
3. 事件即时性：完成任务 → 桌面端 1 次 `/state` 往返内出 `celebrate`。
4. 无第三方对 whale-girl 的写面污染；只做外部 HTTP 消费者。

---

## 附：参考契约文件（只读引用，来自 whale-girl 源码）
- 路由端点单一来源：`lib/src/routes.mjs`
- presence 契约：`lib/src/presence.mjs`
- 接合：`lib/src/interact.mjs`（isCrossOrigin / applyAction）
- 状态形状：`lib/src/pet-state.mjs`（INITIAL_STATE 字段）
- 配置：`lib/src/config.mjs`（窗口时长、replies、walk）
- 路由注册：`lib/index.mjs`
