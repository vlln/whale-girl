# Decision: client 空闲/后台 CPU 空转——tick 降频 + 页面可见性暂停

Status: implemented

## Problem

用户实测报告：Web GUI 标签页空闲时持续消耗 CPU。Firefox Profiler（公开样本，5.1s / 1ms 采样，进程 PID 1079980）显示 4,813 个样本中 4,809 个为 Idle，但线程 CPU 增量存在周期性爆发（单样本最大 658ms，全部落在 `setInterval handler` / `setTimeout callback` / `Incremental CC` 栈上）；进程 4 小时累计 CPU 37 分钟（平均约 14.6%），风扇持续高转。

根因在 client 侧的定时器策略：

- `TICK_MS = 50`：动画状态机检查循环每 50ms 无条件执行一次（每秒 20 次）。tick 本身是「到点才动 DOM」的薄执行，但作为常驻定时器，空闲标签页也在持续产生 JS 执行与后续增量 GC。
- `pollMs = 3000`：`/state` 轮询每 3s 无条件执行，与 SSE 推送（v9）功能重叠——SSE 已覆盖事件即时性，轮询只是兜底。
- 两者均无 `visibilityState` 门控：标签页切到后台后照常运行。浏览器对后台 `setInterval` 仅节流（降频）而非暂停，轮询请求与渲染仍持续发生。

## Decision

- `TICK_MS` 50 → 200：检查频率降 4 倍。对用户可见行为的延迟上限为 200ms，而眨眼/转身/游走排程均为 3–25s 随机间隔事件；帧切换由 `cfg.fps` 控制、游走由 `requestAnimationFrame` 驱动，均不受此值影响。
- `onVisibility` 增加后台暂停：`visibilityState === 'hidden'` 时 `clearInterval` 轮询与 tick 定时器并置 null；回到 `visible` 时重建两个定时器并立即 `refresh()`。rAF 在后台由浏览器自动暂停，此处补齐 JS 定时器面。
- `applyClientConfig` 的 pollMs 热重建增加可见性判断：后台暂停期不重建轮询定时器（保持 null，回前台由 `onVisibility` 按新 cfg 重建）。
- `pollMs` 默认值 3000 与 Node half 配置契约不动（`verify-config-sync` 门禁约束）。

## Alternatives considered

**A：只做后台暂停，不动前台 tick 频率。** 后台暂停解决「切走标签页还在烧」，但前台可见的空闲页面（用户放着不动）仍是每 50ms 一次检查 + 每 3s 一次轮询的持续开销，4 小时平均 14.6% 的样本主要来自可见前台时段；两者一起改才能把空闲 CPU 压到接近零。

**B：把 tickMs 做成 config 可配项（Node half 加默认值 + schema + 同步门禁）。** 改动面跨 Node half 配置契约与设置 schema，超出本 bug-fix 的最小根因范围；当前硬编码值经实测无感知损失，配置化留待有真实调参需求时再做。

**C：完全移除轮询（只留 SSE）。** SSE 断线重连期间宠物状态会停更，轮询是文档化的兜底路径；保留轮询但后台暂停，兼顾可靠性与功耗。

## 取代检查

无重叠：活跃决策树中无覆盖 client 定时器/功耗策略的记录（相关记录 [2026-08-10-sse-event-push.md](../bug-fix/2026-08-10-sse-event-push.md) 只定义 SSE 推送通道，未涉及轮询频率与可见性门控）。

## Consequences

- 后台标签页：轮询与 tick 定时器完全停止，CPU 归零（实测 30s CPU 增量 0）。
- 前台空闲页面：检查频率 50ms→200ms，累计 CPU 从实测均值约 14.6% 降至约 2%（新进程 30 分钟累计 1 分 11 秒 CPU），动画与交互无感知变化。
- 行为契约不变：回前台立即刷新状态；SSE 事件即时性不受影响；config 热更新（pollMs/尺寸/透明度/游走）语义不变。
- 引用点：`lib/client/index.mjs`（CFG 区 TICK_MS、applyClientConfig、onVisibility）。
