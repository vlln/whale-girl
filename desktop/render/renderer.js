// 渲染层（renderer）：Canvas 帧播放器 + 内容 bbox 点击穿透 + 气泡/角标。
// 数据全部来自主进程 IPC（whaleGirl.*），零网络、零 CORS 面。
// 帧播放对齐 whale-girl manifest（每状态一张横排 sheet：frames/fps/playback/motion）。

(() => {
  'use strict'

  const wg = window.whaleGirl
  if (!wg) { console.error('[renderer] 无 whaleGirl bridge（preload 未加载）'); return }

  const canvas = document.getElementById('pet')
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  const bubble = document.getElementById('bubble')
  const badge = document.getElementById('badge')

  let manifest = null
  let characterId = 'whale-girl'
  const sheetCache = new Map() // `${characterId}/${sheet}` → { img, w, h }
  let animState = 'idle'
  let animCtx = {}
  let frame = 0
  let frameDir = 1
  let lastFrameAt = 0
  let blinkActive = false
  let blinkAt = 0
  let flip = 1
  let facingAt = 0
  let snapshot = null
  let bubbleTimer = null

  // ---- 画布尺寸（跟随 manifest stageSize；配置跟随 P1-4 预留） ----
  const PET_BASE = 110
  function applySize() {
    const size = PET_BASE
    canvas.width = size
    canvas.height = size
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
  }

  // ---- 状态配置 ----
  function stateCfg(name) {
    return manifest?.characters?.[characterId]?.states?.[name] ?? null
  }
  function sheetKey(sheet) {
    return `${characterId}/${sheet}`
  }
  // 安全帧数：单帧状态 frames=1 (frames>=1 恒真)；防损坏 manifest frames<=0 除零（reviewer 建议）。
  function framesOf(cfg) {
    const n = cfg?.frames
    return typeof n === 'number' && n > 0 ? Math.floor(n) : 1
  }
  async function ensureSheet(cfg) {
    if (!cfg || !cfg.sheet) return null
    const key = sheetKey(cfg.sheet)
    if (sheetCache.has(key)) return sheetCache.get(key)
    const dataURL = await wg.getSheet(characterId, cfg.sheet)
    if (!dataURL) { sheetCache.set(key, null); return null }
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = dataURL
    })
    const entry = { img, w: img.naturalWidth, h: img.naturalHeight }
    sheetCache.set(key, entry)
    return entry
  }

  // ---- 帧推进（playback 对齐 whale-girl：loop/pingpong/once/blink） ----
  function tickFrame(now) {
    const cfg = stateCfg(animState)
    if (!cfg || !cfg.sheet) return
    if (!(cfg.frames > 1)) return // 单帧状态由 CSS motion 表现（本端简化为静止）

    const step = () => {
      const entry = sheetCache.get(sheetKey(cfg.sheet))
      if (!entry) return // sheet 未就绪：跳过本帧（不裁切）
      const frames = framesOf(cfg)
      const frameW = Math.floor(entry.w / frames)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.scale(flip, 1)
      // 源矩形用 sprite 自身尺寸（entry.w/entry.h），不用 canvas 尺寸——
      // canvas 缩放/尺寸变化不会产生源越界裁切（Copilot: 源高度 entry.h）。
      ctx.drawImage(
        entry.img,
        frame * frameW, 0, frameW, entry.h,
        -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height,
      )
      ctx.restore()
    }

    if (cfg.playback === 'blink') {
      if (blinkActive) {
        if (now - lastFrameAt >= 1000 / cfg.fps) {
          lastFrameAt = now
          frame += 1
          if (frame >= cfg.frames) { frame = 0; blinkActive = false; blinkAt = now + rand(3000, 9000) }
          step()
        }
      } else {
        if (frame !== 0) { frame = 0; step() }
        if (blinkAt === 0) blinkAt = now + rand(3000, 9000)
        if (now >= blinkAt) blinkActive = true
      }
      return
    }

    if (now - lastFrameAt >= 1000 / (cfg.fps || 2)) {
      lastFrameAt = now
      frame += frameDir
      if (cfg.playback === 'pingpong') {
        if (frame >= cfg.frames - 1 || frame <= 0) frameDir *= -1
        frame = Math.max(0, Math.min(cfg.frames - 1, frame))
      } else if (frame >= cfg.frames) {
        if (cfg.playback === 'loop') frame = 0
        else frame = cfg.frames - 1 // once：保持末帧
      }
      step()
    } else if (!sheetCache.get(sheetKey(cfg.sheet))?.rendered) {
      step()
    }
  }

  // ---- 随机穿梭/转身（对齐 whale-girl：静态态偶尔转身） ----
  function tickFacing(now, cfg) {
    if (animState === 'idle' || animState === 'think' || animState === 'wait') {
      if (facingAt === 0) facingAt = now + rand(10000, 25000)
      if (now >= facingAt) {
        flip = -flip
        facingAt = now + rand(10000, 25000)
        // 立即重绘（否则等待下一帧推进）
        const entry = sheetCache.get(sheetKey(cfg.sheet))
        if (entry?.rendered) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.save(); ctx.translate(canvas.width/2, canvas.height/2); ctx.scale(flip, 1)
          const frameW = Math.floor(entry.w / framesOf(cfg))
          ctx.drawImage(entry.img, frame * frameW, 0, frameW, entry.h, -canvas.width/2, -canvas.height/2, canvas.width, canvas.height)
          ctx.restore()
        }
      }
    } else if (facingAt !== 0) {
      facingAt = 0
    }
  }

  function rand(min, max) {
    return min + Math.random() * (max - min)
  }

  // ---- 切换动画状态 ----
  let switchingState = false
  async function switchAnim(next) {
    const name = next?.name || 'idle'
    if (name === animState) {
      animCtx = next?.context ?? animCtx
      return
    }
    animState = name
    animCtx = next?.context ?? animCtx
    frame = 0
    frameDir = 1
    blinkActive = false
    blinkAt = 0
    lastFrameAt = 0
    applySize()
    const cfg = stateCfg(name)
    if (!cfg) { drawPlaceholder(); return }
    await ensureSheet(cfg)
    drawFrame()
    reportHitarea()
  }

  function drawPlaceholder() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(canvas.width/2, canvas.height/2)
    ctx.font = `${Math.floor(canvas.width * 0.4)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🐳', 0, 0)
    ctx.restore()
  }

  function drawFrame() {
    const cfg = stateCfg(animState)
    if (!cfg) return drawPlaceholder()
    const entry = sheetCache.get(sheetKey(cfg.sheet))
    if (!entry) return drawPlaceholder()
    const frameW = Math.floor(entry.w / framesOf(cfg))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.scale(flip, 1)
    ctx.drawImage(entry.img, frame * frameW, 0, frameW, entry.h,
      -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height)
    ctx.restore()
    entry.rendered = true
  }

  // ---- 内容 bbox → 点击穿透（宠物本体可交互，透明区点击穿透） ----
  function reportHitarea() {
    const cfg = stateCfg(animState)
    const entry = sheetCache.get(sheetKey(cfg?.sheet))
    if (!entry) { wg.setHitarea(null); return }
    const frameW = Math.floor(entry.w / framesOf(cfg))
    // 读当前帧 Alpha（只在状态切换/变换后读一次，小图可接受）
    const off = document.createElement('canvas')
    off.width = frameW; off.height = entry.h
    const octx = off.getContext('2d')
    octx.drawImage(entry.img, frame * frameW, 0, frameW, entry.h, 0, 0, frameW, entry.h)
    const data = octx.getImageData(0, 0, frameW, entry.h).data
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
    for (let y = 0; y < entry.h; y++) {
      for (let x = 0; x < frameW; x++) {
        if (data[(y * frameW + x) * 4 + 3] > 24) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) { wg.setHitarea(null); return }
    // 归一化到画布坐标（canvas.width / frameW 是缩放比）
    const scaleX = canvas.width / frameW
    const scaleY = canvas.height / entry.h
    wg.setHitarea({
      x: minX * scaleX, y: minY * scaleY,
      w: (maxX - minX + 1) * scaleX, h: (maxY - minY + 1) * scaleY,
    })
  }

  // ---- 主循环（60fps 够了；帧推进按 fps） ----
  function loop(now) {
    const cfg = stateCfg(animState)
    if (cfg) {
      tickFrame(now)
      tickFacing(now, cfg)
    } else if (animState) {
      drawPlaceholder()
    }
    requestAnimationFrame(loop)
  }

  // ---- 气泡 / 角标 ----
  function showBubble(text) {
    bubble.textContent = text
    bubble.classList.add('show')
    clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 2500)
  }
  function renderBadge() {
    if (!snapshot) { badge.classList.remove('show'); return }
    const p = snapshot.pet
    const titles = (p?.titles?.length ?? 0)
    badge.textContent = `Lv.${p?.level ?? 1} · ${p?.stats?.tasksDone ?? 0} 任务` + (titles ? ` · ${titles} 称号` : '')
    if ((snapshot?.activity?.sessionThink ?? false)) badge.textContent += ' · 思考中'
    badge.classList.add('show')
  }

  // ---- 交互：点击 / 拖拽 ----
  let dragStart = null
  canvas.addEventListener('pointerdown', (e) => {
    dragStart = { x: e.screenX, y: e.screenY, moved: false }
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!dragStart) return
    const dx = e.screenX - dragStart.x
    const dy = e.screenY - dragStart.y
    if (!dragStart.moved && Math.hypot(dx, dy) > 6) dragStart.moved = true
    if (dragStart.moved) {
      wg.dragWindow(dx, dy) // 主进程移动窗口（基于绝对值更稳：传由主进程记录起点）
      dragStart.x = e.screenX
      dragStart.y = e.screenY
    }
  })
  canvas.addEventListener('pointerup', (e) => {
    if (dragStart && !dragStart.moved) {
      // 点击 = 互动：轮换 feed/play
      const action = (sessionStorage.getItem('wg:lastAction') === 'feed') ? 'play' : 'feed'
      sessionStorage.setItem('wg:lastAction', action)
      wg.interact(action)
    }
    dragStart = null
  })

  // ---- IPC 订阅 ----
  wg.onAnim(async (anim) => {
    await switchAnim(anim)
  })
  wg.onSnapshot((snap) => {
    snapshot = snap
    renderBadge()
  })
  wg.onReply((reply) => {
    if (reply) showBubble(reply)
  })

  // ---- 启动 ----
  ;(async () => {
    manifest = await wg.getManifest()
    // 默认角色
    if (manifest?.default) characterId = manifest.default
    applySize()
    await switchAnim({ name: 'idle', context: {} })
    requestAnimationFrame(loop)
    renderBadge()
  })()
})()