# Decision: 全量俄语本地化（zh/en/ru 三语，ru 为新增）

Status: implemented

## Problem

whale-girl 的用户可见文本一直是中文（en 只有设置卡有译文）：宠物 aria 标签、菜单按钮、状态卡（任务/失败/称号/离线）、互动回话、记忆日志、称号名都是硬编码中文字面量；Node half 的 `/state`、`/interact` 不知道界面语言，回话与记忆只能写中文。EntranceLord fork 的俄语用户在 ru locale 下看到的是中文界面。要求：活跃 locale 为 ru 时全部用户可见文本为俄语；zh/en 不回归；已存档数据（旧记忆、旧 `state.json`）不被破坏。

## Decision

三语文案集中到零依赖 `lib/src/i18n.mjs`（`LOCALES`、`normalizeLocale`、`t(locale, key, vars)` 复数选形、`TITLE_NAMES`、`REPLIES`、记忆/统计文案），Node half 与 client bundle 共用：

- **client UI 文案走宿主 locale 服务**：新 namespace `whale-girl.pet`（`lib/client/pet-i18n.mjs`），`ctx.locale.register/bind/subscribe`；locale 变化时重绘 aria、菜单按钮、状态卡。设置卡的 `settings.whale-girl` 增加 ru（46 键），字典移入纯数据 `settings-text.mjs` 以便 Node 门禁读取；两个 dict 都按 locale 注册给宿主。
- **数据面**：客户端在 `/state?locale=` 与 `/interact` body 上报 locale；Node half 用 `normalizeLocale` 白名单归一（zh/en/ru，其他回 zh），`/state` 附带 `pet.titleNames`（`titles` 仍是 id 数组，第三方消费者不变），`/interact` 按 locale 选回话池——仅当配置仍是 zh 默认池（按值相等）时替换为对应语言内置池，用户自定义文案原样尊重。
- **记忆日志**：写入时按最近上报的 locale 渲染（`state.locale` 随账本持久化，页面关闭期间发生的事件也有语言可用）；已写入的记录是历史快照，不回溯重写。
- **称号**：`titleName(id, locale)` 是显示读面；`TITLES[].name` 保留 zh 兼容面。
- **manifest**：角色名增加 `names: { zh, en, ru }`（`name` 保留为默认/兼容值）。
- **门禁与文档**：新增 `verify-i18n`（三语键集合一致、ru/en 无 CJK/中文标点、占位符对齐、无空值）与自证测试；`README.ru.md`、`package.json` description/files 更新。

## Alternatives considered

- **只翻设置卡**（需求原文的最小面）：宠物本体、状态卡、回话、记忆仍是中文，验收「ru 无 CJK」不成立。
- **客户端与服务器各维护一份字典**：两半必然漂移；回话/称号/记忆共用键集合，必须同源，故集中到 `src/i18n.mjs`。
- **记忆日志改存 `{key, vars}` 结构、再按当前语言渲染**：可让旧记录也随语言变化，但要迁移 on-disk 格式并扩 `/state` wire；需求明确接受「旧记忆保留旧语言」，低成本方案足够。
- **用 `navigator.language` 猜语言**：与用户在 DSH 里选的 locale 不一致（界面语言是宿主状态，不是浏览器状态），也无法热切换。
- **在 `/state` 请求时按 locale 重新渲染旧记忆**：旧 zh 快照仍会混语言，且与「历史事件是快照」的账本语义冲突。

## Consequences

- ru 界面全俄语；en 得到英文（此前卡片外是中文——本次顺带修正，zh 不回归）；zh 保持原文。
- 旧 `state.json`/`sessions.json` 中已有记忆保持写入时的语言（需求接受）；首次 `/state` 之后新记录按新语言。
- `state.locale` 是新增字段，仅语言变化时落盘（不随 3s 轮询写放大）。
- 任何新增 UI 字符串必须三语齐全，否则 `verify-i18n` 失败；带数字的复数文案必须放 `src/i18n.mjs`（宿主 `bind` 不做复数）。
- 不在本次范围：`desktop/render` 子包（独立发行物，主 bundle 的 `files` 不含它）、PNG 素材。
- 取代检查：无重叠——现有记录只覆盖设置卡 locale 命名空间与 client 注入面，不覆盖宠物 UI/服务端文案/记忆语言；本记录不取代它们。
