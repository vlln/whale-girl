#!/usr/bin/env node
// whale-girl-desktop 入口。
// - 纯 Node 运行（node lib/index.mjs）：headless 模式（心跳 + 状态 + SSE + 日志），
//   或 --headless 显式指定。用于自测/CI/无桌面环境。
// - Electron 运行（electron . / electron lib/index.mjs）：创建透明置顶桌面窗渲染宠物，
//   核心引擎（companion）在 Electron main 进程内运行，经 IPC 把动画意图推给 renderer。

import { loadConfig } from './src/config.mjs'
import { createLogger } from './client/utils.mjs'

// 解析 CLI（在 import 副作用前做，避免被测试覆盖）
const cfg = loadConfig()
const log = createLogger({ tag: 'whale-girl-desktop' })

const isElectronMain = typeof process !== 'undefined' && process.versions?.electron !== undefined
const headless = !cfg.renderEnabled || process.argv.includes('--headless')

if (isElectronMain && !headless) {
  // —— Electron main 路径：桌面渲染 ——
  // 注意：不要顶层 await runDesktop()——runDesktop 内部 await app.whenReady()，
  // 若在入口模块顶层 await，会阻塞 Electron 事件循环导致 ready 永不触发（ESM main 陷阱）。
  // 改为 fire-and-forget：runDesktop 自带 async 生命周期，错误会先记录再退出。
  const { runDesktop } = await import('./render/window.mjs')
  process.nextTick(() => {
    runDesktop({ cfg, log }).catch((err) => {
      try { log.error('桌面渲染启动失败:', err?.message ?? err) } catch {}
      process.exit(1)
    })
  })
} else {
  // —— headless 路径：只跑核心（心跳 + 状态 + SSE），供自测与无桌面环境 ——
  const { createCompanion } = await import('./client/companion.mjs')
  const companion = await createCompanion(cfg, {
    onSnapshot: (snap) => {
      const act = snap?.activity?.name ?? '?'
      const lv = snap?.pet?.level ?? '?'
      const online = snap?.companionOnline === true
      log.info(`state: activity=${act} Lv.${lv} companionOnline=${online}`)
    },
    onAnimation: (anim) => log.debug(`anim → ${anim.name}`),
    onReply: (reply) => log.info(`reply: ${reply}`),
  })
  log.info(`headless 模式运行中：BaseURL=${cfg.baseURL} pollMs=${cfg.pollMs} heartbeatMs=${cfg.heartbeatMs}`)
  log.info('按 Ctrl+C 退出（退出时自动发送 {online:false}）')

  const shutdown = () => {
    companion.stop().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}