// Electron 桌面渲染壳（main 进程）：
// - 透明、无边框、置顶的宠物窗口
// - 核心引擎（createCompanion）在本进程运行，hooks 把动画意图/快照/回话经 IPC 推给 renderer
// - 渲染层零网络：manifest/sprite 由本进程拉取转 dataURL 再下发（绕过 CORS、单一数据通道）
// - 退出时显式 {online:false}（companion.stop()），网页宠物即恢复
//
// 由于鲸鱼娘 sprite 站姿是「透明图 + 四周透明」，窗口需要精确贴合内容才不挡鼠标——
// renderer 侧用 canvas 内容 bbox 计算实际不透明区，据此切换 ignoreMouseEvents（点击穿透）。

import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../client/http.mjs'
import { createCompanion } from '../client/companion.mjs'
import { createLogger } from '../client/utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RENDER_DIR = join(__dirname, '..', '..', 'render')

const DEFAULT_SIZE = 110

let win = null
let companion = null

/**
 * 创建透明置顶宠物窗口。
 */
function createWindow() {
  win = new BrowserWindow({
    width: DEFAULT_SIZE + 40,   // 稍大留呼吸边（视觉 shadow 余量）
    height: DEFAULT_SIZE + 40,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    // 只加载本地 render/ 页面（file://）+ 本机 IPC；不开 remote。
    webPreferences: {
      preload: join(RENDER_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 用 ESM 风格 require-free；保持最小
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadFile(join(RENDER_DIR, 'index.html'))

  // 默认点击穿透（只有宠物本体可交互）——renderer 每帧回调真实 bbox。
  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('closed', () => { win = null })
  return win
}

/**
 * 主进程骨架：加载 manifest/sprite，喂给 renderer。
 */
function setupIpc(client) {
  const sheetCache = new Map() // `${characterId}/${sheet}` → dataURL

  ipcMain.handle('wg:manifest', async () => {
    try {
      return await client.getManifest()
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('wg:sheet', async (_e, { characterId = 'whale-girl', sheet }) => {
    const key = `${characterId}/${sheet}`
    if (sheetCache.has(key)) return sheetCache.get(key)
    const url = `${client.url(`/assets/characters/${characterId}/${sheet}`)}`
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      const { nativeImage } = await import('electron')
      const img = nativeImage.createFromBuffer(buf)
      const dataURL = img.toDataURL()
      sheetCache.set(key, dataURL)
      return dataURL
    } catch (err) {
      console.error(`[wg:sheet] ${key} 失败:`, err.message)
      return null
    }
  })

  ipcMain.on('wg:interact', async (_e, action) => {
    if (companion) await companion.interact(action === 'play' ? 'play' : 'feed')
  })

  // 渲染层告知宠物内容 bbox → 切换点击穿透（桌面宠物不挡非宠物区域）：
  // 有内容（宠物可见）→ 窗口可交互（点击投喂/拖拽）；null（占位/空）→ 全透。
  // P2 增强：可进一步把窗口缩到内容 bbox 精确贴合（见 DESIGN §6 风险对策）。
  ipcMain.on('wg:set-hitarea', (_e, rect) => {
    if (!win) return
    win.setIgnoreMouseEvents(rect === null, { forward: true })
  })

  // 渲染层拖拽移动窗口：告知屏幕 delta（让宠物可拖动换位）
  ipcMain.on('wg:drag-window', (_e, { dx, dy }) => {
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + Math.round(dx), y + Math.round(dy))
  })
}

/**
 * 启动桌面渲染（Electron main 路径入口）。
 */
export async function runDesktop({ cfg, log }) {
  const client = createClient({ baseURL: cfg.baseURL })

  await app.whenReady()
  log.info('Electron 就绪，创建宠物窗口')
  createWindow()
  setupIpc(client)

  companion = await createCompanion(cfg, {
    onSnapshot: (snap) => {
      if (win) win.webContents.send('wg:snapshot', snap)
    },
    onAnimation: (anim) => {
      if (win) win.webContents.send('wg:anim', anim)
    },
    onReply: (reply) => {
      if (win) win.webContents.send('wg:reply', reply)
    },
  })

  log.info(`桌面渲染运行中：BaseURL=${cfg.baseURL}（在场上线）`)

  const shutdown = async () => {
    if (companion) await companion.stop()
    app.quit()
  }
  app.on('before-quit', (e) => {
    // 幂等：before-quit 可多次触发
  })
  app.on('window-all-closed', () => {
    // 宠物窗口关闭 = 退出（不留后台）
    shutdown()
  })
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}