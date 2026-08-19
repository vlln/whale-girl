<p align="center">中文 | <a href="README.md">English</a></p>

<h1 align="center">whale-girl</h1>

<p align="center">
  <strong>DSH Web GUI 内的桌面宠物（QQ 宠物形态）</strong><br/>
  右下角悬浮的积累型伙伴：可拖拽、可投喂/玩耍，陪伴你的工作台脉搏——
  完成任务/会话/活跃陪伴时长积累成资历等级、称号与回忆。
</p>

<p align="center">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license" />
  <img src="https://badgen.net/badge/format/official%20bundle/8257D0" alt="official bundle" />
</p>

---

## 安装

官方 **bundle 插件** 格式（仓库根 `package.json` 的 `dsh.bundle` + `dsh.client`）。经官方 profile 管理：

```sh
dsh plugin --profile web add "github:vlln/whale-girl#main"   # git 源一行（构建产物已入库）
# 或 npm 源：dsh plugin --profile web add whale-girl@0.1.0
# 或本地目录：dsh plugin --profile web add <whale-girl 本地路径>
```

装完 **重启 web**（bundle 层在启动时合成），右下角出现宠物：点击弹出菜单（🍗 喂食 / 🎾 玩耍），拖拽可移动；hover 显示状态条（资历等级/任务数/最近共同回忆）。初始配置/欢迎页（onboarding）宠物隐藏。

更新插件时 `dsh plugin --profile web update whale-girl`（或换 git 源 ref），重启生效。

## 使用

| 你做什么 / 发生什么 | 宠物表现 |
|---|---|
| 拖拽宠物 | 被斜向拉扯（`drag`） |
| 点击菜单 🍗 喂食 / 🎾 玩耍 | 啃咬/抛接球（`eat`/`play`）→ 开心（`joy`） |
| 空闲 ≥60s | 打盹（`sleep`）；互动时醒过来（`wake`） |
| 任务完成 / 升级 / 称号 / 回合完成 | 举手欢呼（`celebrate`） |
| 任务失败 / 请求出错 | 惊吓（`error`）→ 失落（`disappointed`） |
| 新会话开始 | 挥手欢迎（`welcome`） |
| 任一会话运行/思考中 | 沉思陪伴（`think`，偶尔 `working` 工作姿态） |
| 等待批准 | 期待等待（`wait`） |
| 周期游走 | 散步（`walk`） |
| 常态 | 待机（`idle`，随机眨眼/转身） |

完整状态机（优先级/转换语义/触发源）见 [docs/state-machine.md](docs/state-machine.md)。

## 桌面伴侣（可选）

`desktop/` 是**独立桌面伴侣应用**（Node 引擎 + Tauri 渲染壳，零运行时依赖），把鲸鱼娘渲染到操作系统桌面常驻。**不随 `dsh plugin` 安装**——想要桌宠的用户自行启用：

```sh
# 前置：Node ≥18；桌面渲染壳需 Rust 工具链（cargo）
npm install -g whale-girl-desktop   # npm 源安装（引擎 + Tauri 渲染壳源码随包分发）
whale-girl-desktop --headless       # 无窗模式可用：presence 心跳 + 状态轮询 + SSE
cd "$(npm root -g)/whale-girl-desktop/src-tauri" && cargo build --release  # 首次编译约 5-15 分钟；产物 target/release/whale-girl-desktop（约 12MB）
./target/release/whale-girl-desktop   # 启动透明置顶桌宠（默认连本机 DSH 3080）
# WHALE_GIRL_BASE_URL=http://IP:PORT 指向非本机 DSH
# 或从源码：cd desktop && npm install && cd src-tauri && cargo build --release
```

- 消费 whale-girl 既有公开端点（`/state`、`/events`、`/presence`、`/interact`、`/config`、`/assets`），**不改动插件本体**；运行期间网页端宠物自动隐藏（presence 契约），退出或崩溃（TTL 45s 过期）后恢复。
- 渲染壳：Tauri v2（推荐，体积 ~12MB）；Electron 遗留壳保留（`npm i -D electron` 后可用）。
- 设计与契约见 `desktop/DESIGN.md`、`desktop/BUILD-RUN.md`。

## 状态预览

| 状态 | 触发 | 预览 |
|---|---|---|
| `idle` | 常态待机 | ![idle](docs/preview/idle.gif) |
| `working` | 会话思考期随机工作插曲 | ![working](docs/preview/working.gif) |
| `celebrate` | 任务完成/升级/称号/回合完成 | ![celebrate](docs/preview/celebrate.gif) |
| `error` | 任务失败/请求出错 | ![error](docs/preview/error.gif) |
| `disappointed` | 失败后短时失落 | ![disappointed](docs/preview/disappointed.gif) |
| `joy` | 投喂/玩耍后开心 | ![joy](docs/preview/joy.gif) |
| `eat` | 点击投喂 | ![eat](docs/preview/eat.gif) |
| `play` | 点击玩耍 | ![play](docs/preview/play.gif) |
| `drag` | 拖拽中 | ![drag](docs/preview/drag.gif) |
| `walk` | 周期游走 | ![walk](docs/preview/walk.gif) |
| `sleep` | 空闲 ≥60s | ![sleep](docs/preview/sleep.gif) |
| `wake` | 睡醒过渡 | ![wake](docs/preview/wake.gif) |
| `welcome` | 新会话 | ![welcome](docs/preview/welcome.gif) |
| `think` | 会话思考陪伴 | ![think](docs/preview/think.gif) |
| `wait` | 等待批准 | ![wait](docs/preview/wait.gif) |

## 配置

参数经宿主 settings 配置，`<dshHome>/settings.yaml` 的 `whale-girl:` section（或设置 UI）修改后**热生效免重启**：

```yaml
whale-girl:
  enabled: true      # 网页端渲染开关（与桌面伴侣并存时设 false 关闭网页端宠物，避免双宠物）
  size: 110          # 宠物尺寸 px（64–160）
  opacity: 1         # 常态透明度（0.2–1）
  walk:
    enabled: true    # 游走开关
  sleepAfterMs: 60000
```

完整配置项清单与语义层（XP/称号）封闭说明见 `lib/src/config.mjs`。**语义层不可配**（改 XP/称号阈值会破坏积累账本一致性）。

## 角色

菜单「🎭 换角色」循环切换角色（或设置 localStorage `whale-girl:character`）；**manifest 仅 1 个角色时按钮置灰**（悬停提示「暂无其他角色」）。每个角色提供**全部 15 状态**素材（素材全量契约，见 [docs/sprites-spec.md](docs/sprites-spec.md)）；贡献新角色指南见 [docs/adding-a-character.md](docs/adding-a-character.md)。

## 作为参考实现

whale-girl 是官方 **bundle 插件格式**的完整范本（`dsh.bundle` + `cordis.patch.yml` + `lib/` 布局，随官方机制演进）——开发新插件可对照：

- **结构**：`lib/`（入口/纯逻辑/client/素材）与 docs/decisions/scripts 分离，见根 [AGENTS.md](AGENTS.md)
- **规范**：门禁（`scripts/gates/run.mjs`）+ 决策记录 + 素材全量契约；开发引导见 plugin-registry 的 [make-dsh-plugin skill](https://github.com/vlln/plugin-registry/tree/main/skills/make-dsh-plugin) 与 [cookbook](https://github.com/vlln/plugin-registry/blob/main/docs/cookbook/creating-a-plugin.md)，踩过的坑见 [gotchas](https://github.com/vlln/plugin-registry/blob/main/skills/make-dsh-plugin/references/gotchas.md)

## 贡献

**欢迎提交 issue 和建议**——你的反馈直接决定宠物的下一步：

- 🐛 **遇到问题**：提交 issue，附复现步骤、浏览器与 dsh 版本；客户端问题附控制台报错更佳
- 💡 **功能建议**：参考 [docs/state-machine.md](docs/state-machine.md) 与 [docs/growth-system.md](docs/growth-system.md) 了解现状，说明期待效果
- 🎨 **新角色**：见 [docs/adding-a-character.md](docs/adding-a-character.md) §贡献角色速览——只读契约，产出 15 张 sheet + manifest 条目，本地 `verify-assets` 验收
- 🔧 **代码贡献**：每个非平凡改动带决策记录（`decisions/`）、门禁自证、单一性质提交（见 [docs/AGENTS.md](docs/AGENTS.md) 与根 [AGENTS.md](AGENTS.md)）

## 致谢

角色形象由 [ZipZipPipe](https://space.bilibili.com/4168597) 创作（《鲸鱼娘》表情包角色），sprites 基于其角色设定生成。

## License

MIT License
