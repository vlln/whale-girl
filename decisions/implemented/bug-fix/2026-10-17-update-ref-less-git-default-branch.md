# Decision: 无 ref 的 git 安装按 `HEAD` 查上游

Status: implemented

## Problem

profile 允许不带 `#ref` 的 git spec（`github:vlln/whale-girl`），语义是跟仓库默认分支：`parseInstallSource` 认这种写法，`updateSpecs` 也为它生成「先钉提交、再换回默认分支」的两步计划。检查上游却是另一套实现：`gitUpstream` 在 `ref` 为空时拼出 `…/commits`——提交**列表**端点，返回数组、没有顶层 `sha`，于是 `payload.sha` 恒为 `undefined`、`decideUpdate` 判 `unknown`，界面永远显示「无法确认上游版本」。

这类安装因此既不会报「已是最新」，也永远发现不了新版；而两种写法在 profile 里同样合法、界面上看不出差别。`tests/update-host.test.mjs` 原有的 git 夹具都带 `#main`，这条分支没被走到。

## Decision

**`ref` 缺失时用 `HEAD`：`commits/HEAD` 解析到仓库默认分支的当前提交。** 只是把拼 URL 的那一行改成 `encodeURIComponent(parsed.ref ?? 'HEAD')`，不增加请求、不引入默认分支解析分支。

选它是为了最小改动：`GET /repos/<owner>/<repo>` 再取 `default_branch` 要两跳请求和一段解析（本地路径安装已有这套逻辑，但那是另一条来源），而 `HEAD` 在提交端点上是同一语义的一次请求。实测 `repos/vlln/whale-girl/commits/HEAD` 返回 `38e2721`，与 `commits/main` 一致；`HEAD` 若不再被接受，`status()` 的 catch 会报 `check-failed`，不会给出错误的「已是最新」。

载荷约定不变：git 安装的 `latest` 仍**不带 `ref`**。客户端只把 `latest.ref` 当「本地路径安装的跟踪线」标记，git 安装带上它会渲染出错误的按钮语义。

## 取代检查

部分取代 [feature/2026-10-05-plugin-update-row.md](../feature/2026-10-05-plugin-update-row.md)：该记录「git 安装问 `commits/<ref>`」只覆盖带 ref 的情形，无 ref 的那支由本记录接管；其余语义（来源只认 profile spec、两步重装、限流与失败文案、本地安装跟默认分支）仍归它。两条保持活跃并互链。

## Alternatives considered

**先查 `default_branch` 再查提交。** 用文档字段替代 `HEAD` 别名，但每次检查多一个请求，还要把「读默认分支」抽成与本地安装共用的帮手——改动面比修的这个缺陷大。

**取列表端点第一项。** 列表按提交时间倒序，第一项通常就是默认分支 HEAD；但这是把分页/过滤语义押在响应顺序上，同一份代码里已有显式 `HEAD` 可用。

**默认分支不可能叫 `HEAD`，直接猜 `main`。** 猜错时检查报「有新版」并准备把 profile 换到不存在的线上，代价大于省下的一个请求。

## Consequences

- 无 ref 的 git 安装恢复三态：锁文件提交等于默认分支当前提交时「已是最新」，落后时「有新版 <短提交>」；`HEAD` 解析失败按 `check-failed`/「无法确认上游」呈现。
- 带 `#ref` 的安装一字未变；`HEAD` 与显式 ref 共用同一条限流与错误路径。
- 回归防线：`tests/update-host.test.mjs` 新增「无 ref → 查 `HEAD`」用例，同时断言 `latest` 不带 `ref`。
