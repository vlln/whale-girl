// 配置系统：体验层配置 schema + 默认值（单一来源）。
// 契约：
// - 只含 L1 体验层项（用户可感知并有意愿调整的视觉/行为参数）；语义层
//   （XP/称号阈值/等级曲线/MEMORY_MAX/ACTIVE_CAP）与安全层（路由/CSRF/上限）
//   是代码级封闭集合，禁止出现在本 schema（verify-settings-schema 门禁守护）。
// - DEFAULTS 是消费端的唯一权威默认值来源；消费端（index.mjs/client 逻辑）
//   不得再写第二份默认值字面量（verify-config-sync 门禁守护）。
// - schemastery schema 供 宿主 Config 使用（宿主原生格式，可注入校验）。
// - 零宿主依赖、可单测。

// 注意：本文件不 import 任何语义常量（src/pet-state.mjs 等）——语义层封闭，
// 配置面不得读取/覆盖它们（引用门禁守护）。
import z from '@deepseek-ai/schemastery'

export const NAMESPACE = 'whale-girl'

/** 体验层默认值（消费端唯一权威）。数值已 clamp 到安全域。 */
export const DEFAULTS = Object.freeze({
  enabled: true,          // 网页端渲染开关（桌面伴侣并存时设 false 关闭网页端宠物，避免双宠物）
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

/** schemastery schema（宿主 Config 用；默认值= DEFAULTS，防双源漂移）。 */
export function buildSchema() {
  return z.object({
    enabled: z.boolean().default(DEFAULTS.enabled),
    size: z.number().min(64).max(160).default(DEFAULTS.size),
      opacity: z.number().min(0.2).max(1).default(DEFAULTS.opacity),
      walk: z.object({
        enabled: z.boolean().default(DEFAULTS.walk.enabled),
        minWaitMs: z.number().min(0).max(300000).default(DEFAULTS.walk.minWaitMs),
        maxWaitMs: z.number().min(0).max(300000).default(DEFAULTS.walk.maxWaitMs),
        minMs: z.number().min(0).max(60000).default(DEFAULTS.walk.minMs),
        maxMs: z.number().min(0).max(60000).default(DEFAULTS.walk.maxMs),
        speedPxPerSec: z.number().min(10).max(300).default(DEFAULTS.walk.speedPxPerSec),
      }),
      sleepAfterMs: z.number().min(5000).max(600000).default(DEFAULTS.sleepAfterMs),
      pollMs: z.number().min(1000).max(30000).default(DEFAULTS.pollMs),
      bubbleMs: z.number().min(500).max(10000).default(DEFAULTS.bubbleMs),
      welcomeMs: z.number().min(0).max(30000).default(DEFAULTS.welcomeMs),
      celebrateMs: z.number().min(0).max(30000).default(DEFAULTS.celebrateMs),
      errorMs: z.number().min(0).max(15000).default(DEFAULTS.errorMs),
      disappointedMs: z.number().min(0).max(15000).default(DEFAULTS.disappointedMs),
      replies: z.object({
        feed: z.array(z.string()).default(DEFAULTS.replies.feed),
        play: z.array(z.string()).default(DEFAULTS.replies.play),
      }),
    })
}

/** 跨字段校验（schema 表达不了的成对约束；配置读取时使用）。 */
export function validateConfig(value) {
  const w = value?.walk
  if (w) {
    if (w.minWaitMs > w.maxWaitMs) throw new Error('walk.minWaitMs 不得大于 walk.maxWaitMs')
    if (w.minMs > w.maxMs) throw new Error('walk.minMs 不得大于 walk.maxMs')
  }
}
