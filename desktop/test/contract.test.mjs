// whale-girl-desktop 契约测试：
// 1. 纯函数单测：状态机（state.mjs / scheduler.mjs / behaviors.mjs）确定性映射
// 2. 端到端契约测试：连真实 DSH web（/state /config /presence /interact /assets）
//    —— 验证本端点到 whale-girl 的消费契约与 DESIGN.md §3 一致
//
// 运行：npm test（node --test test/）。
// 端到端部分需要 DSH web 在 http://127.0.0.1:3080（WHALE_GIRL_BASE_URL 可覆盖）。

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../lib/src/config.mjs'
import { createClient } from '../lib/client/http.mjs'
import { pickState, pickAnimation } from '../lib/client/state.mjs'
import { createScheduler, stepScheduler, applyInteraction } from '../lib/client/scheduler.mjs'
import { nextWorkingRhythm } from '../lib/client/behaviors.mjs'
import { createSSEClient } from '../lib/client/events.mjs'
import { STATE_NAMES } from '../lib/client/state-names.mjs'

const BASE = loadConfig().baseURL

// live 套件依赖真实 DSH web。探活一次（缓存）来给 describe 动态 skip：
// 服务不可达 → 套件整体 skip（CI / 无服务环境不误判失败）；WG_LIVE=1 则强制要求真跑。
let _liveProbe = null
async function liveReachable() {
  if (_liveProbe === null) {
    try {
      await fetch(`${BASE}/whale-girl/state`, { cache: 'no-store' })
      _liveProbe = true
    } catch {
      _liveProbe = false
    }
  }
  return _liveProbe
}
const liveAvailable = await liveReachable()
const forceLive = process.env.WG_LIVE === '1'

// ---------- 状态机纯函数 ----------

describe('state machine (pickState)', () => {
  const now = 1_000_000

  it('idle 为兜底', () => {
    assert.equal(pickState({ activity: { name: 'idle', until: 0 }, now }), 'idle')
  })

  it('activity burst 优先（celebrate/error/welcome within until）', () => {
    for (const name of ['celebrate', 'error', 'disappointed', 'welcome']) {
      assert.equal(
        pickState({ activity: { name, until: now + 1000 }, now }),
        name,
        `burst ${name} 应优先`,
      )
    }
  })

  it('burst 过期后回到底层状态', () => {
    assert.equal(
      pickState({ activity: { name: 'celebrate', until: now - 1 }, now, sessionThink: true }),
      'think',
    )
  })

  it('sessionWait → wait', () => {
    assert.equal(
      pickState({ activity: { name: 'idle', until: 0 }, now, sessionWait: true }),
      'wait',
    )
  })

  it('sessionThink → think（无插曲时）', () => {
    assert.equal(
      pickState({ activity: { name: 'idle', until: 0 }, now, sessionThink: true }),
      'think',
    )
  })

  it('turnCompletedUntil 窗口 → celebrate（低于事件 burst）', () => {
    assert.equal(
      pickState({ activity: { name: 'idle', until: 0 }, now, celebrateUntil: now + 1000 }),
      'celebrate',
    )
    // 事件 burst 覆盖回合完成庆祝
    assert.equal(
      pickState({ activity: { name: 'error', until: now + 500 }, now, celebrateUntil: now + 1000 }),
      'error',
    )
  })

  it('sleep 在 idle 且空闲超时后', () => {
    assert.equal(pickState({ activity: { name: 'idle', until: 0 }, now, sleep: true }), 'sleep')
  })

  it('transient eat/play/wake', () => {
    assert.equal(pickState({ activity: { name: 'idle', until: 0 }, now, transient: 'eat' }), 'eat')
    assert.equal(pickState({ activity: { name: 'idle', until: 0 }, now, transient: 'play' }), 'play')
    assert.equal(pickState({ activity: { name: 'idle', until: 0 }, now, transient: 'wake' }), 'wake')
  })
})

describe('working rhythm (nextWorkingRhythm)', () => {
  const now = 5_000_000
  it('会话不活跃 → 关闭', () => {
    assert.deepEqual(nextWorkingRhythm({ now, sessionThink: false }), { active: false, until: 0 })
  })
  it('思考期非工作 → 进入 working，until 在未来', () => {
    const r = nextWorkingRhythm({ now, sessionThink: true, working: { active: false, until: 0 } })
    assert.equal(r.active, true)
    assert.ok(r.until > now)
  })
  it('工作期结束 → 回 think', () => {
    const r = nextWorkingRhythm({ now, sessionThink: true, working: { active: true, until: now } })
    assert.equal(r.active, false)
    assert.ok(r.until > now)
  })
})

describe('scheduler (stepScheduler + applyInteraction)', () => {
  const now = 2_000_000
  it('空闲开始计时，超 sleepAfterMs 入睡', () => {
    const s = createScheduler({ sleepAfterMs: 60_000 })
    stepScheduler(s, { snapshot: { activity: { name: 'idle', until: 0 } }, now })
    assert.equal(s.sleeping, false, '刚 idle 不立刻睡')
    stepScheduler(s, { snapshot: { activity: { name: 'idle', until: 0 } }, now: now + 61_000 })
    assert.equal(s.sleeping, true, '空闲超 60s 入睡')
  })

  it('会话活跃重置空闲起点（不因工作期误判睡眠）', () => {
    const s = createScheduler()
    // 先 idle 60s（睡），然后 working
    stepScheduler(s, { snapshot: { activity: { name: 'idle', until: 0 } }, now })
    stepScheduler(s, { snapshot: { activity: { name: 'idle', until: 0 } }, now: now + 61_000 })
    assert.equal(s.sleeping, true)
    stepScheduler(s, { snapshot: { activity: { name: 'working', until: now + 1000 } }, now: now + 62_000 })
    assert.equal(s.sleeping, false, '工作态下不判睡')
    assert.equal(s.idleSince, 0, '活跃重置空闲起点')
  })

  it('interact 后播 eat/play + 喜悦，睡眠被唤醒', () => {
    const s = createScheduler()
    stepScheduler(s, { snapshot: { activity: { name: 'idle', until: 0 } }, now })
    stepScheduler(s, { snapshot: { activity: { name: 'idle', until: 0 } }, now: now + 61_000 })
    assert.equal(s.sleeping, true)
    applyInteraction(s, 'feed')
    assert.equal(s.transient, 'eat')
    assert.equal(s.sleeping, false)
    applyInteraction(s, 'play')
    assert.equal(s.transient, 'play')
  })

  it('瞬发播完（超时）回 joy，再跌落', () => {
    const s = createScheduler()
    applyInteraction(s, 'feed')
    assert.equal(s.transient, 'eat')
    stepScheduler(s, { snapshot: { activity: { name: 'idle', until: 0 } }, now: Date.now() + 2000 })
    assert.equal(s.transient, null)
    assert.ok(s.joyUntil > 0, '互动后进入喜悦窗口')
  })
})

describe('state names', () => {
  it('15 状态权威集合（与 whale-girl 一致）', () => {
    assert.deepEqual([...STATE_NAMES], [
      'idle', 'working', 'celebrate', 'error', 'disappointed', 'joy', 'eat', 'play',
      'drag', 'walk', 'sleep', 'wake', 'welcome', 'think', 'wait',
    ])
  })
})

// ---------- SSE 客户端 ----------

describe('SSE client', () => {
  it('解析 data 事件并触发回调（本地 http server 模拟）', async () => {
    const http = await import('node:http')
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 1000\n\n')
      res.write('data: {"type":"event"}\n\n')
      setTimeout(() => {
        res.write(': ping\n\n')
        res.end()
      }, 50)
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port

    const got = []
    const sse = createSSEClient(`http://127.0.0.1:${port}/events`)
    await new Promise((resolve) => {
      sse.events.on('event', (payload) => {
        got.push(payload)
        if (got.length >= 1) resolve()
      })
    })
    sse.close()
    await new Promise((r) => server.close(r))
    assert.deepEqual(got, ['{"type":"event"}'])
  })
})

// ---------- 端到端契约（需 DSH web 运行中） ----------
// live 套件依赖真实 DSH web。服务不可达时整组 skip（CI 不误判）；WG_LIVE=1 强制真跑（不可达即失败）。

describe('whale-girl contract (live)', { skip: !liveAvailable && !forceLive }, () => {
  let client
  let companion

  before(async () => {
    client = createClient({ baseURL: BASE })
  })

  it('GET /state 符合契约形状', async () => {
    const body = await client.getState()
    assert.equal(typeof body.apiVersion, 'number')
    assert.equal(typeof body.pet?.level, 'number')
    assert.equal(typeof body.pet?.xp, 'number')
    assert.equal(typeof body.pet?.stats?.tasksDone, 'number')
    assert.equal(typeof body.activity?.name, 'string')
    assert.ok(['idle', 'working', 'welcome', 'celebrate', 'error', 'disappointed'].includes(body.activity.name))
    assert.equal(typeof body.configRevision, 'number')
    assert.equal(typeof body.companionOnline, 'boolean')
  })

  it('GET /config 返回 { config, revision }', async () => {
    const body = await client.getConfig()
    assert.equal(typeof body.revision, 'number')
    assert.equal(typeof body.config?.enabled, 'boolean')
    assert.equal(typeof body.config?.size, 'number')
  })

  it('GET /assets/manifest.json 含 whale-girl 角色与 15 状态', async () => {
    const m = await client.getManifest()
    const states = m?.characters?.['whale-girl']?.states
    assert.ok(states, 'manifest 应有 whale-girl 角色')
    const keys = Object.keys(states)
    for (const s of STATE_NAMES) assert.ok(keys.includes(s), `缺少状态 ${s}`)
  })

  it('POST /presence {online:true} → 在线；{online:false} → 下线', async () => {
    const up = await client.setPresence(true)
    assert.equal(up.online, true)
    // 状态里 companionOnline 应同步
    const st = await client.getState()
    assert.equal(st.companionOnline, true)
    const down = await client.setPresence(false)
    assert.equal(down.online, false)
    const st2 = await client.getState()
    assert.equal(st2.companionOnline, false)
  })

  it('POST /interact feed/play → { pet, reply }', async () => {
    const r = await client.interact('feed')
    assert.equal(typeof r.pet?.level, 'number')
    assert.equal(typeof r.reply, 'string')
    const r2 = await client.interact('play')
    assert.equal(typeof r2.reply, 'string')
  })

  it('GET /assets/characters/whale-girl/idle.png → HTTP 200 image/png', async () => {
    const res = await fetch(`${client.url('/assets/characters/whale-girl/idle.png')}`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /image\/png/)
    const buf = await res.arrayBuffer()
    assert.ok(buf.byteLength > 1000)
  })

  it('companion 端到端：createCompanion 心跳 + 拉 state + stop 下线', async () => {
    const { createCompanion } = await import('../lib/client/companion.mjs')
    companion = await createCompanion({ ...loadConfig(), autoPresence: true, eventsEnabled: true }, {
      onAnimation: () => {},
      onSnapshot: () => {},
      onReply: () => {},
    })
    assert.ok(companion.getState()?.pet, 'companion 应已拉到 state')
    const st = await client.getState()
    assert.equal(st.companionOnline, true, 'companion 启动后应在场')
    await companion.stop()
    const st2 = await client.getState()
    assert.equal(st2.companionOnline, false, 'companion stop 后应下线')
  })

  after(async () => {
    if (companion) await companion.stop()
  })
})

describe('config load', () => {
  it('默认 BaseURL', () => {
    const c = loadConfig({ env: {}, argv: [] })
    assert.equal(c.baseURL, 'http://127.0.0.1:3080')
    assert.equal(c.pollMs, 3000)
    assert.equal(c.heartbeatMs, 15000)
  })
  it('CLI 覆盖', () => {
    const c = loadConfig({ env: {}, argv: ['node', 'lib/index.mjs', '--headless', '--poll-ms=5000'] })
    assert.equal(c.renderEnabled, false)
    assert.equal(c.pollMs, 5000)
  })
})