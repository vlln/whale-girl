<p align="center">中文 | <a href="README.md">English</a></p>

# whale-girl-desktop

把 [whale-girl](https://github.com/vlln/whale-girl)（DSH Web GUI 桌面宠物插件）的鲸鱼娘渲染到**操作系统桌面**常驻：透明置顶窗、可拖拽/投喂/玩耍、周期游走，实时跟随 DSH 会话状态（思考/等待/任务完成庆祝）。

**零运行时依赖**：Node 引擎无第三方包；桌面渲染壳用 Tauri（系统 webview，体积 ~12MB，对比 Electron 277MB）。

## 安装

```sh
npm i -g whale-girl-desktop          # 或项目内 npm i whale-girl-desktop
# 桌面渲染壳需要 Rust 工具链（cargo）：
cd "$(npm root -g)/whale-girl-desktop/src-tauri" && cargo build --release
```

## 使用

```sh
# 无窗模式（presence 心跳 + 状态轮询 + SSE，自测/CI/无桌面环境）
whale-girl-desktop --headless

# 桌面宠物（透明置顶窗）——需先 cargo build --release
"$(npm root -g)/whale-girl-desktop/src-tauri/target/release/whale-girl-desktop"
# 或从源码仓库：cd desktop && npm run build:tauri && npm run start:tauri
```

指向非本机 DSH：`WHALE_GIRL_BASE_URL=http://IP:PORT`（默认 `http://127.0.0.1:3080`）。

## 前置

- DSH 已安装 whale-girl 插件（`dsh plugin --profile web add "github:vlln/whale-girl#main"`）
- Node ≥18；桌面渲染需 cargo（Rust 工具链）

## 行为

- 运行期间网页端宠物自动隐藏（presence 契约），退出/崩溃（TTL 45s 过期）后恢复
- 状态转换/点击互动/拖拽/游走与插件版对齐；设计与契约见 [DESIGN.md](DESIGN.md)、[BUILD-RUN.md](BUILD-RUN.md)

## License

MIT
