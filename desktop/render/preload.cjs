// Electron preload：暴露最小安全 IPC 面给 renderer（contextBridge）。
// renderer 只拿得到 whaleGirl.*，无 Node 全局——保持 contextIsolation 语义。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whaleGirl', {
  getManifest: () => ipcRenderer.invoke('wg:manifest'),
  getSheet: (characterId, sheet) => ipcRenderer.invoke('wg:sheet', { characterId, sheet }),
  interact: (action) => ipcRenderer.send('wg:interact', action),
  setHitarea: (rect) => ipcRenderer.send('wg:set-hitarea', rect),
  dragWindow: (dx, dy) => ipcRenderer.send('wg:drag-window', { dx, dy }),
  onAnim: (cb) => ipcRenderer.on('wg:anim', (_e, anim) => cb(anim)),
  onSnapshot: (cb) => ipcRenderer.on('wg:snapshot', (_e, snap) => cb(snap)),
  onReply: (cb) => ipcRenderer.on('wg:reply', (_e, reply) => cb(reply)),
})