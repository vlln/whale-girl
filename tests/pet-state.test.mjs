// 积累账本单测（node:test，零依赖）。归属：src/pet-state.mjs 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INITIAL_STATE, MEMORY_MAX, TASK_XP, SESSION_XP, RESUME_XP, xpForLevel, levelFor,
  recordTaskCompleted, recordFailure, recordSession, recordSessionResume, recordActive, ACTIVE_CAP_MS, titleName,
} from '../lib/src/pet-state.mjs'

const NOW = 1_700_000_000_000

test('初始账本为冻结默认值（零负反馈：无 hunger/mood 字段）', () => {
  assert.deepEqual(INITIAL_STATE, {
    level: 1, xp: 0,
    stats: { tasksDone: 0, failures: 0, sessions: 0, activeMs: 0, firstSeenAt: null },
    titles: [], memory: [], locale: 'zh', updatedAt: 0,
  })
  assert.equal(Object.isFrozen(INITIAL_STATE), true)
  assert.equal('hunger' in INITIAL_STATE, false)
  assert.equal('mood' in INITIAL_STATE, false)
})

test('xpForLevel 三角数列与 levelFor 互逆', () => {
  assert.equal(xpForLevel(1), 0)
  assert.equal(xpForLevel(2), 50)
  assert.equal(xpForLevel(3), 150)
  assert.equal(levelFor(0), 1)
  assert.equal(levelFor(49), 1)
  assert.equal(levelFor(50), 2)
  assert.equal(levelFor(149), 2)
  assert.equal(levelFor(150), 3)
})

test('levelFor 闭式解：巨量 xp 瞬时返回且与 xpForLevel 往返一致（原线性循环会挂起宿主）', () => {
  const l = levelFor(1e14) // 封顶 XP_SAFE_MAX 内
  assert.ok(xpForLevel(l) <= 1e14 && 1e14 < xpForLevel(l + 1))
  assert.ok(Number.isFinite(levelFor(Number.MAX_VALUE))) // 溢出被内部上限吸收
  assert.ok(levelFor(-5) >= 1) // 负值钳制
})

test('recordTaskCompleted：+XP、记统计、写回忆、不可变', () => {
  const base = { ...INITIAL_STATE, updatedAt: 0 }
  const { state } = recordTaskCompleted(base, '任务甲', NOW)
  assert.equal(state.stats.tasksDone, 1)
  assert.equal(state.xp, TASK_XP)
  assert.equal(state.level, 1)
  assert.match(state.memory[0], /完成任务「任务甲」（第 1 个）/)
  assert.equal(base.stats.tasksDone, 0) // 不可变
  assert.equal(state.updatedAt, NOW)
})

test('recordTaskCompleted：长标签截断（回忆用可读标签而非 UUID）', () => {
  const long = 'a3f9c2d1e4b5a6b7c8d9e0f1a2b3c4d5e6f7a8b9'
  const { state } = recordTaskCompleted({ ...INITIAL_STATE, updatedAt: 0 }, long, NOW)
  assert.match(state.memory[0], /「a3f9c2d1e4b5a6…」/)
  assert.ok(state.memory[0].length < 50)
})

test('任务完成解锁称号「初次协作」', () => {
  const { state, unlocked } = recordTaskCompleted({ ...INITIAL_STATE, updatedAt: 0 }, 'x', NOW)
  assert.deepEqual(unlocked, ['初次协作'])
  assert.ok(state.titles.includes('first-task'))
})

test('升级：XP 越过阈值时 leveledUp 且回忆含升级', () => {
  const base = { ...INITIAL_STATE, xp: 45, level: 1, updatedAt: 0 }
  const { state, leveledUp } = recordTaskCompleted(base, 'x', NOW)
  assert.equal(leveledUp, true)
  assert.equal(state.level, 2)
  assert.ok(state.memory.some((m) => /升到 Lv\.2/.test(m)))
})

test('recordFailure：只计数不惩罚（无 XP、不扣等级）', () => {
  const base = { ...INITIAL_STATE, xp: 100, level: 2, updatedAt: 0 }
  const { state } = recordFailure(base, NOW)
  assert.equal(state.stats.failures, 1)
  assert.equal(state.xp, 100)
  assert.equal(state.level, 2)
  assert.match(state.memory[0], /任务失败（第 1 次）/)
})

test('5 次失败解锁「越挫越勇」', () => {
  let s = { ...INITIAL_STATE, updatedAt: 0 }
  let unlocked = []
  for (let i = 0; i < 5; i++) {
    const r = recordFailure(s, NOW + i)
    s = r.state
    unlocked = r.unlocked
  }
  assert.ok(unlocked.includes('越挫越勇'))
})

test('recordSession：+XP、记首见时间', () => {
  const { state } = recordSession({ ...INITIAL_STATE, updatedAt: 0 }, NOW)
  assert.equal(state.stats.sessions, 1)
  assert.equal(state.stats.firstSeenAt, NOW)
  assert.equal(state.xp, SESSION_XP)
})

test('recordSessionResume：+RESUME_XP、不计会话数、不记首见（续接 ≠ 新会话）', () => {
  const base = { ...INITIAL_STATE, updatedAt: 0, stats: { ...INITIAL_STATE.stats, sessions: 3, firstSeenAt: 100 } }
  const { state } = recordSessionResume(base, NOW)
  assert.equal(state.stats.sessions, 3) // 计数不变
  assert.equal(state.stats.firstSeenAt, 100) // 首见不变
  assert.equal(state.xp, RESUME_XP)
  assert.match(state.memory[0], /回到旧会话/)
})

test('recordActive：活跃时长积累且称号「常驻伙伴」在 6h 解锁', () => {
  let s = { ...INITIAL_STATE, updatedAt: 0 }
  // 6h 由 5min 封顶增量多次累加（单次封顶后无「睡眠一夜刷称号」路径）。
  for (let i = 0; i < 72; i++) s = recordActive(s, 5 * 60_000, NOW + i).state
  assert.equal(s.stats.activeMs, 6 * 3_600_000)
  assert.ok(s.titles.includes('regular'))
})

test('recordActive：单次增量封顶 ACTIVE_CAP_MS（睡眠后首轮不一次计满）', () => {
  const s = recordActive({ ...INITIAL_STATE, updatedAt: 0 }, 6 * 3_600_000, NOW).state
  assert.equal(s.stats.activeMs, ACTIVE_CAP_MS)
  assert.ok(!s.titles.includes('regular')) // 单次睡眠不计满 6h
})

test('回忆环形上限 MEMORY_MAX', () => {
  let s = { ...INITIAL_STATE, updatedAt: 0 }
  for (let i = 0; i < MEMORY_MAX + 3; i++) {
    s = recordFailure(s, NOW + i).state
  }
  assert.equal(s.memory.length, MEMORY_MAX)
})

test('titleName 未知 id 原样返回', () => {
  assert.equal(titleName('first-task'), '初次协作')
  assert.equal(titleName('unknown-id'), 'unknown-id')
})

test('titleName：按 locale 渲染称号名（zh 为旧行为）', () => {
  assert.equal(titleName('first-task', 'ru'), 'Первое сотрудничество')
  assert.equal(titleName('veteran', 'en'), 'Forged veteran')
  assert.equal(titleName('social', 'zh'), '广结善缘')
})

test('记忆日志按写入 locale 渲染，XP/称号语义不变', () => {
  const base = { ...INITIAL_STATE, updatedAt: 0 }
  const ru = recordTaskCompleted(base, 'сборка', NOW, 'ru').state
  assert.equal(ru.xp, TASK_XP)
  assert.deepEqual(ru.titles, ['first-task'])
  assert.equal(ru.locale, 'ru')
  assert.match(ru.memory.at(-1), /^\[\d\d:\d\d\] Задача «сборка» выполнена \(1-я\)$/)

  const en = recordTaskCompleted(base, 'build', NOW, 'en').state
  assert.equal(en.xp, TASK_XP)
  assert.match(en.memory.at(-1), /Completed task "build" \(#1\)/)
})

test('旧记忆记录保持原文（不回溯翻译）', () => {
  const base = {
    ...INITIAL_STATE,
    updatedAt: 0,
    memory: ['[10:00] 回到旧会话，继续陪伴'],
    stats: { ...INITIAL_STATE.stats, sessions: 1 },
  }
  const { state } = recordSession(base, NOW, 'ru')
  assert.equal(state.memory[0], '[10:00] 回到旧会话，继续陪伴')
  assert.match(state.memory.at(-1), /Новая сессия \(2-я\)/)
})
