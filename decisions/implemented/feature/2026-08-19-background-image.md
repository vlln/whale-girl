# Decision: DSH 全屏背景（图片 / MP4 视频）

Status: implemented

## Problem

用户希望鲸鱼娘插件提供一个改变 DSH Web GUI 背景的能力：还原默认、导入背景，导入后可调节
透明度——透明度 100% 时显示默认背景，0% 时显示完整背景。入口排在点击鲸鱼娘弹出的菜单
（喂食/玩耍/换角色）之后。背景需同时支持**静态图片**与**动态视频（MP4）**。

## Decision

**纯客户端实现**（`lib/client/index.mjs`），不新增 Node half 端点、不改设置 schema、不改
积累账本：背景是显示层偏好，归 client 自管（与角色选择/窗口位置同一模式）。

- **菜单入口**：在 `menu.append(feedBtn, playBtn, roleBtn)` 后追加「🖼️ 背景」按钮；点击
  toggle 一个背景面板（沿用 `PANEL_THEME` 基调 + 内联样式），含「📁 图片」「🎬 视频」
  「↩️ 还原默认」与透明度滑条（0–100），外加一行当前背景类型/体积状态。
- **背景层**：全屏 `position: fixed; inset: 0; z-index: -1; pointer-events: none` 的 div，
  内部常驻一个 `<video>`；`opacity = (100 - 透明度)/100` 统一控制图片与视频的可见度。
  - 图片：`background-image: url(dataURL)` + `background-size: cover` 居中。
  - 视频：`<video muted loop autoplay playsinline>` + `object-fit: cover` 铺满视口。
    `muted` 是浏览器自动播放策略的前提；`playsinline` 防移动端全屏接管。
- **压过默认底色**：DSH 主框架背景是 `--dsw-alias-bg-base`、侧边栏是 `--dsw-specific-sidebar-fill`，
  默认不透明会遮住 z-index:-1 的背景层。故启用背景且透明度 <100 时把这两个变量覆盖为
  `transparent`；透明度 =100（或未导入）时 `removeProperty` 恢复默认背景——「100% = 默认
  背景」不是露白底，而是真恢复主题变量。
- **主题变化兜底**：主题服务（dsh-client-ui-layout ThemePresenter）在 theme/change 时会
  `removeProperty` 后重写 body 内联 token，覆盖会被清掉。用 `MutationObserver` 观察
  `body` 的 `style` 属性，值非预期时重新覆盖（值相同不重设，防观察-设置循环）。
- **图片导入压缩**：隐藏 `<input type=file accept="image/*">` → FileReader → canvas 缩放
  （最长边 ≤1600px、JPEG 0.85，控制 localStorage 体积）。
- **视频存储用 IndexedDB（关键决策）**：视频动辄几十 MB，base64 后还要膨胀 ~33%，远超
  localStorage 的 ~5MB 限额（且后者只能存字符串）。故视频以 **Blob 存 IndexedDB**
  （库 `whale-girl-bg`、单一键 `video`），localStorage 只存元数据 `{ kind, transparency }`；
  启动时读回 Blob → `URL.createObjectURL` → 挂载。替换/清理时 revoke 旧 URL 防泄漏。
  体积上限 300MB（超出拒绝并 console 提示）。
- **省电**：标签页 hidden 时暂停视频、visible 时（且透明度 <100）恢复；透明度 100% 时
  不播放（不可见就不解码）。视频背景持续播放是本功能最大的 CPU/GPU 开销，这两条是默认行为。
- **导入防护（实测驱动）**：用户实测导入 226MB / 1888×1078 / **77fps** / 15.1 Mbps 的
  Wallpaper Engine 壁纸后，网页明显卡顿、内存冲到 ~500MB（文件 Blob + 1080p 高帧率解码
  缓冲 + DSH 自身）。故加装三层防护：**>100MB 直接拒绝**；**>40MB / >1920×1080 / >40fps
  在面板给出黄字警告**（不阻止，用户可明知故犯）；状态行常显体积。帧率用
  `requestVideoFrameCallback` 在播放中采样 1 秒窗口实测（`presentedFrames / mediaTime`），
  分辨率取 `videoWidth/videoHeight`。同一素材压到 1280×730 / 24fps / 0.48 Mbps 后仅 7MB
  且流畅——说明瓶颈在规格而非功能实现，插件不做自动转码（见备选），改为引导用户压好再导入。
- **帮助入口**：状态行右侧一个「?」圆点，hover 显示说明浮层（触屏/键盘可点击、Enter/Space
  可切换）。浮层放在面板**左侧**（`right: calc(100% + 8px)`）——面板常驻屏幕右下角，右侧无
  空间，左侧朝屏幕中央方向。内容：四个入口的作用、透明度语义、视频规格建议、以及「导入后
  原文件可删除」。收起面板时一并隐藏，防残留浮层。
- **容错**：视频 decoding error（格式不支持/数据损坏）→ console 警告 + 清理 + 回退默认背景，
  不残留黑屏。
- **持久化与还原**：localStorage `whale-girl:background` = `{ kind:'image'|'video', ...,
  transparency }`；还原默认即删 key + 清 IndexedDB Blob。
- **清理**：dispose() 断开 observer、停播并 revoke 视频、移除背景层/面板/文件输入、恢复主题
  变量（保留 IndexedDB 数据：重新启用插件时背景仍在）。
- **菜单联动**：菜单关闭（toggleMenu(false)）时同步收起背景面板，防残留浮层。

## Alternatives considered

**视频也存 localStorage（base64/dataURL）。** 5MB 限额下只能放几秒低清视频，且编码/解码
开销大。弃用。

**Node half 存背景文件 + 新端点（/whale-girl/background）供客户端拉取。** 可存大文件且不占
浏览器配额；但要改 Node half（路由/读写/CSRF/上限面）与 settings schema，且背景是单机显示
层偏好，跨浏览器同步无意义。客户端 IndexedDB 更贴合现有模式，弃用。

**用 canvas 把视频转码为低码率 webm 再存。** 转码耗时（长视频可达分钟级）、质量损失、
且需 MediaRecorder 兼容分支。直接存原文件更简单可靠，弃用。

**插件内置自动转码（WebCodecs `VideoEncoder` 降分辨率/帧率）。** 看似最贴心，但从 `<video>`
抓帧必须让它**播放**（`requestVideoFrameCallback` 只在播放时回调），所以转码耗时≈视频时长
（2 分钟视频要等 2 分钟）；靠 `playbackRate` 加速会丢帧、结果不可控。为一次性的导入付出
如此复杂度与等待不值得。改为**文档引导用户压好再导入**（README 给出一行 ffmpeg 命令）+
面板警告阈值，把不可控的长任务留在插件之外。弃用。

**限制播放帧率（定时 seek 抽帧渲染，或暂停后逐帧推进）。** seek 成本高且画面顿挫，
`playbackRate` 也不降解码量；对 226MB 文件的内存占用更是毫无帮助。弃用。

**覆盖 body 的 background-image 而非 z-index:-1 图层。** body 背景会被 frame（position:
relative、自带 `background: var(--dsw-alias-bg-base)`）遮住，仍需改主题变量；且透明度控制
需要独立 opacity，图层方案更直接。弃用。

**直接改 --dsw-alias-bg-base 为背景色/半透明。** 变量是颜色 token，不能承载图片/视频；且
语义层（主题）与显示层（背景）不该耦合。弃用。

## Consequences

- 背景功能纯客户端，Node half、积累账本、settings、外部消费者契约（/state /events
  /interact /presence /config /assets）全部不受影响。
- 透明度过中值时 frame/侧边栏底色被透明化，露出的是背景层（半透明时与 DSH 自身底色混叠）；
  透明度 100% 时主题变量恢复，与「默认背景」语义一致。
- 图片存 localStorage、视频存 IndexedDB，均单浏览器生效；清浏览器数据或换浏览器会重置
  （预期内，与角色/位置一致）。**视频导入是「拷贝」而非「引用」**：文件被读成 Blob 存进
  IndexedDB，导入后源文件可删除、移动或重命名，背景照常恢复（反之换机/换浏览器需重新导入）。
- 视频背景有持续解码开销（已用后台暂停 + 100% 透明度停播缓解）；**卡顿与否主要由素材规格
  决定**，故插件只做「拒绝超限 + 警告超标 + 文档给压缩命令」，不替用户转码。实测
  1280×730/24fps（7MB）流畅，1888×1078/77fps（226MB）明显卡顿——同一壁纸素材。
- 已存于 IndexedDB 的旧大视频（如导入防护生效前存的）不会被自动删除，但恢复时会命中体积
  警告，用户可据此换成压缩版或还原默认。
- 客户端源码改动必须重新生成 `lib/client.js`（`node scripts/build-client.mjs`），构建产物
  已随本分支提交，安装即用。
