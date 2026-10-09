// 配置系统：体验层配置 schema + 默认值（单一来源）。
// 契约：
// - 只含 L1 体验层项（用户可感知并有意愿调整的视觉/行为参数）；语义层
//   （XP/称号阈值/等级曲线/MEMORY_MAX/ACTIVE_CAP）与安全层（路由/CSRF/上限）
//   是代码级封闭集合，禁止出现在本 schema（verify-settings-schema 门禁守护）。
// - DEFAULTS 是消费端的唯一权威默认值来源；消费端（index.mjs/client 逻辑）
//   不得再写第二份默认值字面量（verify-config-sync 门禁守护）。
// - schema 即插件条目的 Config（index.mjs `export const Config`）：设置命名空间 =
//   条目 id（= NAMESPACE = bundle 包名，verify-config-sync 门禁守护同一性）。
//   宿主按 `~standard` 校验条目 config，并把标了 `.volatile()` 的叶子替换为实时
//   引用（`createVolatile`，形如 `{ get() }`）；改这些字段经 profile patch 提交时
//   宿主原地换值、**不重挂载**，并发 `loader/volatile-update`（index.mjs 订阅）。
// - readConfig 是消费端唯一读取面：解引用 volatile 叶子、与 DEFAULTS 合并补缺、
//   归一化成对区间。零宿主依赖、可单测。

// 注意：本文件不 import 任何语义常量（src/pet-state.mjs 等）——语义层封闭，
// 配置面不得读取/覆盖它们（引用门禁守护）。
import z from '@deepseek-ai/schemastery'

export const NAMESPACE = 'whale-girl'

/** 体验层默认值（消费端唯一权威）。数值已 clamp 到安全域。 */
export const DEFAULTS = Object.freeze({
  enabled: true,          // 网页端渲染开关（桌面伴侣并存时设 false 关闭网页端宠物，避免双宠物）
  sessionMemory: false,   // 会话记忆开关（本机记录任务摘要并在恢复/fork 会话时读回；见 src/session-memory.mjs）
  size: 110,              // 宠物尺寸 px（stage 盒 + sprite 上限）
  opacity: 1,             // 常态透明度 0.2–1（inert 0.25 是交互态，不在此配）
  walk: {
    enabled: true,        // 游走开关
    minWaitMs: 18000,     // 游走间隔下限
    maxWaitMs: 40000,     // 游走间隔上限
    minMs: 3000,          // 单次游走时长下限
    maxMs: 6000,          // 单次游走时长上限
    speedPxPerSec: 45,    // 游走速度
  },
  sleepAfterMs: 60000,    // 空闲多久进入睡眠
  pollMs: 3000,           // /state 轮询间隔
  bubbleMs: 2500,         // 回话气泡时长
  welcomeMs: 6000,        // 欢迎窗口
  celebrateMs: 6000,      // 庆祝窗口
  errorMs: 4000,          // 惊吓窗口
  disappointedMs: 6000,   // 失落尾窗
  replies: {              // 互动回话文案池（用户可自定义追加；空则回退内置）
    feed: ['「啊呜——谢谢投喂！」', '「好好吃，能量满满！」', '「嘻嘻，投喂成功！」'],
    play: ['「嘿嘿，再来一次！」', '「玩得好开心～」', '「我赢了！再来！」'],
  },
})

/** 条目 Config schema：默认值= DEFAULTS（防双源漂移）；可 live 调参的叶子标 volatile。 */
export function buildSchema() {
  return z.object({
    enabled: z.boolean().default(DEFAULTS.enabled).volatile(),
    sessionMemory: z.boolean().default(DEFAULTS.sessionMemory).volatile(),
    size: z.number().min(64).max(160).default(DEFAULTS.size).volatile(),
      opacity: z.number().min(0.2).max(1).default(DEFAULTS.opacity).volatile(),
      walk: z.object({
        enabled: z.boolean().default(DEFAULTS.walk.enabled).volatile(),
        minWaitMs: z.number().min(0).max(300000).default(DEFAULTS.walk.minWaitMs).volatile(),
        maxWaitMs: z.number().min(0).max(300000).default(DEFAULTS.walk.maxWaitMs).volatile(),
        minMs: z.number().min(0).max(60000).default(DEFAULTS.walk.minMs).volatile(),
        maxMs: z.number().min(0).max(60000).default(DEFAULTS.walk.maxMs).volatile(),
        speedPxPerSec: z.number().min(10).max(300).default(DEFAULTS.walk.speedPxPerSec).volatile(),
      }),
      sleepAfterMs: z.number().min(5000).max(600000).default(DEFAULTS.sleepAfterMs).volatile(),
      pollMs: z.number().min(1000).max(30000).default(DEFAULTS.pollMs).volatile(),
      bubbleMs: z.number().min(500).max(10000).default(DEFAULTS.bubbleMs).volatile(),
      welcomeMs: z.number().min(0).max(30000).default(DEFAULTS.welcomeMs).volatile(),
      celebrateMs: z.number().min(0).max(30000).default(DEFAULTS.celebrateMs).volatile(),
      errorMs: z.number().min(0).max(15000).default(DEFAULTS.errorMs).volatile(),
      disappointedMs: z.number().min(0).max(15000).default(DEFAULTS.disappointedMs).volatile(),
      replies: z.object({
        feed: z.array(z.string()).default(DEFAULTS.replies.feed).volatile(),
        play: z.array(z.string()).default(DEFAULTS.replies.play).volatile(),
      }),
    })
}

/** volatile 叶子引用（宿主 createVolatile 注入：冻结对象、唯一自有键 get）。 */
function isConfigRef(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.get === 'function' && Object.keys(value).length === 1
}

/** 解引用：volatile 叶子取当前值；数组/普通对象递归。 */
function unwrap(value) {
  if (isConfigRef(value)) return unwrap(value.get())
  if (Array.isArray(value)) return value.map(unwrap)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrap(child)]))
}

/** 成对区间归一：min > max 时交换（写面只剩 schema 校验，值仍须可解释）。 */
function orderedPair(min, max) {
  return min > max ? [max, min] : [min, max]
}

/** 读配置快照：解引用 + 与 DEFAULTS 合并补缺 + 成对区间归一。 */
export function readConfig(config) {
  const next = unwrap(config ?? {})
  const src = next !== null && typeof next === 'object' ? next : {}
  const walk = { ...DEFAULTS.walk, ...(src.walk !== null && typeof src.walk === 'object' ? src.walk : {}) }
  const [minWaitMs, maxWaitMs] = orderedPair(walk.minWaitMs, walk.maxWaitMs)
  const [minMs, maxMs] = orderedPair(walk.minMs, walk.maxMs)
  const replies = { ...DEFAULTS.replies, ...(src.replies !== null && typeof src.replies === 'object' ? src.replies : {}) }
  return { ...DEFAULTS, ...src, walk: { ...walk, minWaitMs, maxWaitMs, minMs, maxMs }, replies }
}
