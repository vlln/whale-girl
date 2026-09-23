# Decision: 迁移到官方 bundle 形态（0811 repository 机制移除）

Status: implemented

## Problem

官方 0811 移除 repository-plugins 机制（`vendor/loader/src/repository.ts` 删除，−258 行）：
- `.dsh-plugin` 的 `dsh.entry` 声明不再被识别（client-modules 只扫描 `dsh.client` 声明包）
- `dsh-repository-plugin` builtin 删除——旧 `dsh-plugin.mjs` wrapper 直接报 `missing Cordis builtin`
- client 自执行脚本（repository 形态的 tapIndex 注入）不再被加载——0811 client-modules
  要求 client bundle 经 `__ModuleLoader__.load({id, factory})` 注册

现状（迁移前）：根 `package.json` 无 `main`/`exports`/`dsh.bundle`；client 是自执行 IIFE，
经 entry 的 `ui.js` 路由 + `httpServer.tapIndex` 注入页面。

## Decision

转**官方 bundle 形态**（与 dsh-loop/navbar/task-status 一致），包根 = 仓库根：

- **根 `package.json`**：补 `main` → `.dsh-plugin/index.mjs`、`exports`（`.`/`./client`/
  `./cordis.patch.yml`/`./package.json`）、`dsh.bundle.patch` → 新建 `cordis.patch.yml`
  （`- insert: - id: whale-girl name: whale-girl`）、`dsh.client`（platform web）
- **client 打包**：`scripts/build-client.mjs` 从「纯 IIFE 自执行」改为「esbuild CJS +
  外层 `window.__ModuleLoader__.load({ id: "whale-girl", factory })` 包装」——factory 返回
  `module.exports = {name, apply}`，由 client 内核挂载时调用 `apply(ctx)`
- **client 入口**：`.dsh-plugin/client/index.mjs` 尾部 `apply({})` 自执行改为
  `export const name` + `export function apply`（命名导出，供 bundle 包装）
- **Node half**：删除 `ui.js` 路由 + `httpServer.tapIndex` 注入（client 改由
  client-modules 挂载）；state/interact/config/assets/events 路由保留
- **`.dsh-plugin/package.json`**：不消费（旧 repository 形态残留），删除 `dsh.entry`/`prepack` 声明，仅保留文件清单与依赖
- **repository 残留清理**（无风险，零消费审计）：删除 `.dsh-plugin/dsh-plugin.mjs`（wrapper 生成物，bundle 不消费）、`.dsh-plugin/dsh-plugin-assets/`（空目录）、`scripts/prepare-cache.mjs`（repository 预填充脚本，门禁不引用）；`.dsh-plugin/package.json` 的 `files` 清理残留条目 + 移除未发布死依赖 `@deepseek-ai/dsh-repository-plugin`；README 安装章节 + docs/sprites-spec 实况验证改指 bundle 安装
- 安装方式从「insert 行 hack」变为官方 `dsh plugin --profile web add <仓库根>`（进层栈）

## Alternatives considered

**A：保持 repository 形态 + insert 行 hack。** 验证站临时可行（补 main 指向 index.mjs +
insert 行挂载），但：`.dsh-plugin` 目录是只读仓库需 hack、client 仍无 `__ModuleLoader__`
注册（浏览器加载报错）、无升级路径。弃：0811 下 repository 是死路。

**B：只补 client 声明不转 bundle。** 给 `.dsh-plugin` 加 `dsh.client` + exports 后 client
能进 boot，但包根仍是 `.dsh-plugin/` 子目录（repository 布局），与官方 bundle 生态割裂。
弃：半吊子，不如一次转正。

## 取代检查

- 旧 `decisions/implemented/simplification/2026-08-10-migrate-to-official-repository-plugin.md`
  （迁移到 repository 形态的决策）被本文取代——0811 官方移除 repository 机制，反向迁移。
- 本文后续被 [2026-08-13-standard-bundle-layout](2026-08-13-standard-bundle-layout.md) 部分取代——该记录把 `.dsh-plugin/` 目录收敛为 `lib/`（标准 bundle 布局），完成本文遗留的「与官方 bundle 生态割裂」缺口。
- 后续（0907+ dsh）：本文 Consequences 里的 inject 补 `settings` 描述被 [2026-09-23-dsh-0907-node-half-compat](../bug-fix/2026-09-23-dsh-0907-node-half-compat.md) 部分取代（settings.register 移除，inject 收敛为 jobs/sessions/webServer）；`webServer`/`httpServer` 服务名以 `lib/index.mjs` 现状为准。
- 门禁：`node scripts/gates/run.mjs`（11 门禁）+ `node scripts/build-client.mjs --check`
  全过；单测 112 例全过；验证站端到端（client 挂载 + 宠物渲染，headless Chrome 实证）。

## Consequences

- 安装方式统一为官方 `dsh plugin --profile web add <仓库根>`（进 `dsh.profile.bundles` 层栈），不再需要 insert 行 hack。
- client 由 client-modules 挂载（`__ModuleLoader__.load`），浏览器端渲染宠物；Node half 不再注入页面。
- `.dsh-plugin/package.json` 成为不消费的 repository 形态残留（保留供追溯）；包根身份 = 仓库根 package.json。
- `verify-client-smoke.mjs` 的 DOM 断言基于旧注入形态（服务端 HTML 找宠物元素），转 bundle 后不再适用——浏览器验证以 `verify-client-behavior.mjs`（运行时 querySelector）为准。
- 门禁与单测保持通过（11 门禁 + 112 单测）；验证站端到端：client 挂载 + 宠物渲染（headless Chrome 实证）。
- **inject 补 `settings`/`httpServer`**（0811 cordis 严格注入）：`ctx.get('settings')`/
  `ctx.get('httpServer')` 未在 inject 声明时抛 `cannot get property without inject`，
  apply 开头即炸、整个 effect 不注册（路由全 fallback）。bundle 形态下 whale-girl
  只进 web profile（base 层必有 settings，web 组合必有 httpServer），inject 安全；
  headless 降级设计随 repository 形态废弃（GUI 宠物本就不该装 headless）。
