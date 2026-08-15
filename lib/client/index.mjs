// whale-girl 浏览器 half：纯 DOM 自渲染宠物层（A 模式——GUI 内悬浮宠物）。
// 官方 repository-plugin 形态：自执行 UI 脚本（经 entry 的 UI 路由与 httpServer.tapIndex
// 注入，由页面 <script> 加载；无 __ModuleLoader__/fiber 注入——见决策记录
// 2026-08-10-migrate-to-official-repository-plugin.md）。零平台模块依赖：CSS 内联注入，
// 动画/拖拽/菜单全部自建。
//
// 视觉：sprite sheet 帧播放器（assets/manifest.json 声明 状态→sheet/frames/fps/playback，
// 每状态一张横排帧图，透明背景）；sheet 缺失/未加载时显示占位（不再 emoji 降级）。
// 状态选择与表情映射是纯函数（client/logic.mjs，可单测）；本文件只做 DOM 与计时。
// 交互要点：瞬发 eat/play 由 TRANSIENT_MS 超时兜底复位（sheet 缺失也保证不卡死）；
// pointer capture 只在越过拖拽阈值后启用（纯点击不捕获，菜单按钮 click 正常派发）。

import { TRANSIENT_MS, WAKE_MS, JOY_MS, ROUND_CELEBRATE_MS, pickState, nextWorkingRhythm, shouldWake, nextBlinkAt, nextFacingAt, wakeFromInteraction } from './logic.mjs'
import { parseCharacters, getCharacter, stateOf, listCharacters } from './character.mjs'
// 路由端点单一来源（src/routes.mjs，verify-routes-sync 门禁守护）：esbuild 内联进 bundle。
import { STATE_PATH, INTERACT_PATH, CONFIG_PATH, ASSETS_PATH, EVENTS_PATH } from '../src/routes.mjs'

const ASSETS_URL = ASSETS_PATH
const MANIFEST_URL = `${ASSETS_URL}/manifest.json`
// 客户端运行参数：默认值与 Node half 的 src/config.mjs DEFAULTS 一致（单一来源——
// 消费端不写第二份默认值，见 verify-config-sync 门禁）。/state 的 configRevision
// 变化时拉取新值（applyClientConfig），未配置时用默认值。
const CFG_DEFAULTS = {
  enabled: true, size: 110, opacity: 1,
  walk: { enabled: true, minWaitMs: 18000, maxWaitMs: 40000, minMs: 3000, maxMs: 6000, speedPxPerSec: 45 },
  sleepAfterMs: 60000, pollMs: 3000, bubbleMs: 2500,
}
let cfg = { ...CFG_DEFAULTS }
// 动画状态机检查频率：50ms 时每秒 20 次条件检查，空闲标签页持续耗 CPU；
// 200ms 对眨眼/转身（随机间隔 3-25s）的触发延迟最多 200ms，肉眼无感。帧切换由
// cfg.fps 控制、游走由 rAF 驱动，均不受此值影响；页面隐藏时定时器整体暂停（onVisibility）。
const TICK_MS = 200
// 拖拽放下缓冲时长：放下后短暂回 idle（1.5s）再进入底层状态，避免生硬切换。
const DRAG_RELEASE_MS = 1500

const CSS = `
[data-whale-girl] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  font-family: system-ui, sans-serif; user-select: none; touch-action: none;
  opacity: var(--pet-opacity, 1); }
[data-whale-girl] .pet-stage { position: relative; width: var(--pet-size, 110px); height: var(--pet-size, 110px); display: grid; place-items: center;
  font-size: calc(var(--pet-size, 110px) * 0.4); line-height: 1; text-align: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25));
  pointer-events: none; /* 视觉层不拦事件——交互统一由 hitarea（贴合内容 bbox）承载，四周透明不可点 */
[data-whale-girl] .pet-effects { position: absolute; left: 0; top: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  pointer-events: none; overflow: visible; z-index: 2; }
[data-whale-girl] .pet-hitarea { position: absolute; inset: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  cursor: grab; touch-action: none; z-index: 3; border-radius: 8px; }
[data-whale-girl] .pet-sprite { pointer-events: none; /* 视觉层：定位/尺寸/transform 由 JS 内联（宿主可能覆盖 CSS 注入） */ }
[data-whale-girl] .pet-sprite.ready { display: block; }
/* 状态卡：默认置于宠物下方，间距足够（角色 bob 浮动 ±4px 不触到）+ 贴底时翻上方。 */
[data-whale-girl] .pet-status { position: absolute; left: 50%; top: calc(100% + 18px); transform: translateX(-50%);
  width: max-content; min-width: 96px; max-width: calc(100vw - 24px); padding: 5px 8px;
  background: rgba(27,30,40,.94); backdrop-filter: blur(10px) saturate(1.15);
  border: 1px solid rgba(255,255,255,.10); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.38), 0 3px 8px rgba(0,0,0,.28);
  color: #E8EBF2; font-size: 11px; display: grid; gap: 4px; z-index: 1;
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity .15s ease-out, transform .15s ease-out, visibility 0s linear .2s; }
[data-whale-girl] .pet-status::after { /* 连接尾：命中区覆盖宠物↔卡片间隙，hover 连续不闪断 */
  content: ''; position: absolute; left: 50%; top: -5px; width: 10px; height: 10px;
  transform: translateX(-50%) rotate(45deg); background: rgba(27,30,40,.94);
  border-top: 1px solid rgba(255,255,255,.10); border-left: 1px solid rgba(255,255,255,.10);
  border-top-left-radius: 3px; pointer-events: auto; }
[data-whale-girl]:hover .pet-status,
[data-whale-girl]:focus-within .pet-status {
  opacity: 1; visibility: visible; pointer-events: auto;
  transform: translateX(-50%) translateY(0);
  transition: opacity .2s cubic-bezier(.16,1,.3,1), transform .2s cubic-bezier(.16,1,.3,1), visibility 0s;
  transition-delay: .06s; }
[data-whale-girl] .pet-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
[data-whale-girl] .pet-lv { background: rgba(86,134,254,.16); color: #B7C8FE; border-radius: 5px;
  padding: 2px 6px; font-size: 10px; font-weight: 600; line-height: 16px; white-space: nowrap; }
[data-whale-girl] .pet-stats { color: #E8EBF2; font-size: 11px; line-height: 16px;
  font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-whale-girl] .pet-note { color: #E8EBF2; font-size: 11px; line-height: 15px;
  text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
[data-whale-girl] .pet-status::after { /* 连接尾：命中区覆盖宠物↔卡片间隙，hover 连续不闪断（main 定位由 JS 内联） */
  content: ''; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px;
  transform: translateX(-50%) rotate(45deg); background: rgba(24,28,38,.94);
  border-top: 1px solid rgba(255,255,255,.10); border-left: 1px solid rgba(255,255,255,.10);
  border-top-left-radius: 3px; pointer-events: auto; }
[data-whale-girl] .pet-status.pet-status-above::after { top: auto; bottom: auto; top: -5px; } /* 贴底翻转：卡在上方，连接尾朝下指向角色 */
[data-whale-girl] .pet-menu { display: none; position: absolute; left: 50%; top: calc(100% + 12px); transform: translateX(-50%);
  width: max-content; gap: 6px; padding: 6px; border-radius: 8px;
  background: rgba(20,20,28,.72); }
[data-whale-girl] .pet-bubble { position: absolute; left: 50%; top: calc(100% + 12px); transform: translateX(-50%);
  background: rgba(24,28,38,.94); color: #E8EBF2; font-size: 11px; padding: 4px 8px; border-radius: 10px;
  white-space: nowrap; pointer-events: none; animation: whale-girl-pop .25s ease-out;
  z-index: 3; }
[data-whale-girl] .pet-menu.open { display: flex; }
[data-whale-girl] .pet-menu button { flex: 1; border: 0; border-radius: 6px; padding: 4px 8px;
  font-size: 11px; cursor: pointer; background: rgba(255,255,255,.14); color: #E8EBF2; }
[data-whale-girl] .pet-menu button:hover { background: rgba(255,255,255,.28); }
[data-whale-girl] .pet-heart { position: absolute; font-size: 20px; pointer-events: none;
  animation: whale-girl-float 1.8s ease-out forwards; }
/* 状态运动配方（manifest.motion → 舞台 CSS 类；frames>1 走帧播放器，frames=1 走此动画）。
   动画作用于舞台（无内联 transform），与 sprite 的内联 scale 不冲突。
   幅度克制（±2~6px/deg）+ 中间关键帧（0→1/4→1/2→3/4→1）：无突变的往复。 */
[data-whale-girl] .pet-stage.pet-motion-bob { animation: whale-girl-m-bob 2.4s ease-in-out infinite; }
[data-whale-girl] .pet-stage.pet-motion-wiggle { animation: whale-girl-m-wiggle .9s ease-in-out infinite; }
[data-whale-girl] .pet-stage.pet-motion-squash { animation: whale-girl-m-squash .7s ease-in-out infinite; }
[data-whale-girl] .pet-stage.pet-motion-shake { animation: whale-girl-m-shake .3s linear infinite; }
[data-whale-girl] .pet-stage.pet-motion-sigh { animation: whale-girl-m-sigh 1.6s ease-in-out infinite; }
[data-whale-girl] .pet-stage.pet-motion-hop { animation: whale-girl-m-hop .6s ease-in-out infinite; }
[data-whale-girl] .pet-stage.pet-motion-tilt { animation: whale-girl-m-tilt 1.2s ease-in-out infinite; }
[data-whale-girl] .pet-stage.pet-motion-float { animation: whale-girl-m-float 3.2s ease-in-out infinite; }
[data-whale-girl] .pet-stage.pet-motion-wave { animation: whale-girl-m-wave 1s ease-in-out infinite; }
@keyframes whale-girl-m-bob { 0%,100% { transform: translateY(0); } 30% { transform: translateY(-3px); } 60% { transform: translateY(-4px); } }
@keyframes whale-girl-m-wiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-2deg); } 75% { transform: rotate(2deg); } }
@keyframes whale-girl-m-squash { 0%,100% { transform: scale(1,1); } 25% { transform: scale(1.06,.94); } 50% { transform: scale(.96,1.04); } 75% { transform: scale(1.03,.97); } }
@keyframes whale-girl-m-shake { 0%,100% { transform: translateX(0); } 30% { transform: translateX(-2px); } 60% { transform: translateX(2px); } 80% { transform: translateX(-1px); } }
@keyframes whale-girl-m-sigh { 0%,100% { transform: translateY(0) scale(1,1); } 40% { transform: translateY(1.5px) scale(1,.98); } }
@keyframes whale-girl-m-hop { 0%,100% { transform: translateY(0); } 40% { transform: translateY(-6px); } 70% { transform: translateY(0); } }
@keyframes whale-girl-m-tilt { 0%,100% { transform: rotate(0); } 30% { transform: rotate(-4deg); } 70% { transform: rotate(4deg); } }
@keyframes whale-girl-m-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes whale-girl-m-wave { 0%,100% { transform: rotate(0); } 20% { transform: rotate(-6deg); } 40% { transform: rotate(6deg); } 60% { transform: rotate(-4deg); } 80% { transform: rotate(4deg); } }
@keyframes whale-girl-float { 0% { opacity: 1; transform: translateY(0) scale(.7); }
  70% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-72px) scale(1.25); } }
@keyframes whale-girl-pop { from { opacity: 0; transform: translateX(-50%) translateY(4px); } }
[data-whale-girl][data-whale-girl-inert] { opacity: .25; pointer-events: none; }
[data-whale-girl][data-whale-girl-hidden] { display: none; }
[data-whale-girl] .pet-stage:focus-visible { outline: 2px solid rgba(255,255,255,.6); outline-offset: 2px; border-radius: 8px; }
@media (prefers-reduced-motion: reduce) {
  [data-whale-girl] .pet-stage { animation: none !important; }
  [data-whale-girl] .pet-sprite { animation: none !important; }
  [data-whale-girl] .pet-heart { animation: none; opacity: 0; }
  [data-whale-girl] .pet-bubble { animation: none; }
  [data-whale-girl] .pet-status { transition: none !important; }
}
`

export function apply(ctx = {}) {
  // 幂等守卫：bundle 重复执行（dev/HMR 重建、loader 重跑）时不双宠物双 style。
  if (document.querySelector('[data-whale-girl]') !== null) {
    console.warn('[whale-girl] apply 已存在实例，跳过重复挂载')
    return () => {}
  }
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  // ---- 公共面板抽象（v6）----
  // 状态卡/气泡/菜单都是「相对角色的浮层面板」，样式基调统一（背景/圆角/字体/内边距/
  // 阴影），差异仅在定位锚点与交互（hover/动画/按钮）。统一基调保证视觉一致；
  // 关键样式一律 JS 内联（宿主可能覆盖/清理 CSS 注入，见 hitarea/menu 系列决策）。
  // 基调变量：色板/圆角/字体/内边距单一来源，调整一处全局生效。
  const PANEL_THEME = {
    bg: 'rgba(24, 28, 38, .94)',      // 面板背景（状态卡/气泡/菜单统一）
    border: 'rgba(255,255,255,.10)',  // 边框色（solid 变体用）
    text: '#E8EBF2',                  // 主文字
    radius: '10px',                   // 圆角（统一）
    font: '11px',                     // 基础字号（统一）
    shadow: '0 12px 32px rgba(0,0,0,.38), 0 3px 8px rgba(0,0,0,.28)', // 浮层阴影
  }
  /**
   * 创建浮层面板（状态卡/气泡/菜单共用）。
   * @param {object} opts
   * @param {'below'|'above'} [opts.anchor] 相对角色：below=下方（状态卡/菜单）、above=上方（气泡）
   * @param {'solid'|'plain'} [opts.variant] solid=带边框阴影（状态卡）、plain=纯背景（气泡/菜单）
   * @param {number} [opts.offsetY] 锚点偏移（below: 角色下方间距；above: 上方间距）
   * @param {string} [opts.zIndex] 层叠
   * @param {string} [opts.display] 初始 display
   * @returns {{ el: HTMLElement, show: () => void, hide: () => void }}
   */
  const createPanel = ({ anchor = 'below', variant = 'plain', offsetY = 12, zIndex = '3', display = 'block' } = {}) => {
    const el = document.createElement('div')
    const pos = anchor === 'above'
      ? `top: -${offsetY}px; transform: translate(-50%, -100%);`
      : `top: calc(100% + ${offsetY}px); transform: translateX(-50%);`
    const surface = variant === 'solid'
      ? `background: ${PANEL_THEME.bg}; border: 1px solid ${PANEL_THEME.border}; box-shadow: ${PANEL_THEME.shadow};`
      : `background: ${PANEL_THEME.bg};`
    // 关键样式 JS 内联（宿主可能清理 CSS 注入——position 缺失会参与文档流顶开角色）。
    el.style.cssText = [
      'position: absolute; left: 50%;', pos,
      'width: max-content;', surface,
      `color: ${PANEL_THEME.text}; font-size: ${PANEL_THEME.font};`,
      `border-radius: ${PANEL_THEME.radius}; z-index: ${zIndex};`,
      `display: ${display}; pointer-events: none;`,
    ].join(' ')
    return {
      el,
      show() { el.style.display = display },
      hide() { el.style.display = 'none' },
    }
  }

  const host = document.createElement('div')
  host.setAttribute('data-whale-girl', '')
  host.setAttribute('role', 'group')
  host.setAttribute('aria-label', '桌面宠物')
  host.setAttribute('aria-expanded', 'false')
  // 关键样式 JS 内联（宿主可能清理 CSS 注入——position 缺失 host 会掉出文档流不可见，
  // 见 hitarea/menu/effects 系列环境事实；host 基础定位是最后一处依赖 CSS 注入的面）。
  host.style.cssText = `position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
    width: var(--pet-size, 110px); height: var(--pet-size, 110px);
    font-family: system-ui, sans-serif; user-select: none; touch-action: none;
    opacity: var(--pet-opacity, 1);`
  // enabled 门控引导：先隐藏挂载（不闪一下再消失），boot 取配置判定渲染开关后再显示。
  host.style.display = 'none'
  document.body.appendChild(host)

  const stage = document.createElement('div')
  stage.className = 'pet-stage'
  stage.setAttribute('role', 'button')
  stage.setAttribute('tabindex', '0')
  stage.setAttribute('aria-label', '互动菜单：回车或空格打开')
  const sprite = document.createElement('div')
  sprite.className = 'pet-sprite'
  stage.appendChild(sprite)

  // 状态卡（solid 面板：边框+阴影+blur；hover 显示，含子元素与贴边变体类）。
  const status = createPanel({ anchor: 'below', variant: 'solid', offsetY: 18, zIndex: '1' }).el
  status.className = 'pet-status'
  status.style.backdropFilter = 'blur(10px) saturate(1.15)'
  status.style.padding = '5px 8px'
  status.style.minWidth = '96px'
  status.style.maxWidth = 'calc(100vw - 24px)'
  status.style.display = 'grid'
  status.style.gap = '4px'
  status.style.opacity = '0'
  status.style.visibility = 'hidden'
  status.style.pointerEvents = 'none'
  status.style.transition = 'opacity .15s ease-out, visibility 0s linear .2s'
  status.innerHTML = `
    <div class="pet-meta" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <span class="pet-lv" style="background:rgba(86,134,254,.16); color:#B7C8FE; border-radius:5px; padding:2px 6px; font-size:10px; font-weight:600; line-height:16px; white-space:nowrap;">Lv.1</span>
      <span class="pet-stats" style="color:#E8EBF2; font-size:11px; line-height:16px; font-variant-numeric:tabular-nums; white-space:nowrap;">0 任务</span>
    </div>
    <div class="pet-note" style="color:#E8EBF2; font-size:11px; line-height:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">…</div>`
  const metaLv = status.querySelector('.pet-lv')
  const metaStats = status.querySelector('.pet-stats')
  const metaNote = status.querySelector('.pet-note')
  // 渲染时徽章样式保持内联（宿主 CSS 可能覆盖 class——内联优先级最高，徽章背景/分隔不被清）。
  metaLv.style.cssText = 'background:rgba(86,134,254,.16); color:#B7C8FE; border-radius:5px; padding:2px 6px; font-size:10px; font-weight:600; line-height:16px; white-space:nowrap;'
  metaStats.style.cssText = 'color:#E8EBF2; font-size:11px; line-height:16px; font-variant-numeric:tabular-nums; white-space:nowrap;'
  metaNote.style.cssText = 'color:#E8EBF2; font-size:11px; line-height:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;'

  // 菜单（plain 面板：纯背景；按钮子元素，toggle 显示）。
  const menu = createPanel({ anchor: 'below', variant: 'plain', offsetY: 12, zIndex: '4', display: 'none' }).el
  menu.className = 'pet-menu'
  menu.style.gap = '6px'
  menu.style.padding = '6px'
  menu.style.display = 'none' // 初始隐藏；toggleMenu 切换内联
  menu.style.pointerEvents = 'auto' // 菜单按钮需可点（覆盖面板默认 pointer-events:none）
  const BTN_STYLE = 'flex:1; border:0; border-radius:6px; padding:4px 8px; font-size:11px; cursor:pointer; background:rgba(255,255,255,.14); color:#E8EBF2; font-family:system-ui,sans-serif;'
  const feedBtn = document.createElement('button')
  feedBtn.textContent = '🍗 喂食'
  feedBtn.style.cssText = BTN_STYLE
  const playBtn = document.createElement('button')
  playBtn.textContent = '🎾 玩耍'
  playBtn.style.cssText = BTN_STYLE
  const roleBtn = document.createElement('button')
  roleBtn.textContent = '🎭 换角色'
  roleBtn.style.cssText = BTN_STYLE
  menu.append(feedBtn, playBtn, roleBtn)

  // 特效层：爱心/气泡的独立容器（覆盖在舞台上方，不参与舞台内容切换——
  // stage 的 replaceChildren/textContent 不会清掉正在播放的特效）。
  const effects = document.createElement('div')
  effects.className = 'pet-effects'
  // 关键样式 JS 内联（不依赖 CSS 注入——宿主可能覆盖/清理 style 标签；否则 effects 变
  // static 参与文档流，heart/bubble 会把 sprite 顶到下面）。
  effects.style.cssText = 'position: absolute; left: 0; top: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px); pointer-events: none; overflow: visible; z-index: 2;'
  // 点击热区层：覆盖在角色内容上（贴合内容 bbox），pointer 事件绑此而非 stage——
  // 拖拽/点击热区 = 角色实际轮廓，四周透明边缘不可点。
  const hitarea = document.createElement('div')
  hitarea.className = 'pet-hitarea'
  // 关键样式 JS 内联（不依赖 CSS 注入——宿主环境可能覆盖/清理 style 标签，内联保证生效；
  // 否则 hitarea 变 static 掉出文档流，整个 pet 无交互点）。尺寸/定位由 applyHitArea 更新。
  hitarea.style.cssText = `position: absolute; inset: 0; cursor: grab; touch-action: none; z-index: 3; border-radius: 8px;`
  // 状态卡放入 effects 层：effects 与 stage 同尺寸同位置（host 内 0,0,110,110），
  // 状态卡 top:calc(100%+18px) 相对 effects = 角色下方 18px，与角色视觉对齐（不遮挡）。
  effects.appendChild(status)
  host.append(effects, stage, hitarea, menu)

  // ---- 状态卡布局（视口感知：左右对齐，hover 显示时调用）----
  // status 绝对定位锚定宠物下方（始终不覆盖角色）；宠物贴左右缘 → 边缘对齐防横向溢出。
  // 气泡激活（activeBubble）或拖拽中 → 隐藏让位（气泡/移动是主角）。
  // 显式显示控制（内联 style，不依赖 CSS :hover 层叠——宿主环境可能覆盖样式）。
  let statusForcedHidden = false // 气泡/拖拽/菜单打开时 true（hover 不显示状态卡）
  const setStatusVisible = (visible) => {
    status.style.opacity = visible ? '1' : '0'
    status.style.visibility = visible ? 'visible' : 'hidden'
    status.style.pointerEvents = visible ? 'auto' : 'none'
    status.style.transition = visible
      ? 'opacity .2s cubic-bezier(.16,1,.3,1)'
      : 'opacity .15s ease-out, visibility 0s linear .2s'
  }
  const layoutStatus = () => {
    if (activeBubble !== null || dragging || menu.classList.contains('open')) {
      statusForcedHidden = true
      setStatusVisible(false) // 气泡/拖拽/菜单打开时隐藏状态卡（内联控制，不依赖 CSS 类）
      return
    }
    statusForcedHidden = false
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = host.getBoundingClientRect()
    const cardW = status.offsetWidth || 160
    const cardH = status.offsetHeight || 60
    // 贴边判定：仅当状态卡「居中时」真会溢出视口才贴边（居中位置 = 角色中心 ± 半卡宽）。
    // 对齐策略（v6）：状态卡始终以角色中心居中（left:50% + translateX(-50%)），
    // 不做左右贴边——宠物在视口边缘时卡轻微溢出可接受（max-width 缓解）。
    // 仅保留「贴底翻转」：宠物贴视口底部时卡翻到角色上方（防底部溢出/被裁）。
    const nearBottom = rect.bottom > vh - cardH - 20
    status.style.left = '50%'
    status.style.right = 'auto'
    status.style.bottom = 'auto'
    status.style.transform = 'translateX(-50%)'
    if (nearBottom) {
      // 贴底翻转：状态卡翻到角色上方（main 内联；after 连接尾方向由类控制）
      status.classList.add('pet-status-above')
      status.style.top = 'auto'
      status.style.bottom = 'calc(100% + 18px)'
    } else {
      status.classList.remove('pet-status-above')
      status.style.top = 'calc(100% + 18px)'
    }
  }
  const onHostEnter = () => {
    layoutStatus()
    if (!statusForcedHidden) setStatusVisible(true)
  }
  const onHostLeave = () => {
    if (menu.classList.contains('open')) return
    setStatusVisible(false)
  }
  host.addEventListener('mouseenter', onHostEnter)
  host.addEventListener('mouseleave', onHostLeave)
  // 气泡出现时让状态卡让位：showReply 后立即重排（气泡是主角）。
  const onBubbleShown = () => {
    if (document.querySelector(':hover') === host) layoutStatus()
  }

  // 菜单开关（同步 aria-expanded；open 缺省时切换）。
  const toggleMenu = (open) => {
    const next = open ?? !menu.classList.contains('open')
    menu.classList.toggle('open', next)
    // 内联 display 是权威（类规则可能被宿主清理，且内联 display:none 优先级高于
    // .pet-menu.open 类——toggle class 不足以显示/隐藏菜单）。显式切换内联。
    menu.style.display = next ? 'flex' : 'none'
    if (next) {
      statusForcedHidden = true
      setStatusVisible(false)
      releaseInteraction() // 打开菜单 = 用户在场：重置空闲（菜单开着宠物不睡）；睡着则醒
    }
    host.setAttribute('aria-expanded', String(next))
    return next
  }

  // ---- 运行时状态 ----
  let pet = null
  let activity = { name: 'idle', until: 0 }
  let manifest = { states: {} }
  // 角色上下文：manifest 角色索引 → 当前角色（whale-girl 默认）。角色 id 决定
  // sheet 的目录前缀（assets/characters/<id>/）；缓存 key 含角色 id 防串图。
  let character = { id: 'whale-girl', states: {} }
  let characterId = 'whale-girl'
  const loaded = new Set() // 已加载成功的 `${id}:${sheet}` 键
  const sheetSize = new Map() // 同上 → { w, h }（自然尺寸）
  let dragging = false
  let pressed = false
  let moved = false
  let transient = null // 'eat' | 'play' | 'wake' | null（点击/睡醒后播一次）
  let transientUntil = 0 // 超时兜底：sheet 缺失/未播完也保证复位
  let joyUntil = 0 // 互动后短时喜悦（JOY_MS）
  let dragReleaseUntil = 0 // 拖拽放下缓冲：短暂回 idle（1.5s）再进入底层状态
  let showingSprite = false // 当前 animState 是否以 sprite 呈现（迟到加载后换肤）
  let idleSince = 0 // 进入 idle 的时刻（sleep 从此刻起算持续空闲）
  let sleeping = false
  let animState = null
  let frame = 0
  let frameDirection = 1
  // idle 随机眨眼（v4）：常态保持帧 0（睁眼），随机间隔眨一次（0→1→2→0）。
  // nextBlinkAt 决策触发时刻；blinkActive=眨眼动画进行中（播完回帧 0 静止）。
  let blinkAt = 0
  let blinkActive = false
  // 随机朝向转换：静态陪伴态（idle/think/wait）偶尔转身；nextFacingAt 决策触发时刻。
  // flip 由 walk/drag 写入（动作间朝向连续），静态态在到点时翻转一次并刷新 sprite。
  let facingAt = 0
  let lastFrameAt = 0
  // working 随机插曲（v3）：think 常态、偶尔随机插入 working；由 nextWorkingRhythm 决策，
  // 宿主只做「到点翻转」的薄执行。workingActive 喂 pickState；workingTimer 是翻转闹钟。
  let working = { active: false, until: 0 }
  let workingTimer = null
  // 回合完成庆祝窗口（client 本地）：sessions completed 翻转后 ROUND_CELEBRATE_MS 内播 celebrate。
  let celebrateUntil = 0
  // 游走（walk）：周期性沿视口底部散步。
  let walking = false
  let walkDir = 1
  let flip = 1 // sprite 水平翻转（scaleX）；素材统一朝左基准：1=朝左、-1=镜像朝右
  let wanderTimer = null
  let walkRaf = null
  // 会话感知（P2 思考态）：由 host sessions 服务快照派生的陪伴信号。
  let sessionMood = { thinking: false, waiting: false, titles: [] }

  // ---- 渲染 ----
  const renderStatus = () => {
    if (pet) {
      metaLv.textContent = `Lv.${pet.level}`
      // 任务计数：徽章与统计由内联 flex gap 分隔（宿主覆盖也不粘连误读）。
      metaStats.textContent = pet.stats.failures > 0
        ? `${pet.stats.tasksDone} 任务 · ${pet.stats.failures} 失败`
        : `${pet.stats.tasksDone} 任务`
      const last = pet.memory[pet.memory.length - 1]
      metaNote.textContent = last ?? (pet.titles.length > 0 ? `称号「${pet.titles.join('」「')}」` : '…')
    }
  }

  // 缺素材占位（v5：不再 emoji 降级——manifest 门禁保证投放前 15 状态全有 sheet；
  // 仅运行时异常路径（sheet 加载失败/迟到）到此，显示透明占位 + 控制台警告便于发现）。
  const showPlaceholder = (name) => {
    sprite.classList.remove('ready')
    stage.replaceChildren(sprite)
    console.warn(`[whale-girl] 状态 ${name} 缺少可用 sheet（manifest 应含全部 15 状态；若已声明则素材加载失败）`)
  }

  // sheet 缓存键：含角色 id 命名空间（防切角色显示旧图）。
  const sheetKey = (sheet) => `${characterId}:${sheet}`
  // sheet URL：角色目录前缀（assets/characters/<id>/）；角色 id 经 ROLE_ID_RE 校验
  // （parseCharacters 已过滤非法 id），assets 路由另有路径净化兜底。
  const sheetUrl = (sheet) => `${ASSETS_URL}/characters/${characterId}/${sheet}`

  // showSprite 参数名 anim（manifest 状态动画集），避免遮蔽模块级客户端配置 cfg——
  // 曾用 cfg.size（undefined）算 scale → NaN → transform 被浏览器丢弃（尺寸变大 + flip 失效）。
  const showSprite = (name, anim) => {
    const key = sheetKey(anim.sheet)
    const size = sheetSize.get(key)
    if (!size || size.w <= 0 || size.h <= 0) {
      showPlaceholder(name) // 尺寸未知（加载失败/未完成）→ 占位，避免除零白屏
      return
    }
    // 清掉前一状态的占位/sprite，确保 eat/play 不会在状态结束后残留。
    stage.replaceChildren(sprite)
    const frameW = size.w / anim.frames
    // 目标尺寸用宿主实际盒（--pet-size/配置 size 生效后的真实值），而非状态集里的
    // 悬空 size 字段——配置 size 走 CSS 变量路径，不进 manifest 状态条目。
    const target = host.offsetWidth || 110
    const scale = Math.min(target / frameW, target / size.h, 1)
    sprite.className = 'pet-sprite ready'
    sprite.style.cssText = `
      position: absolute; left: 50%; top: 50%; display: block;
      background-image: url("${sheetUrl(anim.sheet)}");
      background-size: ${size.w}px ${size.h}px;
      width: ${frameW}px; height: ${size.h}px;
      transform: translate(-50%, -50%) scale(${scale}) scaleX(${flip});
    `
    // 内联绝对定位居中（不依赖 stage 的 grid place-items——宿主可能覆盖 CSS 注入，
    // 使 sprite 布局盒不居中、视觉与 hitarea 错位）；translate(-50%,-50%) 以自身中心为原点，
    // 与 hitarea 的内容 bbox 定位（box.x/box.y）严格对齐。
    applyFrame(frameW, frame)
  }

  const applyFrame = (frameW, idx) => {
    sprite.style.backgroundPosition = `-${frameW * idx}px 0`
  }

  // 静态态随机转身：只刷新当前 sprite 的 transform（scaleX flip），不动帧/背景。
  // 用于 nextFacingAt 到点时翻转朝向——walk/drag 改 flip 时已有各自的刷新路径。
  const applyFacing = () => {
    if (!showingSprite) return
    const cfg = stateOf(character, animState)
    if (!cfg || !loaded.has(sheetKey(cfg.sheet))) return
    const size = sheetSize.get(sheetKey(cfg.sheet))
    if (!size || size.w <= 0 || size.h <= 0) return
    const frameW = size.w / cfg.frames
    const target = host.offsetWidth || 110
    const scale = Math.min(target / frameW, target / size.h, 1)
    sprite.style.transform = `translate(-50%, -50%) scale(${scale}) scaleX(${flip})`
    applyHitArea() // flip 变化 → 热区镜像对齐（否则 flip 后热区与角色错位）
  }

  const setState = (name) => {
    if (name === animState) return
    animState = name
    frame = 0
    frameDirection = 1
    blinkAt = 0 // 重进 blink 状态时重新排随机触发
    blinkActive = false
    facingAt = 0 // 重进静态态时重新排随机转身
    lastFrameAt = 0
    applyHitArea() // 热区跟随当前状态（各状态内容 bbox 独立，切换即收窄/放宽）
    // 运动配方：manifest.motion → 舞台类（sprite 与占位路径都生效；无 motion 时清类）。
    // 快照迭代再删：活 DOMTokenList 边遍历边删可能跳项（当前单类无碍，加固免踩）。
    for (const cls of [...stage.classList]) if (cls.startsWith('pet-motion-')) stage.classList.remove(cls)
    const cfg = stateOf(character, name)
    const motion = cfg?.motion
    if (motion) stage.classList.add(`pet-motion-${motion}`)
    if (cfg && loaded.has(sheetKey(cfg.sheet))) {
      showSprite(name, cfg)
      showingSprite = true
    } else {
      showPlaceholder(name) // 素材缺失/未加载 → 占位（不再 emoji 降级）
      showingSprite = false
    }
    // 状态切换淡入：快速过渡掩盖姿势硬切（sprite 有 opacity transition）。
    // rAF 双帧在页面隐藏时不执行 → opacity 卡 0（宠物变空白）；setTimeout 兜底保证恢复。
    stage.style.opacity = '0'
    const restoreOpacity = () => { stage.style.opacity = '1' }
    requestAnimationFrame(() => requestAnimationFrame(restoreOpacity))
    setTimeout(restoreOpacity, 60)
  }

  // ---- 资产加载 ----
  // 每状态内容 bbox（0-1 归一化比例）：驱动点击热区贴合「当前显示状态」的实际轮廓——
  // 热区跟随状态切换实时收窄（各状态内容占比 55-88% 差异大：walk 横向仅 55%，
  // 若用全部状态并集会因宽幅状态撑大热区；逐状态 bbox 让 idle 贴合 idle、walk 贴合 walk）。
  // 初始为 null：未分析完成时热区回退全图。
  let stateBoxes = new Map() // stateName → { x, y, w, h }
  const applyHitArea = () => {
    if (hitarea === null) return
    const size = parseFloat(getComputedStyle(host).getPropertyValue('--pet-size')) || 110
    // 当前显示状态的 bbox；未就绪时回退全图（不点空）。
    const box = stateBoxes.get(animState) ?? { x: 0, y: 0, w: 1, h: 1 }
    const hitW = Math.max(40, size * box.w)
    const hitH = Math.max(40, size * box.h)
    // 按内容在帧内的实际位置对齐（不假设居中）：box.x/box.y 是内容左/上缘相对帧的比例。
    // flip（scaleX 镜像）时内容水平位置镜像：1 - x - w。sprite 以中心镜像，内容在宿主内
    // 的位置随 flip 翻转——热区须同步，否则 flip 后热区与角色错位。
    const flipped = flip < 0
    const offX = size * (flipped ? 1 - box.x - box.w : box.x)
    const offY = size * box.y
    hitarea.style.left = `${offX}px`
    hitarea.style.top = `${offY}px`
    hitarea.style.width = `${hitW}px`
    hitarea.style.height = `${hitH}px`
  }
  // 换角色/重载时重置内容 bbox（新角色的轮廓不同）。
  const resetContentBox = () => {
    stateBoxes = new Map()
  }

  // 用离屏 canvas 读 sheet 的「首帧」不透明像素范围（内容 bbox 以单帧为单位——
  // 多帧 sheet 横向排布，若扫描整张会把第 2..N 帧的内容跨度计入 bbox，热区被撑到
  // sheet 全宽（如 idle 3 帧 768px → w=0.925 而非 0.78），造成大片空白可点击）。
  const analyzeSheet = (img, frames) => {
    const canvas = document.createElement('canvas')
    const fw = img.naturalWidth / frames
    canvas.width = fw
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, fw, img.naturalHeight, 0, 0, fw, img.naturalHeight) // 只取首帧
    const data = ctx.getImageData(0, 0, fw, canvas.height).data
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < fw; x++) {
        if (data[(y * fw + x) * 4 + 3] > 10) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null // 全透明
    return {
      x: minX / fw, y: minY / canvas.height,
      w: (maxX - minX + 1) / fw, h: (maxY - minY + 1) / canvas.height,
    }
  }

  // sheet 加载带有限重试（偶发网络/缓存失败 → 该状态永久占位空白的防线；重试耗尽后
  // resolve(null)，由 showPlaceholder 提示）。onload 成功 resolve(img)。
  const loadImageWithRetry = (src, retries = 3) => new Promise((resolve) => {
    let attempts = 0
    const attempt = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => {
        attempts += 1
        if (attempts < retries) setTimeout(attempt, 250 * attempts)
        else resolve(null)
      }
      img.src = src
    }
    attempt()
  })

  const preload = (name, cfg) => loadImageWithRetry(sheetUrl(cfg.sheet)).then((img) => {
    if (img === null) return // 重试耗尽：该状态保持占位（showPlaceholder 提示）
    sheetSize.set(sheetKey(cfg.sheet), { w: img.naturalWidth, h: img.naturalHeight })
    loaded.add(sheetKey(cfg.sheet))
    const box = analyzeSheet(img, cfg.frames)
    if (box !== null) stateBoxes.set(name, box) // 每状态独立 bbox——热区跟随当前状态
    applyHitArea()
  })

  // manifest 拉取失败/非 2xx → 有限重试（偶发失败 → 全部状态占位空白的防线）；
  // 结构守卫失败（坏 manifest）不重试（数据坏了重试也坏，保持当前角色）。
  const loadAssets = async (attempt = 1) => {
    try {
      const res = await fetch(MANIFEST_URL)
      if (!res.ok) throw new Error(`manifest ${res.status}`)
      const next = await res.json()
      // 结构守卫：manifest 必须是对象且可解析出角色（坏 manifest 不赋值 → 保持当前角色）。
      if (next === null || typeof next !== 'object') return
      manifest = next
      resetContentBox() // 新角色轮廓：重置内容 bbox（preload 逐步合并）
      // 角色解析：默认角色 + 当前角色（localStorage 偏好，ROLE_ID_RE 已由 parseCharacters 过滤）。
      const pref = (() => { try { return localStorage.getItem('whale-girl:character') ?? null } catch { return null } })()
      const roles = parseCharacters(manifest)
      const nextId = pref !== null && pref in roles.characters ? pref : roles.defaultId
      characterId = nextId
      character = getCharacter(manifest, nextId) ?? { id: nextId, states: {} }
      // 角色尺寸：meta.stageSize 作为 --pet-size 默认（仅用户未配置 size 时生效——
      // 配置系统 size 是权威，lastConfigRevision===0 表示未拉取过配置）。
      const stageSize = character.meta?.stageSize
      if (typeof stageSize === 'number' && lastConfigRevision === 0) {
        host.style.setProperty('--pet-size', `${stageSize}px`)
      }
      await Promise.all(Object.entries(character.states).map(([n, cfg]) => preload(n, cfg)))
    } catch {
      // manifest 网络失败：有限重试（偶发失败 → 全占位空白）；耗尽后保持当前角色
      if (attempt < 3) setTimeout(() => loadAssets(attempt + 1), 500 * attempt)
    }
  }

  // 换角色：预加载目标角色全部 sheet → 原子替换（清旧缓存、换 id、复位状态）。
  // 换角色失败 → 保留当前角色（素材缺失路径由 showPlaceholder 提示）。
  const switchCharacter = async (id) => {
    const target = getCharacter(manifest, id)
    if (target === null || id === characterId) return
    try {
      resetContentBox() // 新角色轮廓：重置内容 bbox
      const nextLoaded = new Set()
      const nextSize = new Map()
      await Promise.all(Object.entries(target.states).map(([n, cfg]) => loadImageWithRetry(`${ASSETS_URL}/characters/${id}/${cfg.sheet}`).then((img) => {
        if (img === null) return // 重试耗尽：该状态保持占位（showPlaceholder 提示）
        nextSize.set(`${id}:${cfg.sheet}`, { w: img.naturalWidth, h: img.naturalHeight })
        nextLoaded.add(`${id}:${cfg.sheet}`)
        const box = analyzeSheet(img, cfg.frames)
        if (box !== null) stateBoxes.set(n, box) // 新角色每状态独立 bbox
        applyHitArea()
      })))
      // 原子替换
      characterId = id
      character = target
      loaded.clear()
      sheetSize.clear()
      for (const k of nextLoaded) loaded.add(k)
      for (const [k, v] of nextSize) sheetSize.set(k, v)
      // 角色尺寸：meta.stageSize 作为 --pet-size 默认（用户未配置 size 时生效）。
      const stageSize = target.meta?.stageSize
      if (typeof stageSize === 'number' && lastConfigRevision === 0) {
        host.style.setProperty('--pet-size', `${stageSize}px`)
      }
      try { localStorage.setItem('whale-girl:character', id) } catch { /* 隐私模式忽略 */ }
      transient = null
      transientUntil = 0
      joyUntil = 0
      animState = null // 强制重选状态（下一帧 setState 生效）
      frame = 0
      lastFrameAt = 0
    } catch {
      // 预加载失败：保留当前角色
    }
  }

  // ---- 动画主循环 ----
  // 瞬发复位（eat/play/wake 播完或超时）→ 互动类瞬发后接短时喜悦（joy）。
  const resetTransient = (now) => {
    const wasFun = transient === 'eat' || transient === 'play'
    transient = null
    transientUntil = 0
    if (wasFun) joyUntil = now + JOY_MS
  }
  const tick = () => {
    const now = Date.now()
    // 瞬发动画超时兜底：无论 sheet 是否存在/是否播完，到点必复位（不卡死）。
    if (transient !== null && now >= transientUntil) {
      resetTransient(now)
    }
    const target = pickState({ activity, dragging, walking, transient, sleeping, joyUntil, dragReleaseUntil, now, sessionThink: sessionMood.thinking, sessionWait: sessionMood.waiting, workingActive: working.active, celebrateUntil })
    // 睡醒边沿（纯函数）：上一帧显示 sleep、本帧离开 sleep（非拖拽打断、无瞬发占用）→ 播 wake。
    // 不能用 sleeping 变量（Node half activity 判定）触发：会话活跃时 think/working 优先级
    // 高于 sleep，视觉已离开 sleep 但 sleeping 仍是 true（activity 还 idle）——旧边沿永不翻转，
    // wake 不可见。以实际显示的 animState 为准，视觉离开 sleep 的瞬间即过渡。
    if (shouldWake(animState, target, { dragging, transient })) {
      transient = 'wake'
      transientUntil = now + WAKE_MS
      // transient 变化后重算：wake 行优先级高于 think/working/sleep/walk（见 STATE_TABLE）。
      setState(pickState({ activity, dragging, walking, transient, sleeping, joyUntil, dragReleaseUntil, now, sessionThink: sessionMood.thinking, sessionWait: sessionMood.waiting, workingActive: working.active, celebrateUntil }))
      return
    }
    setState(target)
    const cfg = stateOf(character, animState)
    if (cfg && loaded.has(sheetKey(cfg.sheet))) {
      // playback 合法性自检：门禁保证仓库内 manifest 合法，此处防发布物被改坏时静默僵住。
      if (cfg.playback !== undefined && !['loop', 'pingpong', 'once', 'blink'].includes(cfg.playback)) {
        console.warn(`[whale-girl] 状态 ${animState} playback "${cfg.playback}" 非法，按 loop 播放`)
      }
      const size = sheetSize.get(sheetKey(cfg.sheet))
      const frameW = size.w / cfg.frames
      if (!showingSprite) {
        // sprite 迟到加载完成：当前状态仍显示占位 → 换肤。
        showSprite(animState, cfg)
        showingSprite = true
        frame = 0
        lastFrameAt = 0
      }
      // 随机朝向转换：静态陪伴态（idle/think/wait）偶尔转身（flip 翻转），
      // 与 walk/drag 的方向写入共享同一 flip——动作间朝向连续，静态态随机转身。
      // 不转身的态（walk/drag/burst/transient）到点也重置排程，避免离开静态态后旧时刻误触发。
      if (animState === 'idle' || animState === 'think' || animState === 'wait') {
        if (facingAt === 0) facingAt = nextFacingAt({ now })
        if (now >= facingAt) {
          flip = -flip
          applyFacing()
          facingAt = nextFacingAt({ now })
        }
      } else if (facingAt !== 0) {
        facingAt = 0 // 离开静态态：清排程（下次重进时重新随机）
      }
      // frames>1 才走帧循环；frames=1 的单图状态由 manifest.motion 的 CSS 动画驱动，不推进帧
      // （否则会推进到 -width 位置闪空白）。
      if (cfg.frames > 1 && now - lastFrameAt >= 1000 / cfg.fps) {
        // 帧播放按 playback 模式推进（v5：不再按状态名特判——数据驱动）。
        if (cfg.playback === 'blink') {
          // 常态帧 0 静止，随机间隔触发一次动作（0→1→…→N-1→0）。
          if (blinkActive) {
            // 动作推进：0→1→…→N-1→0（N=cfg.frames，一次动作）
            lastFrameAt = now
            frame += 1
            if (frame >= cfg.frames) {
              frame = 0 // 动作完成：回帧 0 静止，排下一次随机触发
              blinkActive = false
              blinkAt = nextBlinkAt({ now })
            }
            applyFrame(frameW, frame)
          } else {
            // 常态：静止在帧 0；到随机触发时刻开始动作
            if (frame !== 0) {
              frame = 0
              applyFrame(frameW, frame)
            }
            if (blinkAt === 0) blinkAt = nextBlinkAt({ now })
            if (now >= blinkAt) blinkActive = true
          }
          return
        }
        lastFrameAt = now
        frame += frameDirection
        if (cfg.playback === 'pingpong' && cfg.frames > 1) {
          // 往返：0→1→…→N-1→…→0（帧方向在端点反转）
          if (frame >= cfg.frames - 1 || frame <= 0) frameDirection *= -1
          frame = Math.max(0, Math.min(cfg.frames - 1, frame))
        } else if (frame >= cfg.frames) {
          if (cfg.playback === 'loop') frame = 0
          else {
            // once：播完保持末帧（帧0=起点、末帧=完成态）
            frame = cfg.frames - 1
            if (transient !== null && transient !== 'wake') {
              resetTransient(now) // 非 wake 瞬发播完即复位（早于超时）；wake 保持末帧直到 WAKE_MS 超时
            }
          }
        }
        applyFrame(frameW, frame)
      }
    }
  }

  // ---- 互动 ----
  // 用户交互醒觉（v6）：拖拽放下/喂食/玩耍/开菜单都是用户在场信号——空闲计时从交互
  // 时刻重新起算（交互后不再「立即回 sleep」，见 wakeFromInteraction 决策）；交互瞬间
  // 若正睡着则附加 wake 过渡（「被拖起来」的自然醒觉）。薄执行：决策在纯函数。
  const releaseInteraction = () => {
    const decision = wakeFromInteraction({ sleeping })
    sleeping = decision.sleeping
    idleSince = 0 // 空闲计时重新起算（refresh 在 activity idle 时重新标记起点）
    if (decision.wake) {
      transient = 'wake'
      transientUntil = Date.now() + WAKE_MS
    }
  }
  // 互动爱心爆发：围绕角色本体（stage 中心区域）散开上浮，不贴角。
  // stage 是 position:relative 锚点；偏移取角色所在的中上部区域，避免缩进左上角。
  const spawnHearts = () => {
    for (let i = 0; i < 4; i++) {
      const heart = document.createElement('div')
      heart.className = 'pet-heart'
      heart.textContent = '💗'
      // 关键样式 JS 内联（宿主可能清理 CSS 类——position 缺失会参与文档流顶开角色）。
      heart.style.cssText = `
        position: absolute; font-size: 20px; pointer-events: none; line-height: 1;
        left: ${20 + Math.random() * 110}px; top: ${30 + Math.random() * 80}px;
        z-index: 3; opacity: 1;
      `
      effects.appendChild(heart)
      // 动画用 Web Animations API（不依赖 CSS 注入的 keyframes——宿主可能清理 style 标签，
      // 此前 whale-girl-float keyframes 失效导致爱心静态）。上浮 + 放大 + 淡出。
      if (typeof heart.animate === 'function') {
        heart.animate(
          [
            { opacity: 1, transform: 'translateY(0) scale(.7)' },
            { opacity: 1, transform: 'translateY(-60%) scale(1.25)', offset: 0.7 },
            { opacity: 0, transform: 'translateY(-120%) scale(1.4)' },
          ],
          { duration: 1800, easing: 'ease-out', fill: 'forwards' },
        )
      }
      heart.addEventListener('animationend', () => heart.remove())
      // 兜底超时移除：reduced-motion 下动画被禁用 / animate 不可用 →
      // animationend 永不触发 → 爱心永久残留 DOM（不可见但泄漏）。
      setTimeout(() => heart.remove(), 2000)
    }
  }

  // 宠物回话气泡（互动后显示，cfg.bubbleMs 后消失；超时记入清理表，dispose 时一并清）。
  // 一次只显示一个气泡：新气泡替换旧的（互动回话与回合完成提示不堆叠覆盖——
  // 多会话同时完成时快照循环里后者替换前者，避免同位置重叠）。
  const bubbleTimers = new Set()
  let activeBubble = null
  const clearBubble = () => {
    if (activeBubble !== null) {
      activeBubble.remove()
      activeBubble = null
    }
  }
  const showReply = (text) => {
    clearBubble()
    // 气泡（plain 面板，角色上方；动画用 Web Animations API 不依赖 CSS 注入）。
    const bubble = createPanel({ anchor: 'above', variant: 'plain', offsetY: 8, zIndex: '3' }).el
    bubble.className = 'pet-bubble'
    bubble.textContent = text
    bubble.style.padding = '4px 8px'
    bubble.style.whiteSpace = 'nowrap'
    bubble.style.opacity = '0'
    effects.appendChild(bubble)
    // 动画用 Web Animations API（不依赖 CSS 注入的 keyframes——宿主可能清理 style 标签）。
    // 注意动画 transform 覆盖定位 transform，帧里须含 translate(-50%, ...) 保持水平居中。
    if (typeof bubble.animate === 'function') {
      bubble.animate(
        [
          { opacity: 0, transform: 'translate(-50%, -85%)' },
          { opacity: 1, transform: 'translate(-50%, -100%)' },
        ],
        { duration: 250, easing: 'ease-out', fill: 'forwards' },
      )
    } else {
      bubble.style.opacity = '1'
    }
    activeBubble = bubble
    if (typeof onBubbleShown === 'function') onBubbleShown()
    const timer = setTimeout(() => {
      bubbleTimers.delete(timer)
      if (activeBubble === bubble) activeBubble = null
      bubble.remove()
      if (typeof onBubbleShown === 'function') onBubbleShown() // 气泡消失后恢复状态卡
    }, cfg.bubbleMs)
    bubbleTimers.add(timer)
  }

  const interact = async (action) => {
    stopWalk() // 互动即停下游走：eat/play 动画期间位置保持不动（点击时 walking 未停会继续移动）
    releaseInteraction() // 互动即用户在场：重置空闲（eat/play 播完不回 sleep）；睡着则附加 wake（随后被 eat/play 覆盖）
    transient = action === 'feed' ? 'eat' : 'play'
    transientUntil = Date.now() + TRANSIENT_MS
    try {
      const res = await fetch(INTERACT_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) return // 403/413/500 不当作互动成功（不撒心）
      const body = await res.json().catch(() => null)
      if (body?.reply) showReply(body.reply)
      spawnHearts()
    } catch {
      // 瞬态网络错误：下轮轮询会恢复
    }
    await refresh()
  }

  // 互斥：并发 refresh（visibilitychange 与定时器）乱序回写会制造假 wake 边沿。
  let refreshing = false
  // 离线指示：连续失败 ≥3 次后状态条显示离线标记，成功即清除。
  let failStreak = 0
  // 配置热更新：configRevision 门控（变化才拉取/重应用，避免每 3s 重置游走计时器）。
  let lastConfigRevision = 0
  // /state 轮询定时器句柄：pollMs 配置变化时重建（热生效，见 applyClientConfig）。
  let pollTimer = null
  const fetchConfig = async () => {
    try {
      const res = await fetch(CONFIG_PATH)
      if (!res.ok) return null
      const body = await res.json()
      return (body !== null && typeof body === 'object') ? body.config : null
    } catch {
      return null // 瞬态错误：保持当前配置，下轮重试
    }
  }
  // 应用客户端配置：尺寸/透明度走 CSS 变量；游走/睡眠/轮询参数更新 cfg（下次行为生效）。
  const applyClientConfig = (config) => {
    if (config === null || typeof config !== 'object') return
    // 网页端渲染开关：热切换为 false 立即卸载（桌面伴侣并存时避免双宠物）。
    // 重新启用需刷新页面（client 自渲染无重建路径）；undefined 视为启用（向后兼容）。
    if (config.enabled === false) {
      dispose()
      return
    }
    const prevPollMs = cfg.pollMs
    cfg = { ...CFG_DEFAULTS, ...config }
    if (typeof config.size === 'number') {
      host.style.setProperty('--pet-size', `${config.size}px`)
      // 布局尺寸变化后重新 clamp 位置（防止变大后被推出边缘）。
      if (host.style.left) {
        const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth))
        const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight))
        host.style.left = `${x}px`
        host.style.top = `${y}px`
      }
    }
    if (typeof config.opacity === 'number') host.style.setProperty('--pet-opacity', String(config.opacity))
    // pollMs 变化 → 重建轮询定时器（热生效；定时器在启动时按旧间隔创建，不重建则改动要刷新页面才生效）。
    // 仅页面可见时重建——后台暂停期保持 null，回前台由 onVisibility 用新 cfg 重建。
    if (typeof config.pollMs === 'number' && config.pollMs !== prevPollMs && document.visibilityState === 'visible') {
      clearInterval(pollTimer)
      pollTimer = setInterval(refresh, cfg.pollMs)
    }
    scheduleWander() // 游走参数可能变化：重排下一次游走
  }
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    try {
      const res = await fetch(STATE_PATH)
      if (!res.ok) throw new Error(`state ${res.status}`)
      const body = await res.json()
      // 结构守卫：pet/activity 缺字段或类型错误时保持上次有效值（响应损坏不崩轮询）。
      if (body !== null && typeof body === 'object' && body.pet !== null && typeof body.pet === 'object') {
        pet = body.pet
      }
      const act = body?.activity
      if (act !== null && typeof act === 'object' && typeof act.name === 'string') {
        activity = act
      }
      // 会话感知：Node half 把 sessionThink/sessionWait/回合完成窗口聚合进 /state。
      // 绝对截止时间允许 Web 与外部伴侣同时读取；boolean 仅兼容旧版 Node half。
      if (act !== null && typeof act === 'object') {
        sessionMood = {
          thinking: act.sessionThink === true,
          waiting: act.sessionWait === true,
          titles: [],
        }
        if (Number.isFinite(act.turnCompletedUntil) && act.turnCompletedUntil > Date.now()) {
          celebrateUntil = Math.max(celebrateUntil, act.turnCompletedUntil)
        } else if (act.turnCompleted === true) {
          celebrateUntil = Math.max(celebrateUntil, Date.now() + ROUND_CELEBRATE_MS)
        }
        armWorking() // 会话活跃状态变化 → 重排 working 插曲（思考开始武装/结束撤防）
      }
      // sleep 语义：从「进入 idle 的时刻」起算持续空闲（不是从「最后一次活动时刻」——那会停在
      // 工作期间导致 agent 停止后立即判睡）。用户交互（拖拽/喂食/玩耍/开菜单）由
      // releaseInteraction 重置 idleSince（唤醒），此处只消费 Node half activity。
      const isActive = activity.name !== 'idle' || activity.until > Date.now()
      if (isActive) {
        idleSince = 0
      } else if (idleSince === 0) {
        idleSince = Date.now()
      }
      sleeping = activity.name === 'idle' && idleSince !== 0 && Date.now() - idleSince > cfg.sleepAfterMs
      // 配置热更新：/state 的 configRevision 变化 → 拉取 /config 应用（尺寸/透明度/游走/睡眠）。
      if (typeof body?.configRevision === 'number' && body.configRevision !== lastConfigRevision) {
        lastConfigRevision = body.configRevision
        const config = await fetchConfig()
        if (config !== null) applyClientConfig(config)
      }
      // 桌面伴侣在场（/state companionOnline，心跳窗口）：在场期间隐藏网页端宠物，
      // 避免与桌面端双宠物；下线（心跳过期）后自动恢复显示。
      const nextCompanion = body?.companionOnline === true
      if (nextCompanion !== companionOnline) {
        companionOnline = nextCompanion
        syncInert()
      }
      // 睡醒过渡由 tick 视觉边沿触发（animState 离开 sleep 的瞬间播 wake）——见 tick 注释，
      // 不在这里判定（旧逻辑基于 sleeping 变量，会话活跃时永不翻转，见决策记录）。
      failStreak = 0
      renderStatus()
    } catch {
      // 瞬态网络错误：保留上次状态；连续失败则提示离线（宠物冻结时用户有感知）。
      failStreak += 1
      if (failStreak >= 3) metaNote.textContent = '📡 离线…'
    } finally {
      refreshing = false
    }
  }

  // ---- 拖拽（pointer 事件；位移 < 6px 视为点击切换菜单）----
  let startX = 0
  let startY = 0
  let lastPointerX = 0
  let offsetX = 0
  let offsetY = 0

  // 位置持久化（localStorage；损坏数据忽略，回退默认右下角）。
  const POS_KEY = 'whale-girl:pos'
  const savePos = () => {
    try {
      if (host.style.left && host.style.top) {
        localStorage.setItem(POS_KEY, JSON.stringify({ x: parseFloat(host.style.left), y: parseFloat(host.style.top) }))
      }
    } catch {
      // localStorage 不可用（隐私模式）忽略
    }
  }
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null')
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      // 恢复时立即 clamp：窗口变小后直接恢复旧坐标会永久离屏（resize 事件不触发）。
      const x = Math.max(0, Math.min(raw.x, window.innerWidth - host.offsetWidth))
      const y = Math.max(0, Math.min(raw.y, window.innerHeight - host.offsetHeight))
      host.style.left = `${x}px`
      host.style.top = `${y}px`
      host.style.right = 'auto'
      host.style.bottom = 'auto'
    }
  } catch {
    // 损坏数据忽略
  }

  // capture 只在越过拖拽阈值后启用：纯点击不捕获，菜单按钮的 click 正常派发。
  // 热区只绑舞台本体（110×110）：状态条/菜单区不参与拖拽与点击切换，减少误触与遮挡。
  hitarea.addEventListener('pointerdown', (e) => {
    pressed = true
    dragging = false
    moved = false
    stopWalk() // 被拖走即停下游走
    startX = e.clientX
    startY = e.clientY
    lastPointerX = e.clientX
    offsetX = e.clientX - host.offsetLeft
    offsetY = e.clientY - host.offsetTop
  })
  hitarea.addEventListener('pointermove', (e) => {
    if (!pressed) return
    if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
      if (!moved) hitarea.setPointerCapture(e.pointerId)
      moved = true
      dragging = true
      // 拖拽打断当前互动：清掉 eat/play/wake 瞬发与互动喜悦——释放后回到拖拽前
      // 的底层状态（如 idle/think），而不是继续播放被打断的 play。
      transient = null
      transientUntil = 0
      joyUntil = 0
      layoutStatus() // 拖拽中隐藏状态卡（宠物是主角，卡片跟随移动会闪）
      // 素材统一朝左基准：flip=1 显示朝左、flip=-1 镜像显示朝右。
      // 拖拽方向 → 朝向：向左拖朝左（flip=1）、向右拖朝右（flip=-1）。
      const nextFlip = e.clientX < lastPointerX ? 1 : -1
      if (nextFlip !== flip) {
        flip = nextFlip
        const dragCfg = stateOf(character, 'drag')
        if (animState === 'drag' && dragCfg && loaded.has(sheetKey(dragCfg.sheet))) showSprite('drag', dragCfg)
        applyHitArea() // drag 方向变化 → 热区镜像对齐
      }
    }
    lastPointerX = e.clientX
    if (!moved) return
    const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - host.offsetWidth))
    const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - host.offsetHeight))
    host.style.left = `${x}px`
    host.style.top = `${y}px`
    host.style.right = 'auto'
    host.style.bottom = 'auto'
  })
  hitarea.addEventListener('pointerup', (e) => {
    pressed = false
    dragging = false
    const wasMoved = moved // 快照：本 handler 内 moved 会归零，菜单判断用快照
    if (hitarea.hasPointerCapture(e.pointerId)) hitarea.releasePointerCapture(e.pointerId)
    if (wasMoved) {
      savePos() // 拖拽结束落盘位置
      dragReleaseUntil = Date.now() + DRAG_RELEASE_MS // 放下缓冲：短暂回 idle
      releaseInteraction() // 放下即用户在场：重置空闲（不再放下即回 sleep）；睡着则播 wake
      moved = false // 收尾完成：releasePointerCapture 会触发 lostpointercapture，moved 归零防重复收尾
    }
    layoutStatus() // 拖拽结束：状态卡恢复（若仍在 hover）
    // 点菜单按钮不切换菜单（按钮的 click 触发互动）。
    if (!wasMoved && !e.target.closest('button')) toggleMenu()
  })
  // 拖拽被系统打断（pointercancel / 捕获被抢/元素移除）：同样按「放下」收尾——
  // 回 idle 缓冲 + 重置空闲（用户拖过 = 在场），防拖拽状态卡死 + 防打断后立即回 sleep。
  const onDragAbort = () => {
    pressed = false
    dragging = false
    if (moved) {
      dragReleaseUntil = Date.now() + DRAG_RELEASE_MS
      releaseInteraction()
      moved = false
    }
    layoutStatus()
  }
  hitarea.addEventListener('pointercancel', onDragAbort)
  // 捕获被系统强制释放（元素移除/其它元素抢捕获）时复位，防拖拽状态卡死。
  hitarea.addEventListener('lostpointercapture', onDragAbort)
  // 键盘（a11y）：Enter/Space 切换菜单；Esc 关闭；点外部关闭。
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleMenu()
    }
  })
  const onDocPointerDown = (e) => {
    if (!host.contains(e.target)) toggleMenu(false)
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape') toggleMenu(false)
  }
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeyDown)
  feedBtn.addEventListener('click', () => interact('feed'))
  playBtn.addEventListener('click', () => interact('play'))
  roleBtn.addEventListener('click', () => {
    // 循环切换：当前角色 → 清单中下一个（manifest 已加载时；单角色无操作）。
    const roles = listCharacters(manifest)
    if (roles.length < 2) return
    const idx = roles.indexOf(characterId)
    const next = roles[(idx + 1) % roles.length]
    switchCharacter(next)
    toggleMenu(false)
  })

  // ---- 开放契约（CustomEvent，第三方插件自建缝驱动显示层）----
  // 文档化事件（detail 见 docs/architecture-evolution.md 开放性节）：
  //   whale-girl:say    { text }          → 气泡说话
  //   whale-girl:fx     { type: 'hearts' } → 爱心爆发
  //   whale-girl:status { text }          → 状态卡 note 覆盖（临时，2.5s 恢复）
  // 派发方式：window.dispatchEvent(new CustomEvent('whale-girl:say', { detail: { text } }))
  // 零耦合：事件在 document 冒泡，第三方无需依赖 whale-girl 模块；detail 校验后消费。
  const onPetSay = (e) => {
    if (e.detail && typeof e.detail.text === 'string' && e.detail.text.length > 0) showReply(e.detail.text)
  }
  const onPetFx = (e) => {
    if (e.detail?.type === 'hearts') spawnHearts()
  }
  const onPetStatus = (e) => {
    if (e.detail && typeof e.detail.text === 'string') {
      const prev = metaNote.textContent
      metaNote.textContent = e.detail.text
      setTimeout(() => {
        if (metaNote.textContent === e.detail.text) renderStatus()
      }, 2500)
    }
  }
  document.addEventListener('whale-girl:say', onPetSay)
  document.addEventListener('whale-girl:fx', onPetFx)
  document.addEventListener('whale-girl:status', onPetStatus)

  // ---- 游走（walk 行为）：周期性沿视口底部散步 ----
  const stopWalk = () => {
    walking = false
    if (walkRaf !== null) {
      cancelAnimationFrame(walkRaf)
      walkRaf = null
    }
    scheduleWander()
  }
  const scheduleWander = () => {
    clearTimeout(wanderTimer)
    if (!cfg.walk.enabled) return // 游走开关关闭：不排程（walk.enabled 配置）
    const wait = cfg.walk.minWaitMs + Math.random() * (cfg.walk.maxWaitMs - cfg.walk.minWaitMs)
    wanderTimer = setTimeout(() => {
      if (sleeping || sessionMood.thinking || sessionMood.waiting) {
        scheduleWander() // 睡着了或会话活跃（思考陪伴/等待批准）不走，延后重排
        return
      }
      wander()
    }, wait)
  }
  const wander = () => {
    walking = true
    walkDir = Math.random() < 0.5 ? 1 : -1
    // 素材统一朝左基准：向右走（walkDir=1）应显示朝右 → flip=-1（镜像）；向左走 flip=1。
    flip = -walkDir
    // walk 可能已经是当前状态；此时 setState 会短路，必须主动刷新
    // sprite transform，否则新一轮游走仍沿用上一轮朝向。
    const walkCfg = stateOf(character, 'walk')
    if (animState === 'walk' && walkCfg && loaded.has(sheetKey(walkCfg.sheet))) showSprite('walk', walkCfg)
    applyHitArea() // walk 方向变化 → 热区镜像对齐
    const duration = cfg.walk.minMs + Math.random() * (cfg.walk.maxMs - cfg.walk.minMs)
    const start = performance.now()
    const maxX = Math.max(0, window.innerWidth - host.offsetWidth)
    const maxY = Math.max(0, window.innerHeight - host.offsetHeight)
    // 从当前位置开始走（不跳位）：垂直保持宠物当前 top，水平从当前 left 起步。
    // 默认锚定（right/bottom 无内联样式）时 getBoundingClientRect 给出真实位置。
    const rect = host.getBoundingClientRect()
    const startLeft = Math.min(Math.max(rect.left, 0), maxX)
    const startTop = Math.min(Math.max(rect.top, 0), maxY)
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    const step = (t) => {
      if (sleeping || dragging || sessionMood.thinking || sessionMood.waiting) {
        stopWalk()
        return
      }
      const x = startLeft + walkDir * cfg.walk.speedPxPerSec * ((t - start) / 1000)
      if (x <= 0 || x >= maxX || t - start >= duration) {
        host.style.left = `${Math.min(maxX, Math.max(0, x))}px`
        host.style.top = `${startTop}px`
        stopWalk()
        return
      }
      host.style.left = `${x}px`
      host.style.top = `${startTop}px`
      walkRaf = requestAnimationFrame(step)
    }
    walkRaf = requestAnimationFrame(step)
  }

  // ---- working 随机插曲节奏器（v3）----
  // think 是思考陪伴常态，working 是偶尔插入的工作姿态（随机触发、随机时长）。
  // 决策在纯函数 nextWorkingRhythm（注入随机源、可单测）；本层只做「到点翻转」：
  // 每次翻转后按决策结果安排下一次闹钟。会话不活跃时撤防（回 think，不安排闹钟，
  // 由 onSessions 在会话开始时重新武装）。
  const armWorking = () => {
    if (workingTimer !== null) clearTimeout(workingTimer)
    workingTimer = null
    if (!sessionMood.thinking) {
      working = { active: false, until: 0 } // 会话不活跃：插曲撤防
      return
    }
    const decision = nextWorkingRhythm({ now: Date.now(), sessionThink: true, working, random: Math.random })
    const delay = Math.max(0, decision.until - Date.now())
    workingTimer = setTimeout(() => {
      workingTimer = null
      working = { active: decision.active, until: 0 } // 进入决策目标状态
      armWorking() // 基于新状态做下一次决策（think→working→think…）
    }, delay)
  }

  // ---- 启动（enabled 门控）：先取配置判定网页端渲染开关，禁用时不启动任何计时器并卸载 ----
  // 双宠物场景：桌面伴侣（外部 HTTP 消费者）并存时用户可在设置关掉网页端宠物；
  // 引导期 host 已隐藏（不闪一下再消失）；运行中热切换由 applyClientConfig 处理。
  let animTimer = null
  let sse = null
  const boot = async () => {
    const config = await fetchConfig()
    if (config !== null && config.enabled === false) {
      dispose()
      return
    }
    if (config !== null) applyClientConfig(config)
    host.style.display = ''
    loadAssets()
    refresh()
    pollTimer = setInterval(refresh, cfg.pollMs)
    animTimer = setInterval(tick, TICK_MS)
    scheduleWander()
    armWorking()
    // ---- SSE 即时事件（v9）：Node half 事件发生时推送，收到立即 refresh() ——
    // 回合完成庆祝/欢迎/思考陪伴不再等 pollMs 轮询（默认 3s → 单次 /state 往返）。
    // EventSource 断线自动重连（内建，retry 3s）；轮询保留兜底（SSE 不可用时照常跑）。
    try {
      sse = new EventSource(EVENTS_PATH)
      sse.onmessage = () => refresh()
      // onerror 不处理：EventSource 内建自动重连；重连期间轮询兜底，宠物照常。
    } catch {
      // EventSource 不可用（罕见）：轮询兜底，宠物照常跑
    }
  }
  boot()

  // ---- 会话感知（v8：Node half 聚合，退役本地 sessions 订阅）----
  // 自渲染 client 无 ctx.sessions（官方注入面只给 __DSH_BOOT__），会话状态（think/wait/
  // 回合完成）改由 Node half 在 /state 下发（refresh 里读 act.sessionThink/sessionWait/
  // turnCompleted）。不再订阅 host sessions 服务——旧订阅在自渲染形态下 ctx 为空恒失效。
  armWorking() // 首次武装 working 插曲（后续由 refresh 的 sessionMood 变化驱动）

  // 回前台立即刷新（后台标签轮询被节流，状态可能陈旧）。
  // 页面隐藏时暂停轮询与动画检查（rAF 浏览器已自动停，这里把 JS 定时器也停掉，
  // 避免后台空转耗 CPU/电）；回前台重建定时器并立即刷新，行为与原先一致。
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      if (pollTimer === null) pollTimer = setInterval(refresh, cfg.pollMs)
      if (animTimer === null) animTimer = setInterval(tick, TICK_MS)
      refresh()
    } else {
      if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
      if (animTimer !== null) { clearInterval(animTimer); animTimer = null }
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  // 窗口缩放后把已拖拽的位置重新 clamp 进视口，并重算状态卡布局（视口边界变化）。
  const onResize = () => {
    if (!host.style.left) return // 默认右下角锚定无需处理
    const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth))
    const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight))
    host.style.left = `${x}px`
    host.style.top = `${y}px`
    layoutStatus()
  }
  window.addEventListener('resize', onResize)

  // 页面状态感知：DSH onboarding 向导激活或桌面伴侣在场时宠物隐藏（display:none，
  // 不挡向导 / 避免双宠物）；dialog 打开时降为 inert（半透明、不挡点击）。
  // onboarding 判定：deepseek-onboarding-title（DSH 向导页面标题，精确标识——
  // 不用宽泛的 [class*="onboarding"] 子串，避免误伤类名含 onboarding 的其它元素）。
  // companionOnline：/state 下发的桌面伴侣在场窗口（心跳过期自动恢复显示）。
  let pageHidden = false
  let companionOnline = false
  const syncInert = () => {
    const dialog = document.querySelector('[role="dialog"]') !== null
    const onboarding = document.getElementById('deepseek-onboarding-title') !== null
      || document.querySelector('[aria-labelledby="deepseek-onboarding-title"]') !== null
    const next = onboarding ? 'onboarding' : companionOnline ? 'companion' : dialog ? 'dialog' : null
    if (next !== pageHidden) {
      pageHidden = next
      if (next === 'onboarding' || next === 'companion') {
        host.setAttribute('data-whale-girl-hidden', '')
        host.removeAttribute('data-whale-girl-inert')
        // 内联是权威（CSS 规则可能被宿主清理——属性设了但视觉不变）。
        host.style.display = 'none'
        host.style.opacity = ''
      } else if (next === 'dialog') {
        host.removeAttribute('data-whale-girl-hidden')
        host.style.display = ''
        host.setAttribute('data-whale-girl-inert', '')
        host.style.opacity = '.25' // inert 半透明（CSS 规则可能被宿主清理）
      } else {
        host.removeAttribute('data-whale-girl-inert')
        host.removeAttribute('data-whale-girl-hidden')
        host.style.display = ''
        host.style.opacity = ''
      }
    }
  }
  const dialogObserver = new MutationObserver(syncInert)
  dialogObserver.observe(document.body, { childList: true, subtree: true })
  syncInert()

  // 卸载（enabled=false 与 loader 卸载共用；幂等——计时器/监听器/节点均可重复清理）。
  const dispose = () => {
    clearInterval(pollTimer)
    if (animTimer !== null) clearInterval(animTimer)
    if (sse !== null) sse.close()
    clearTimeout(wanderTimer)
    if (workingTimer !== null) clearTimeout(workingTimer)
    if (walkRaf !== null) cancelAnimationFrame(walkRaf)
    for (const t of bubbleTimers) clearTimeout(t) // 气泡残留计时器一并清
    bubbleTimers.clear()
    clearBubble() // 活动气泡引用清空（DOM 随 host.remove() 移除）
    dialogObserver.disconnect()
    document.removeEventListener('pointerdown', onDocPointerDown)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('whale-girl:say', onPetSay)
    document.removeEventListener('whale-girl:fx', onPetFx)
    document.removeEventListener('whale-girl:status', onPetStatus)
    host.removeEventListener('mouseenter', onHostEnter)
    host.removeEventListener('mouseleave', onHostLeave)
    window.removeEventListener('resize', onResize)
    host.remove()
    style.remove()
  }
  return dispose
}

// 标准 bundle client 形态（0811）：exports {name, apply} 经 __ModuleLoader__.load
// 注册，由 client 内核挂载时调用 apply(ctx)。ctx 仅消费 sessions（会话感知）；
// 缺席时降级——宠物照常跑，无思考陪伴。
export const name = 'whale-girl'
