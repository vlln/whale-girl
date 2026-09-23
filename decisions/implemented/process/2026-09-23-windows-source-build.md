# Decision: Windows 源码构建——esbuild JS wrapper 调用 + client.js eol=lf

Status: implemented

## Problem

Windows 开发者干净克隆即两处失败，源码构建（`node scripts/build-client.mjs`）不可用：

- `resolveEsbuildBin` 只认 `node_modules/.bin/esbuild`——win32 下这是 POSIX sh shim，
  `spawnSync` 无法执行且 `res.stderr` 为 undefined，`--check` 直崩
  `TypeError: Cannot read properties of undefined (reading 'trim')`。
- 全局 `core.autocrlf=true` 检出 `lib/client.js` 为 CRLF，esbuild 输出恒 LF——逐字节
  新鲜度比对在干净克隆上必失败（`--check` 误报「手改生成物」）。

## Decision

- `resolveEsbuildCommand`：win32 走 `node_modules/esbuild/bin/esbuild`（`process.execPath`
  启动 JS wrapper，平台自选原生二进制），DSH_CHECKOUT 兜底同形；POSIX 维持 sh shim 直调
  （既有行为不变）。
- 失败信息对 `res.stderr ?? res.error` 容错，spawn 失败不再崩在错误报告本身。
- `.gitattributes` 锁 `lib/client.js text eol=lf`：检出字节与生成器输出一致，--check 在
  Windows 干净克隆直接通过。

## 取代检查

无重叠：[2026-08-12-migrate-to-bundle-format](../simplification/2026-08-12-migrate-to-bundle-format.md)
决定的是 bundle 打包形态（esbuild CJS + `__ModuleLoader__` 包装），本文只补其平台可移植性
缺口，不改打包决策。

## Alternatives considered

**A：spawnSync 调 `.bin/esbuild.cmd`（`shell: true`）。** 走 shell 引入引号/注入面且 Node
官方对 `.cmd` 直调已弃用；JS wrapper 跨平台零 shell。弃。

**B：只修 `res.stderr` 容错。** 崩溃变报错但构建仍不可用——掩盖失败不修根因。弃。

**C：`.gitattributes` 全仓 `* text=auto eol=lf`。** 影响面超出本次缺口（他人编辑器/IDE
集成差异），只锁被字节门禁消费的生成物。弃。

## Consequences

- Windows 干净克隆：`node scripts/build-client.mjs --check` 直接通过；构建产物与 POSIX
  逐字节一致（单一生成路径）。
- POSIX 构建路径不变（sh shim 优先）；`esbuildAvailable()` 契约不变，自证测试跳过逻辑
  照旧。
- 既有克隆（检出已 CRLF）需一次 `git add --renormalize .` 或重新检出才会消除工作副本的
  行尾差异。
