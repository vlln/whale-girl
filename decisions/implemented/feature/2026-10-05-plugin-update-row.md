# Decision: 配置卡片里的版本与更新行

Status: implemented

## Problem

DSH 不为 profile 安装的插件提供升级入口：`dsh-client-ui-plugin-manager` 的安装对话框写明「插件安装后暂不支持自动更新：升级需先卸载再安装新版」，页面也「没有版本选择器……不提供升级」。whale-girl 的版本号长期停在 `0.1.0`（git 安装下包的 `package.json` 版本号也不随提交变化），因此用户既看不到自己装的是哪个提交，也没有任何可用的升级动作——只能自己去翻 README、抄 spec、卸载重装。

## Decision

配置卡片首行加一条**版本与更新行**（`UpdateRow`），沿用卡片既有字段行的布局与官方 primitives：

- **更新目标只认 profile 记录的那条 spec**：`listBundles().source` 是安装事实，包清单里的 `repository` 只是发布元信息。不用它兜底，否则会把用户记的分支/标签换成另一条 spec，甚至把「安装自带的组合包」（它没有 profile 依赖）变成一条 profile 依赖。
- **本地路径安装跟包自己声明的仓库的默认分支**：`dsh plugin add <目录>` 这类安装，profile 里没有上游可跟，所以退回包清单声明的 `repository` 去查它的默认分支（通常是 `main`），拿本地检出的提交（`<目录>/.git/HEAD`）与上游比；点更新时一步把 profile 依赖从 `link:<目录>` 换成 `github:<owner>/<repo>#<默认分支>`——即「本地安装也跟 main」。检出不是 git 仓库、或包没声明仓库时仍旧报「无法确认上游」。这一处是唯一使用包清单 `repository` 的地方，且只用于本地安装：git/registry 安装的更新目标永远只认 profile 记的 spec。
- **更新不碰用户设置**：一次更新只写 profile 的 `package.json` 依赖与 `pnpm-lock.yaml`（宿主 `plugin-manager` 的 `RESTORED_FILES` 就这两个，失败时也只回滚这两个），条目的 `config:`（尺寸、透明度、回话文案、窗口时长……）与 patch 里其它条目一概不碰；传给 `installBundle` 的选项只有 `enabled`（原样保留启停）与 `requestId`，不带 `approvedBuilds`/`registry` 之类会改写 profile 的东西。本机实测：更新前后 `cordis.patch.yml` 逐字节一致，`/whale-girl/config` 里的设置不变。
- **状态行给出当前短提交**：宿主包页的「来源信息」只显示包版本，而 git 安装下版本号不随提交变化（长期停在 `0.1.0`），「我装的是哪个提交」只有这一处能看到；有新版时同一行写「有新版本 <目标>（当前 <提交>）」。
- **按钮只摆动作、不摆结论**：不再有「已是最新」「重启后生效」这类禁用标签——状态行说结果；刚更新完也能再查一次，重启与否由结果文案说清（`overridden` 用重启也解决不了，更不该写成「重启后生效」）。有新版但宿主不能更新时，按钮停在禁用的更新动作上、状态行说明原因。
- **只加更新，不重复版本**：包页的「来源信息」已经由页面画出所装版本与安装来源（`listBundles` 的 `source` 与包清单版本），卡片这一行不再显示一遍版本，只补页面没有的那件事——上游有没有新版、以及一键更新。有新版时状态行给出目标（git 装短提交、registry 装版本号），按钮文案里的版本号原样显示、不额外加 `v`。
- **挂载时自动检查一次上游**（并缓存到组件状态），按钮文案跟随 macOS 的「检查更新…」约定：动词 + 省略号表示会有一段进行中的操作；检查中禁用并显示「检查中…」，更新中显示「更新中…」。
- **检查走 Node half 的 `GET /whale-girl/update`**：客户端不直接访问上游（浏览器侧的 CSP/跨源与速率限制都不可控）。Node half 用 profile 记录下来的 spec 决定问哪里——git 安装问 `api.github.com/.../commits/<ref>`（`listBundles().source` 里的 spec 就是 profile 记的），registry 安装问 `registry.npmjs.org/<name>` 的 `dist-tags.latest`。
- **已安装版本优先取宿主的 `BundleInfo.version`，锁文件与自身清单是回退**：`dsh-plugin-manager` 在 0.2.1-alpha.2 起把已装版本直接放进 `listBundles()` 的结果，比锁文件解析更直接（锁文件损坏/换布局时也还有版本可显示），宿主没给时回退锁文件解析（registry 版本），再回退包清单版本。已安装**提交**仍只认 profile 锁文件——git 安装下包的 `package.json` 版本号不随提交变化，宿主同样不提供提交。
- **更新分两步，且认宿主的判断**：宿主用「`package.json` 里的依赖串变了没有」定位这次装的是哪个包，所以
  原样重装 profile 记的那条 spec 会被判 `ambiguous-install`（本机真实 `dsh web` 宿主实测）。因此先装刚检查到的
  确切提交/版本（依赖串一定变），再把依赖串换回 profile 记录的那条会前进的线（分支/标签/默认分支），更新一次仍然继续跟踪；
  registry 装完记的是版本范围（pnpm 默认存 `^` 前缀），本来就会前进，不必第二步。
- **宿主的 `application` 五种取值如实转述**：`applied`（有 HMR，热发布）/ `restart-required`（覆盖已装包，重启生效）/
  `overridden`（被更高优先级配置覆盖）/ `failed` / `cancelled`。只有成功才提示完成；失败把宿主的错误码与诊断
  带到这一行，按钮留在可重试态——这一条是本机实测撞出来的（第一步版本把 `failed` 当成了成功）。
- **两个动词都挡跨源**：GET 也要出网（GitHub/npm），别的页面同样不该借这台宿主去刷上游配额，所以跨源判据（`sec-fetch-site` / `origin` 对 host）对 GET 与 POST 一视同仁；POST 是靠它挡住 CSRF 的写动作。
- **更新动作走宿主的 profile 包管理服务**（`ctx.get('pluginManager').installBundle`）：它取 profile 写锁、跑 pnpm、失败时回滚 manifest 与锁文件，插件自己不碰 profile 文件。重装用的是 **profile 记的原 spec**——分支/标签装完仍跟踪那条线，版本范围装完仍是范围；把 spec 改写成钉死的提交会让这一行从此永远报告「已是最新」。结果按 `application === 'restart-required'` 提示**重启 DeepSeek Harness 生效**（覆盖已安装的包不会热发布，这是宿主既定的生命周期）。
- **降级路径**：宿主没有该服务、装的是本地路径（无可查询的上游）、或网络失败时，这一行仍显示当前版本，状态文案说明原因，不假装能更新。
- **profile 目录按三级解析**：`ctx.get('profileContext').dir`（宿主服务，插件管理器自己也用它）→ `DSH_PROFILE_DIR` → `<dshHome>/profiles/<DSH_PROFILE>`；三级都拿不到时不猜，按「未知」呈现。锁文件读不到就等于读不到已安装提交，不会挂着一个错误的判断。
- **纯逻辑单独成模块** `lib/src/update.mjs`（spec 归一、锁文件读值、版本比较、三态判断），由 `tests/update.test.mjs` 覆盖；网络与宿主调用留在 `lib/index.mjs`。

## 取代检查

无重叠——本记录只覆盖新增的「版本与更新行」。卡片本体与保存语义归
[simplification/2026-10-04-settings-card-direct-write.md](../simplification/2026-10-04-settings-card-direct-write.md)
与 [simplification/2026-10-04-settings-card-official-controls.md](../simplification/2026-10-04-settings-card-official-controls.md)；
槽位归 [bug-fix/2026-10-04-settings-card-bundle-slot.md](../bug-fix/2026-10-04-settings-card-bundle-slot.md)。

## Alternatives considered

**在客户端直接 `fetch` GitHub/npm。** 省一个端点，但把跨源、CSP 与速率限制交给浏览器上下文，且升级动作仍必须回宿主，等于两条路各写一半。集中到 Node half 后只有一条数据通路。

**自己 spawn pnpm 重装（不经宿主服务）。** 会和宿主的 profile 写锁、manifest 缓存、HMR 队列打架；宿主服务本身就为此存在，并且失败时会回滚文件。

**只显示版本、不做更新动作。** 纯展示最安全，但用户仍要手抄 spec 去卸载重装——这正是要解决的问题。

**原样重装 profile 记的那条 spec（一次 pnpm 就够）。** 语义最直白，但实测被宿主判成 `ambiguous-install`：依赖串没变，宿主认不出这次装的是哪个包，于是回滚。要既能装上、又继续跟踪那条线，只能「先装确切提交、再换回那条线」两步。

**把 spec 钉到刚检查到的提交（`github:owner/repo#<sha>`）。** 装上的是检查时的确切快照，没有「检查到点击之间分支又动了」的窗口；代价是 profile 依赖从此变成钉死的提交，这一行以后永远报告「已是最新」，用户得再手动改回分支才能继续跟踪。跟踪语义更重要，所以放弃钉死。

**卸载后自动重装（`removeBundle` + `installBundle`）。** 卸载会先把组合包取消选入并等插件退出，而动作正是由这个插件自己发起的，自己卸载自己会让「谁来发起安装」没有着落；覆盖安装已经报告 `restart-required`，语义更清楚。

## Consequences

- 用户在配置卡片里就能看到自己装的是哪个提交，并在有新版时一键升级到该确切提交；升级后按提示重启即生效。
- 新增两个 HTTP 端点（`GET`/`POST` `/whale-girl/update`）与一个纯模块；`POST` 沿用 `/interact` 的跨源校验。
- 版本比较是自写的最小 semver 形状比较（数字段 + 预发布段），不引入新依赖。
- 第二步（换回跟踪的那条线）失败时会明确报 `tracking-not-restored`：profile 此时停在第一步钉死的提交上，不是「什么都没发生」。
- 配置只读（卡片显示「当前部署只读，无法修改。」）不影响这一行：那说的是条目配置的写面，而更新走宿主的 profile 包管理服务，宿主的插件页在同一个部署里同样提供安装/卸载。两者权限不同，所以不跟着卡片的 `disabled` 走。
- 更新是两次 pnpm 运行（先确切提交、再换回跟踪的那条线），比单次慢约一倍；两次都失败会明确报错。
- 检查依赖上游 API 的可用性（GitHub 未认证请求有速率限制）：检查失败只影响这一行的文案与按钮，宠物本体与既有配置读写不受影响。
- **宿主版本要求**：检查/更新要读宿主的 `BundleInfo.source`（profile 记录的安装来源）；该字段是上游在 `dsh-plugin-manager` 后来才加的（本机装的 0.2.0-rc.2 还没有）。host-outdated 的判据随 0.2.1-alpha.2 收紧：宿主**既不给 `source` 也不给 `version`**（两个字段都没有才是旧 BundleInfo）才报「宿主版本过旧，无法检查更新（请升级 DSH）」；宿主给了 `version` 而没有 `source`（如安装自带条目没记录来源）说明宿主并不旧，按「查不到上游」（no-source）呈现，不误导用户升级宿主。更早宿主上本行不产生崩溃或误导。
- 本地路径安装点「更新」会把 profile 依赖从 `link:<目录>` 换成 `github:<owner>/<repo>#<默认分支>`：本地改动不再生效，换成了跟上游那条线——这正是「本地安装也跟 main」的含义，所以状态行与按钮都要在点之前写出来（「更新会改成跟 main」/「改跟 main…」）。目录不是 git 检出、或包没声明仓库时，仍旧显示「无法确认上游」。
- 本地检出的 git 布局解析认 worktree：`.git` 是文件时顺着 `gitdir:` 找到真实 git 目录，再按 `commondir` 到公共目录里找分支引用与 packed-refs（worktree 的引用不在自己的目录里）。
- 更新行的按钮由**纯函数**挑处理函数（`action.run` 指向检查或更新），组件只调 `action.run()`；`tests/update-state.test.mjs` 逐状态断言接线，客户端交互按仓库约定另有 `scripts/verify-client-behavior.mjs` 的 `update-row` 场景（点检查 → 点更新 → 断言真的发出 `POST`）。
- 读不到组合包启停状态时不动手：宿主对没传 `enabled` 的安装默认启用，动手会把用户关掉的宠物打开。此时报 `unknown-enabled-state`，一次 pnpm 都不跑。
- 上游 403/429 与「查不到来源」分开：限流走 `rate-limited`，文案说「上游请求受限（GitHub 限流），稍后再试。」；`POST` 复查失败时只报「检查失败」，不报成「更新失败」。
- 宿主侧实现单独成模块 `lib/src/update-host.mjs`：读 profile 来源/锁文件、查上游三态、走包管理服务执行更新，依赖（包管理器、网络、profile 目录、自身清单）全部注入；`lib/index.mjs` 只把 cordis 服务与网络接进去（更新那段从 ~330 行降到 ~140 行），`.git` 布局解析与状态编排由 `tests/update-host.test.mjs` 用真实临时目录与假依赖覆盖（worktree、packed-refs、游离 HEAD、限流、第二步失败等）。路由层测试只留 HTTP 层与端到端接线。
- 失败文案用 `--dsw-alias-state-error-primary`（`--dsw-alias-label-error` 在主题里并不存在）；行本身用 `role="group"` + `aria-labelledby`/`aria-describedby` 把标签与状态关联起来。
