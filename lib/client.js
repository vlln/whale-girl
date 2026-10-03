window.__ModuleLoader__.load({
	id: "whale-girl",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/client/index.mjs
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// lib/src/snapshot.mjs
var TURN_COMPLETED_MS = 4e3;

// lib/client/logic.mjs
var TRANSIENT_MS = 1500;
var WAKE_MS = 3e3;
var JOY_MS = 1600;
var STATE_NAMES = Object.freeze([
  "idle",
  "working",
  "celebrate",
  "error",
  "disappointed",
  "joy",
  "eat",
  "play",
  "drag",
  "walk",
  "sleep",
  "wake",
  "welcome",
  "think",
  "wait"
]);
var PLAYBACK_MODES = Object.freeze(["loop", "pingpong", "once", "blink"]);
var PLAYBACK_MIN_FRAMES = Object.freeze({
  loop: 1,
  pingpong: 2,
  once: 1,
  blink: 2
});
var STATE_TABLE = [
  { state: "drag", when: (c) => c.dragging },
  // 拖拽放下缓冲：drag 结束短暂回 idle（1.5s），再进入底层状态——避免放下即跳 think/working 的生硬切换。
  // 睡着被拖起时让位 wake：wake 是「被拖起来」的醒觉过渡，直接播（不先 idle 缓冲）；
  // wake 行仍低于 burst/eat/play（事件反馈优先，见 wake 行注释）。
  { state: "idle", when: (c) => c.dragReleaseUntil > c.now && c.transient !== "wake" },
  // 事件 burst（welcome/celebrate/error/disappointed）：Node half 窗口级联输出，until 有效期内优先。
  { state: "burst", when: (c) => c.activity.name !== "idle" && c.activity.name !== "working" && c.activity.until > c.now, resolve: (c) => c.activity.name },
  { state: "eat", when: (c) => c.transient === "eat" },
  { state: "play", when: (c) => c.transient === "play" },
  { state: "wake", when: (c) => c.transient === "wake" },
  { state: "wait", when: (c) => c.sessionWait },
  // 回合完成庆祝（client 本地窗口）：session running→completed 翻转后庆祝——
  // 低于 Node 事件 burst（任务完成的 celebrate 仍走 burst 行）、用户互动与等待批准
  // （wait 需要用户注意），高于陪伴——庆祝是短时插曲，不打断互动反馈。
  { state: "celebrate", when: (c) => c.celebrateUntil > c.now },
  // working 是随机工作插曲：client 节奏器在思考陪伴期间偶尔插入（workingActive），
  // 不是任务状态指示灯——think 是常态，working 是「认真干活」的短时小动作。
  { state: "working", when: (c) => c.workingActive },
  { state: "think", when: (c) => c.sessionThink },
  { state: "joy", when: (c) => c.now < c.joyUntil },
  { state: "sleep", when: (c) => c.sleeping },
  { state: "walk", when: (c) => c.walking },
  { state: "idle", when: () => true }
];
function pickState(input) {
  const ctx = {
    ...input,
    now: input.now ?? Date.now(),
    joyUntil: input.joyUntil ?? 0,
    sessionThink: input.sessionThink ?? false,
    sessionWait: input.sessionWait ?? false,
    dragReleaseUntil: input.dragReleaseUntil ?? 0,
    workingActive: input.workingActive ?? false,
    celebrateUntil: input.celebrateUntil ?? 0
  };
  for (const row of STATE_TABLE) {
    if (row.when(ctx)) return row.resolve ? row.resolve(ctx) : row.state;
  }
  return "idle";
}
var WORKING_MIN_WAIT_MS = 12e3;
var WORKING_MAX_WAIT_MS = 3e4;
var WORKING_MIN_DUR_MS = 2500;
var WORKING_MAX_DUR_MS = 6e3;
var BLINK_MIN_INTERVAL_MS = 3e3;
var BLINK_MAX_INTERVAL_MS = 9e3;
var FACING_MIN_INTERVAL_MS = 1e4;
var FACING_MAX_INTERVAL_MS = 25e3;
function nextBlinkAt({ now, random = Math.random }) {
  const wait = BLINK_MIN_INTERVAL_MS + random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS);
  return now + wait;
}
function nextFacingAt({ now, random = Math.random }) {
  const wait = FACING_MIN_INTERVAL_MS + random() * (FACING_MAX_INTERVAL_MS - FACING_MIN_INTERVAL_MS);
  return now + wait;
}
function nextWorkingRhythm({ now, sessionThink, working, random = Math.random }) {
  if (!sessionThink) return { active: false, until: 0 };
  if (working.active) {
    const dur = WORKING_MIN_DUR_MS + random() * (WORKING_MAX_DUR_MS - WORKING_MIN_DUR_MS);
    return { active: false, until: now + dur };
  }
  const wait = WORKING_MIN_WAIT_MS + random() * (WORKING_MAX_WAIT_MS - WORKING_MIN_WAIT_MS);
  return { active: true, until: now + wait };
}
function shouldWake(prevState, nextState, ctx = {}) {
  return prevState === "sleep" && nextState !== "sleep" && !ctx.dragging && (ctx.transient ?? null) === null;
}
function wakeFromInteraction({ visuallySleeping }) {
  return { sleeping: false, wake: visuallySleeping === true };
}

// lib/client/character.mjs
var DEFAULT_ROLE_ID = "whale-girl";
function parseCharacters(manifest) {
  const raw = manifest?.characters;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const characters = {};
    for (const [id, ch] of Object.entries(raw)) {
      if (ch === null || typeof ch !== "object") continue;
      characters[id] = {
        id,
        name: typeof ch.name === "string" ? ch.name : id,
        credit: typeof ch.credit === "string" ? ch.credit : void 0,
        meta: ch.meta !== null && typeof ch.meta === "object" ? ch.meta : {},
        states: ch.states !== null && typeof ch.states === "object" ? ch.states : {}
      };
    }
    const defaultId = typeof manifest.default === "string" && manifest.default in characters ? manifest.default : Object.keys(characters)[0] ?? DEFAULT_ROLE_ID;
    return { characters, defaultId };
  }
  return {
    characters: {
      [DEFAULT_ROLE_ID]: {
        id: DEFAULT_ROLE_ID,
        name: DEFAULT_ROLE_ID,
        credit: void 0,
        meta: {},
        states: manifest?.states !== null && typeof manifest?.states === "object" ? manifest.states : {}
      }
    },
    defaultId: DEFAULT_ROLE_ID
  };
}
function listCharacters(manifest) {
  return Object.keys(parseCharacters(manifest).characters);
}
function getCharacter(manifest, id) {
  return parseCharacters(manifest).characters[id] ?? null;
}
function stateOf(character, stateName) {
  return character?.states?.[stateName];
}

// lib/src/routes.mjs
var ROUTE_PREFIX = "/whale-girl";
var STATE_PATH = `${ROUTE_PREFIX}/state`;
var INTERACT_PATH = `${ROUTE_PREFIX}/interact`;
var CONFIG_PATH = `${ROUTE_PREFIX}/config`;
var ASSETS_PATH = `${ROUTE_PREFIX}/assets`;
var EVENTS_PATH = `${ROUTE_PREFIX}/events`;
var PRESENCE_PATH = `${ROUTE_PREFIX}/presence`;
var SESSIONS_PATH = `${ROUTE_PREFIX}/sessions`;

// lib/client/settings-card.mjs
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// lib/client/settings-fields.mjs
var CARD_FIELDS = [
  { path: "enabled", labelKey: "enabled", kind: "toggle" },
  { path: "size", labelKey: "size", kind: "number", min: 64, max: 160, step: 1 },
  { path: "opacity", labelKey: "opacity", kind: "number", min: 0.2, max: 1, step: 0.05 },
  { path: "walk.enabled", labelKey: "walk", kind: "toggle", group: "walk" },
  { path: "sleepAfterMs", labelKey: "sleep", kind: "number", min: 5e3, max: 6e5, step: 1e3 },
  { path: "replies.feed", labelKey: "feed", kind: "lines", group: "replies" },
  { path: "replies.play", labelKey: "play", kind: "lines", group: "replies" }
];
function leafOf(value, path) {
  let cur = value;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function groupWrite(committed, path, value) {
  const group = path.slice(0, path.indexOf("."));
  const leaf = path.slice(path.indexOf(".") + 1);
  const base = (() => {
    const cur = committed === null || typeof committed !== "object" ? void 0 : committed[group];
    return cur !== null && typeof cur === "object" && !Array.isArray(cur) ? { ...cur } : {};
  })();
  return { key: group, value: { ...base, [leaf]: value } };
}
function parseLines(text) {
  return String(text ?? "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
function serializeLines(lines) {
  return (Array.isArray(lines) ? lines : []).join("\n");
}
function deriveState(snap, defaults) {
  const committed = snap.value ?? {};
  const fields = {};
  for (const def of CARD_FIELDS) {
    const fromCommitted = leafOf(committed, def.path);
    fields[def.path] = fromCommitted !== void 0 ? fromCommitted : leafOf(defaults, def.path);
  }
  return {
    available: snap.status !== "unavailable",
    writable: snap.writable === true,
    fields
  };
}
function writeField(scope, path, value) {
  const def = CARD_FIELDS.find((candidate) => candidate.path === path);
  if (def !== void 0 && def.group !== void 0) {
    const { key, value: next } = groupWrite(scope.getSnapshot().value ?? {}, path, value);
    return scope.set(key, next);
  }
  return scope.set(path, value);
}

// lib/client/settings-card.mjs
var SETTINGS_NS = "settings.whale-girl";
var zh = {
  title: "\u9CB8\u9C7C\u5A18",
  description: "\u5C3A\u5BF8\u3001\u900F\u660E\u5EA6\u3001\u6E38\u8D70\u4E0E\u56DE\u8BDD\u6587\u6848\uFF08\u6539\u52A8\u5373\u65F6\u751F\u6548\uFF09",
  writeFailed: "\u521A\u624D\u7684\u6539\u52A8\u672A\u88AB\u63A5\u53D7\uFF0C\u5DF2\u56DE\u8BFB\u5F53\u524D\u503C\u3002",
  readOnly: "\u5F53\u524D\u90E8\u7F72\u53EA\u8BFB\uFF0C\u65E0\u6CD5\u4FEE\u6539\u3002",
  enabled: "\u7F51\u9875\u7AEF\u663E\u793A",
  "enabled.hint": "\u5173\u95ED\u540E\u7F51\u9875\u7AEF\u5BA0\u7269\u4E0D\u6E32\u67D3\uFF08\u684C\u9762\u4F34\u4FA3\u5E76\u5B58\u65F6\u7528\uFF09\u3002",
  size: "\u5C3A\u5BF8",
  "size.hint": "\u5BA0\u7269\u7ED8\u5236\u5C3A\u5BF8\uFF0864\u2013160 px\uFF09\u3002",
  opacity: "\u900F\u660E\u5EA6",
  "opacity.hint": "\u5E38\u6001\u900F\u660E\u5EA6\uFF080.2\u20131\uFF09\u3002",
  walk: "\u6E38\u8D70",
  "walk.hint": "\u5173\u95ED\u540E\u5BA0\u7269\u4E0D\u518D\u56DB\u5904\u6E38\u8D70\u3002",
  sleep: "\u7761\u7720\u7B49\u5F85",
  "sleep.hint": "\u7A7A\u95F2\u591A\u4E45\u8FDB\u5165\u7761\u7720\uFF08\u6BEB\u79D2\uFF09\u3002",
  feed: "\u6295\u5582\u56DE\u8BDD",
  "feed.hint": "\u6BCF\u884C\u4E00\u6761\uFF0C\u7A7A\u884C\u5FFD\u7565\uFF1B\u6E05\u7A7A\u56DE\u9000\u5185\u7F6E\u6587\u6848\u3002",
  play: "\u73A9\u800D\u56DE\u8BDD",
  "play.hint": "\u6BCF\u884C\u4E00\u6761\uFF0C\u7A7A\u884C\u5FFD\u7565\uFF1B\u6E05\u7A7A\u56DE\u9000\u5185\u7F6E\u6587\u6848\u3002"
};
var en = {
  title: "Whale Girl",
  description: "Size, opacity, wandering and reply copy \u2014 applied live",
  writeFailed: "The deployment did not accept that change; the current value was read back.",
  readOnly: "This deployment is read-only.",
  enabled: "Show on page",
  "enabled.hint": "Off hides the in-page pet (e.g. while a desktop companion runs).",
  size: "Size",
  "size.hint": "Pet render size (64\u2013160 px).",
  opacity: "Opacity",
  "opacity.hint": "Default opacity (0.2\u20131).",
  walk: "Wander",
  "walk.hint": "Off stops the pet wandering.",
  sleep: "Sleep delay",
  "sleep.hint": "Idle time before sleeping (ms).",
  feed: "Feed replies",
  "feed.hint": "One per line, empty lines ignored; empty falls back to built-in copy.",
  play: "Play replies",
  "play.hint": "One per line, empty lines ignored; empty falls back to built-in copy."
};
var el = import_react.default.createElement;
function NumberField({ value, min, max, step, disabled, label, onChange }) {
  const initial = value === void 0 || value === null ? "" : String(value);
  const [text, setText] = import_react.default.useState(initial);
  const [lastKey, setLastKey] = import_react.default.useState(initial);
  if (initial !== lastKey) {
    setLastKey(initial);
    setText(initial);
  }
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setText(initial);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
    if (clamped !== parsed) setText(String(clamped));
  };
  return el(import_dsh_client_ui_primitives.Input, {
    type: "text",
    inputMode: "numeric",
    value: text,
    disabled,
    "aria-label": label,
    onChange: (e) => {
      setText(e.target.value);
    },
    onBlur: commit,
    onKeyDown: (e) => {
      if (e.key === "Enter") e.currentTarget.blur();
    },
    style: { width: 88, textAlign: "right" }
  });
}
function LinesField({ value, disabled, label, onChange }) {
  const initial = serializeLines(value);
  const [text, setText] = import_react.default.useState(initial);
  const [lastKey, setLastKey] = import_react.default.useState(initial);
  if (initial !== lastKey) {
    setLastKey(initial);
    setText(initial);
  }
  return el("textarea", {
    rows: 3,
    value: text,
    disabled,
    "aria-label": label,
    onChange: (e) => {
      setText(e.target.value);
    },
    onBlur: () => {
      onChange(parseLines(text));
    },
    style: {
      flex: "none",
      width: 240,
      padding: "6px 8px",
      resize: "vertical",
      border: "0.5px solid var(--dsw-alias-border-l4)",
      borderRadius: "var(--dsw-radius-md)",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit",
      fontSize: 14,
      lineHeight: 1.5,
      boxSizing: "border-box",
      opacity: disabled ? 0.4 : 1
    }
  });
}
function WhaleSettingsCard(props) {
  const state = props.useWhaleSettings((s) => s);
  const [failed, setFailed] = import_react.default.useState(false);
  if (!state.available) return null;
  const disabled = !state.writable;
  const t = props.t;
  const commit = (def, value) => {
    setFailed(false);
    Promise.resolve(props.write(def.path, value)).catch(() => {
      setFailed(true);
    });
  };
  const row = (def, index) => {
    const control = def.kind === "toggle" ? el(import_dsh_client_ui_primitives.Switch, { checked: state.fields[def.path] === true, disabled, label: t(def.labelKey), onChange: (checked) => {
      commit(def, checked);
    } }) : def.kind === "number" ? el(NumberField, { value: state.fields[def.path], min: def.min, max: def.max, step: def.step, disabled, label: t(def.labelKey), onChange: (value) => {
      commit(def, value);
    } }) : el(LinesField, { value: state.fields[def.path], disabled, label: t(def.labelKey), onChange: (lines) => {
      commit(def, lines);
    } });
    return el("div", {
      key: def.path,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
        borderBottom: index < CARD_FIELDS.length - 1 ? "0.5px solid var(--dsw-alias-border-l2)" : "none"
      }
    }, el(
      "div",
      { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } },
      el("span", { style: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: "var(--dsw-alias-label-primary)" } }, t(def.labelKey)),
      el("span", { style: { fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)", whiteSpace: "pre-line" } }, t(`${def.labelKey}.hint`))
    ), control);
  };
  return el(
    "li",
    {
      "data-whale-girl-settings-card": "",
      style: {
        listStyle: "none",
        border: "1px solid var(--dsw-alias-settings-card-stroke)",
        borderRadius: "var(--dsw-radius-lg)",
        background: "var(--dsw-alias-settings-card-fill)",
        boxSizing: "border-box"
      }
    },
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 4, padding: "14px 16px 0" } },
      el("span", { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: "var(--dsw-alias-label-primary)" } }, t("title")),
      el("span", { style: { fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" } }, t("description"))
    ),
    el(
      "div",
      { style: { borderTop: "0.5px solid var(--dsw-alias-border-l2)", margin: "12px 16px 12px" } },
      disabled ? el("p", { role: "status", style: { margin: "12px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" } }, t("readOnly")) : null,
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", padding: "12px 0 0", gap: 0 } },
        CARD_FIELDS.map((def, index) => row(def, index))
      ),
      failed ? el("p", { role: "status", style: { margin: "12px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-error)" } }, t("writeFailed")) : null
    )
  );
}
function registerWhaleSettingsCard(ctx, namespace, defaults) {
  const scope = ctx.configForms.get(namespace);
  const offLocale = ctx.locale.register(SETTINGS_NS, { zh, en });
  let cache;
  const getSnapshot = () => {
    const snap = scope.getSnapshot();
    if (cache !== void 0 && cache.snap === snap) return cache.state;
    cache = { snap, state: deriveState(snap, defaults) };
    return cache.state;
  };
  const offSlot = ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
    name: "settings.plugins.tab",
    id: namespace,
    order: 30,
    label: () => ctx.locale.bind(SETTINGS_NS)("title"),
    locale: SETTINGS_NS,
    inject: () => ({
      hooks: { whaleSettings: { getSnapshot, subscribe: (listener) => scope.subscribe(listener) } },
      write: (path, value) => writeField(scope, path, value)
    })
  }, WhaleSettingsCard));
  return () => {
    offSlot();
    offLocale();
  };
}

// lib/client/overlay-placement.mjs
function planOverlay({ rect, viewport, size, above, offsetY, margin = 8 }) {
  const roomAbove = rect.top - margin;
  const roomBelow = viewport.h - rect.bottom - margin;
  let up = above;
  if (above && roomAbove < size.h && roomBelow > roomAbove) up = false;
  else if (!above && roomBelow < size.h && roomAbove > roomBelow) up = true;
  const centerX = rect.left + rect.width / 2;
  let dx = 0;
  if (size.w >= viewport.w - margin * 2) dx = viewport.w / 2 - centerX;
  else if (centerX - size.w / 2 < margin) dx = margin - centerX + size.w / 2;
  else if (centerX + size.w / 2 > viewport.w - margin) dx = viewport.w - margin - centerX - size.w / 2;
  const shift = Math.round(dx);
  return {
    up,
    top: up ? `-${offsetY}px` : `calc(100% + ${offsetY}px)`,
    transform: up ? "translate(-50%, -100%)" : "translateX(-50%)",
    left: shift === 0 ? "50%" : `calc(50% ${shift > 0 ? "+" : "-"} ${Math.abs(shift)}px)`
  };
}

// lib/client/index.mjs
var ASSETS_URL = ASSETS_PATH;
var MANIFEST_URL = `${ASSETS_URL}/manifest.json`;
var CFG_DEFAULTS = {
  enabled: true,
  size: 110,
  opacity: 1,
  walk: { enabled: true, minWaitMs: 18e3, maxWaitMs: 4e4, minMs: 3e3, maxMs: 6e3, speedPxPerSec: 45 },
  sleepAfterMs: 6e4,
  pollMs: 3e3,
  bubbleMs: 2500
};
var SETTINGS_NAMESPACE = "whale-girl";
var cfg = { ...CFG_DEFAULTS };
var TICK_MS = 200;
var DRAG_RELEASE_MS = 1500;
var CSS = `
[data-whale-girl] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  font-family: system-ui, sans-serif; user-select: none; touch-action: none;
  opacity: var(--pet-opacity, 1); }
[data-whale-girl] .pet-stage { position: relative; width: var(--pet-size, 110px); height: var(--pet-size, 110px); display: grid; place-items: center;
  font-size: calc(var(--pet-size, 110px) * 0.4); line-height: 1; text-align: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25));
  pointer-events: none; /* \u89C6\u89C9\u5C42\u4E0D\u62E6\u4E8B\u4EF6\u2014\u2014\u4EA4\u4E92\u7EDF\u4E00\u7531 hitarea\uFF08\u8D34\u5408\u5185\u5BB9 bbox\uFF09\u627F\u8F7D\uFF0C\u56DB\u5468\u900F\u660E\u4E0D\u53EF\u70B9 */
[data-whale-girl] .pet-effects { position: absolute; left: 0; top: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  pointer-events: none; overflow: visible; z-index: 2; }
[data-whale-girl] .pet-hitarea { position: absolute; inset: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  cursor: grab; touch-action: none; z-index: 3; border-radius: 8px; }
[data-whale-girl] .pet-sprite { pointer-events: none; /* \u89C6\u89C9\u5C42\uFF1A\u5B9A\u4F4D/\u5C3A\u5BF8/transform \u7531 JS \u5185\u8054\uFF08\u5BBF\u4E3B\u53EF\u80FD\u8986\u76D6 CSS \u6CE8\u5165\uFF09 */ }
[data-whale-girl] .pet-sprite.ready { display: block; }
/* \u72B6\u6001\u5361\uFF1A\u9ED8\u8BA4\u7F6E\u4E8E\u5BA0\u7269\u4E0B\u65B9\uFF0C\u95F4\u8DDD\u8DB3\u591F\uFF08\u89D2\u8272 bob \u6D6E\u52A8 \xB14px \u4E0D\u89E6\u5230\uFF09+ \u8D34\u5E95\u65F6\u7FFB\u4E0A\u65B9\u3002 */
[data-whale-girl] .pet-status { position: absolute; left: 50%; top: calc(100% + 18px); transform: translateX(-50%);
  width: max-content; min-width: 96px; max-width: calc(100vw - 24px); padding: 5px 8px;
  background: rgba(27,30,40,.94); backdrop-filter: blur(10px) saturate(1.15);
  border: 1px solid rgba(255,255,255,.10); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.38), 0 3px 8px rgba(0,0,0,.28);
  color: #E8EBF2; font-size: 11px; display: grid; gap: 4px; z-index: 1;
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity .15s ease-out, transform .15s ease-out, visibility 0s linear .2s; }
[data-whale-girl] .pet-status::after { /* \u8FDE\u63A5\u5C3E\uFF1A\u547D\u4E2D\u533A\u8986\u76D6\u5BA0\u7269\u2194\u5361\u7247\u95F4\u9699\uFF0Chover \u8FDE\u7EED\u4E0D\u95EA\u65AD */
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
[data-whale-girl] .pet-status::after { /* \u8FDE\u63A5\u5C3E\uFF1A\u547D\u4E2D\u533A\u8986\u76D6\u5BA0\u7269\u2194\u5361\u7247\u95F4\u9699\uFF0Chover \u8FDE\u7EED\u4E0D\u95EA\u65AD\uFF08main \u5B9A\u4F4D\u7531 JS \u5185\u8054\uFF09 */
  content: ''; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px;
  transform: translateX(-50%) rotate(45deg); background: rgba(24,28,38,.94);
  border-top: 1px solid rgba(255,255,255,.10); border-left: 1px solid rgba(255,255,255,.10);
  border-top-left-radius: 3px; pointer-events: auto; }
[data-whale-girl] .pet-status.pet-status-above::after { top: auto; bottom: auto; top: -5px; } /* \u8D34\u5E95\u7FFB\u8F6C\uFF1A\u5361\u5728\u4E0A\u65B9\uFF0C\u8FDE\u63A5\u5C3E\u671D\u4E0B\u6307\u5411\u89D2\u8272 */
[data-whale-girl] .pet-menu { display: none; position: absolute; left: 50%; top: -12px; transform: translate(-50%, -100%);
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
/* \u72B6\u6001\u8FD0\u52A8\u914D\u65B9\uFF08manifest.motion \u2192 \u821E\u53F0 CSS \u7C7B\uFF1Bframes>1 \u8D70\u5E27\u64AD\u653E\u5668\uFF0Cframes=1 \u8D70\u6B64\u52A8\u753B\uFF09\u3002
   \u52A8\u753B\u4F5C\u7528\u4E8E\u821E\u53F0\uFF08\u65E0\u5185\u8054 transform\uFF09\uFF0C\u4E0E sprite \u7684\u5185\u8054 scale \u4E0D\u51B2\u7A81\u3002
   \u5E45\u5EA6\u514B\u5236\uFF08\xB12~6px/deg\uFF09+ \u4E2D\u95F4\u5173\u952E\u5E27\uFF080\u21921/4\u21921/2\u21923/4\u21921\uFF09\uFF1A\u65E0\u7A81\u53D8\u7684\u5F80\u590D\u3002 */
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
`;
function apply(ctx = {}) {
  if (document.querySelector("[data-whale-girl]") !== null) {
    console.warn("[whale-girl] apply \u5DF2\u5B58\u5728\u5B9E\u4F8B\uFF0C\u8DF3\u8FC7\u91CD\u590D\u6302\u8F7D");
    return () => {
    };
  }
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  let offSettings = null;
  try {
    if (typeof ctx.get === "function") {
      offSettings = registerWhaleSettingsCard(ctx, SETTINGS_NAMESPACE, CFG_DEFAULTS);
    }
  } catch (error) {
    console.warn("[whale-girl] \u8BBE\u7F6E\u9762\u677F\u5361\u7247\u6CE8\u518C\u5931\u8D25\uFF08\u5BA0\u7269\u7167\u5E38\u8FD0\u884C\uFF09\uFF1A", error);
    offSettings = null;
  }
  const PANEL_THEME = {
    bg: "rgba(24, 28, 38, .94)",
    // 面板背景（状态卡/气泡/菜单统一）
    border: "rgba(255,255,255,.10)",
    // 边框色（solid 变体用）
    text: "#E8EBF2",
    // 主文字
    radius: "10px",
    // 圆角（统一）
    font: "11px",
    // 基础字号（统一）
    shadow: "0 12px 32px rgba(0,0,0,.38), 0 3px 8px rgba(0,0,0,.28)"
    // 浮层阴影
  };
  const createPanel = ({ anchor = "below", variant = "plain", offsetY: offsetY2 = 12, zIndex = "3", display = "block" } = {}) => {
    const el2 = document.createElement("div");
    const pos = anchor === "above" ? `top: -${offsetY2}px; transform: translate(-50%, -100%);` : `top: calc(100% + ${offsetY2}px); transform: translateX(-50%);`;
    const surface = variant === "solid" ? `background: ${PANEL_THEME.bg}; border: 1px solid ${PANEL_THEME.border}; box-shadow: ${PANEL_THEME.shadow};` : `background: ${PANEL_THEME.bg};`;
    el2.style.cssText = [
      "position: absolute; left: 50%;",
      pos,
      "width: max-content;",
      surface,
      `color: ${PANEL_THEME.text}; font-size: ${PANEL_THEME.font};`,
      `border-radius: ${PANEL_THEME.radius}; z-index: ${zIndex};`,
      `display: ${display}; pointer-events: none;`
    ].join(" ");
    return {
      el: el2,
      show() {
        el2.style.display = display;
      },
      hide() {
        el2.style.display = "none";
      }
    };
  };
  const host = document.createElement("div");
  host.setAttribute("data-whale-girl", "");
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "\u684C\u9762\u5BA0\u7269");
  host.setAttribute("aria-expanded", "false");
  host.style.cssText = `position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
    width: var(--pet-size, 110px); height: var(--pet-size, 110px);
    font-family: system-ui, sans-serif; user-select: none; touch-action: none;
    opacity: var(--pet-opacity, 1);`;
  host.style.display = "none";
  document.body.appendChild(host);
  const stage = document.createElement("div");
  stage.className = "pet-stage";
  stage.setAttribute("role", "button");
  stage.setAttribute("tabindex", "0");
  stage.setAttribute("aria-label", "\u4E92\u52A8\u83DC\u5355\uFF1A\u56DE\u8F66\u6216\u7A7A\u683C\u6253\u5F00");
  const sprite = document.createElement("div");
  sprite.className = "pet-sprite";
  stage.appendChild(sprite);
  const status = createPanel({ anchor: "below", variant: "solid", offsetY: 18, zIndex: "1" }).el;
  status.className = "pet-status";
  status.style.backdropFilter = "blur(10px) saturate(1.15)";
  status.style.padding = "5px 8px";
  status.style.minWidth = "96px";
  status.style.maxWidth = "calc(100vw - 24px)";
  status.style.display = "grid";
  status.style.gap = "4px";
  status.style.opacity = "0";
  status.style.visibility = "hidden";
  status.style.pointerEvents = "none";
  status.style.transition = "opacity .15s ease-out, visibility 0s linear .2s";
  status.innerHTML = `
    <div class="pet-meta" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <span class="pet-lv" style="background:rgba(86,134,254,.16); color:#B7C8FE; border-radius:5px; padding:2px 6px; font-size:10px; font-weight:600; line-height:16px; white-space:nowrap;">Lv.1</span>
      <span class="pet-stats" style="color:#E8EBF2; font-size:11px; line-height:16px; font-variant-numeric:tabular-nums; white-space:nowrap;">0 \u4EFB\u52A1</span>
    </div>
    <div class="pet-note" style="color:#E8EBF2; font-size:11px; line-height:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">\u2026</div>`;
  const metaLv = status.querySelector(".pet-lv");
  const metaStats = status.querySelector(".pet-stats");
  const metaNote = status.querySelector(".pet-note");
  metaLv.style.cssText = "background:rgba(86,134,254,.16); color:#B7C8FE; border-radius:5px; padding:2px 6px; font-size:10px; font-weight:600; line-height:16px; white-space:nowrap;";
  metaStats.style.cssText = "color:#E8EBF2; font-size:11px; line-height:16px; font-variant-numeric:tabular-nums; white-space:nowrap;";
  metaNote.style.cssText = "color:#E8EBF2; font-size:11px; line-height:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;";
  const menu = createPanel({ anchor: "above", variant: "plain", offsetY: 12, zIndex: "4", display: "none" }).el;
  menu.className = "pet-menu";
  menu.style.gap = "6px";
  menu.style.padding = "6px";
  menu.style.display = "none";
  menu.style.pointerEvents = "auto";
  const BTN_STYLE = "flex:1; border:0; border-radius:6px; padding:4px 8px; font-size:11px; cursor:pointer; background:rgba(255,255,255,.14); color:#E8EBF2; font-family:system-ui,sans-serif;";
  const feedBtn = document.createElement("button");
  feedBtn.textContent = "\u{1F357} \u5582\u98DF";
  feedBtn.style.cssText = BTN_STYLE;
  const playBtn = document.createElement("button");
  playBtn.textContent = "\u{1F3BE} \u73A9\u800D";
  playBtn.style.cssText = BTN_STYLE;
  const roleBtn = document.createElement("button");
  roleBtn.textContent = "\u{1F3AD} \u66F4\u6362";
  roleBtn.style.cssText = BTN_STYLE;
  menu.append(feedBtn, playBtn, roleBtn);
  const effects = document.createElement("div");
  effects.className = "pet-effects";
  effects.style.cssText = "position: absolute; left: 0; top: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px); pointer-events: none; overflow: visible; z-index: 2;";
  const hitarea = document.createElement("div");
  hitarea.className = "pet-hitarea";
  hitarea.style.cssText = `position: absolute; inset: 0; cursor: grab; touch-action: none; z-index: 3; border-radius: 8px;`;
  effects.appendChild(status);
  host.append(effects, stage, hitarea, menu);
  let statusForcedHidden = false;
  const setStatusVisible = (visible) => {
    status.style.opacity = visible ? "1" : "0";
    status.style.visibility = visible ? "visible" : "hidden";
    status.style.pointerEvents = visible ? "auto" : "none";
    status.style.transition = visible ? "opacity .2s cubic-bezier(.16,1,.3,1)" : "opacity .15s ease-out, visibility 0s linear .2s";
  };
  const placeOverlay = (el2, { above, offsetY: offsetY2 }) => {
    const plan = planOverlay({
      rect: host.getBoundingClientRect(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      size: { w: el2.offsetWidth || 0, h: el2.offsetHeight || 0 },
      above,
      offsetY: offsetY2
    });
    el2.style.top = plan.top;
    el2.style.bottom = "auto";
    el2.style.right = "auto";
    el2.style.transform = plan.transform;
    el2.style.left = plan.left;
    return plan.up;
  };
  const layoutStatus = () => {
    if (activeBubble !== null || dragging || menu.classList.contains("open")) {
      statusForcedHidden = true;
      setStatusVisible(false);
      return;
    }
    statusForcedHidden = false;
    const above = placeOverlay(status, { above: false, offsetY: 18 });
    status.classList.toggle("pet-status-above", above);
  };
  const onHostEnter = () => {
    layoutStatus();
    if (!statusForcedHidden) setStatusVisible(true);
  };
  const onHostLeave = () => {
    if (menu.classList.contains("open")) return;
    setStatusVisible(false);
  };
  host.addEventListener("mouseenter", onHostEnter);
  host.addEventListener("mouseleave", onHostLeave);
  const onBubbleShown = () => {
    if (document.querySelector(":hover") === host) layoutStatus();
  };
  const layoutMenu = () => {
    placeOverlay(menu, { above: true, offsetY: 12 });
  };
  const toggleMenu = (open) => {
    const next = open ?? !menu.classList.contains("open");
    menu.classList.toggle("open", next);
    menu.style.display = next ? "flex" : "none";
    if (next) {
      layoutMenu();
      statusForcedHidden = true;
      setStatusVisible(false);
      releaseInteraction();
    }
    host.setAttribute("aria-expanded", String(next));
    return next;
  };
  let pet = null;
  let activity = { name: "idle", until: 0 };
  let manifest = { states: {} };
  let character = { id: "whale-girl", states: {} };
  let characterId = "whale-girl";
  const syncRoleBtnState = () => {
    const single = listCharacters(manifest).length < 2;
    roleBtn.disabled = single;
    if (single) {
      roleBtn.style.opacity = "0.35";
      roleBtn.style.cursor = "default";
      roleBtn.title = "\u6682\u65E0\u5176\u4ED6\u89D2\u8272";
    } else {
      roleBtn.style.opacity = "";
      roleBtn.style.cursor = "pointer";
      roleBtn.title = "";
    }
  };
  syncRoleBtnState();
  const loaded = /* @__PURE__ */ new Set();
  const sheetSize = /* @__PURE__ */ new Map();
  let dragging = false;
  let pressed = false;
  let moved = false;
  let transient = null;
  let transientUntil = 0;
  let joyUntil = 0;
  let dragReleaseUntil = 0;
  let interactFromSleep = false;
  let showingSprite = false;
  let idleSince = 0;
  let sleeping = false;
  let animState = null;
  let frame = 0;
  let frameDirection = 1;
  let blinkAt = 0;
  let blinkActive = false;
  let facingAt = 0;
  let lastFrameAt = 0;
  let working = { active: false, until: 0 };
  let workingTimer = null;
  let celebrateUntil = 0;
  let walking = false;
  let walkDir = 1;
  let flip = 1;
  let wanderTimer = null;
  let walkRaf = null;
  let sessionMood = { thinking: false, waiting: false, titles: [] };
  const renderStatus = () => {
    if (pet) {
      metaLv.textContent = `Lv.${pet.level}`;
      metaStats.textContent = pet.stats.failures > 0 ? `${pet.stats.tasksDone} \u4EFB\u52A1 \xB7 ${pet.stats.failures} \u5931\u8D25` : `${pet.stats.tasksDone} \u4EFB\u52A1`;
      const last = pet.memory[pet.memory.length - 1];
      metaNote.textContent = last ?? (pet.titles.length > 0 ? `\u79F0\u53F7\u300C${pet.titles.join("\u300D\u300C")}\u300D` : "\u2026");
    }
  };
  const showPlaceholder = (name2) => {
    sprite.classList.remove("ready");
    stage.replaceChildren(sprite);
    console.warn(`[whale-girl] \u72B6\u6001 ${name2} \u7F3A\u5C11\u53EF\u7528 sheet\uFF08manifest \u5E94\u542B\u5168\u90E8 15 \u72B6\u6001\uFF1B\u82E5\u5DF2\u58F0\u660E\u5219\u7D20\u6750\u52A0\u8F7D\u5931\u8D25\uFF09`);
  };
  const sheetKey = (sheet) => `${characterId}:${sheet}`;
  const sheetUrl = (sheet) => `${ASSETS_URL}/characters/${characterId}/${sheet}`;
  const showSprite = (name2, anim) => {
    const key = sheetKey(anim.sheet);
    const size = sheetSize.get(key);
    if (!size || size.w <= 0 || size.h <= 0) {
      showPlaceholder(name2);
      return;
    }
    stage.replaceChildren(sprite);
    const frameW = size.w / anim.frames;
    const target = host.offsetWidth || 110;
    const scale = Math.min(target / frameW, target / size.h, 1);
    sprite.className = "pet-sprite ready";
    sprite.style.cssText = `
      position: absolute; left: 50%; top: 50%; display: block;
      background-image: url("${sheetUrl(anim.sheet)}");
      background-size: ${size.w}px ${size.h}px;
      width: ${frameW}px; height: ${size.h}px;
      transform: translate(-50%, -50%) scale(${scale}) scaleX(${flip});
    `;
    applyFrame(frameW, frame);
  };
  const applyFrame = (frameW, idx) => {
    sprite.style.backgroundPosition = `-${frameW * idx}px 0`;
  };
  const applyFacing = () => {
    if (!showingSprite) return;
    const cfg2 = stateOf(character, animState);
    if (!cfg2 || !loaded.has(sheetKey(cfg2.sheet))) return;
    const size = sheetSize.get(sheetKey(cfg2.sheet));
    if (!size || size.w <= 0 || size.h <= 0) return;
    const frameW = size.w / cfg2.frames;
    const target = host.offsetWidth || 110;
    const scale = Math.min(target / frameW, target / size.h, 1);
    sprite.style.transform = `translate(-50%, -50%) scale(${scale}) scaleX(${flip})`;
    applyHitArea();
  };
  const setState = (name2) => {
    if (name2 === animState) return;
    animState = name2;
    frame = 0;
    frameDirection = 1;
    blinkAt = 0;
    blinkActive = false;
    facingAt = 0;
    lastFrameAt = Date.now();
    applyHitArea();
    for (const cls of [...stage.classList]) if (cls.startsWith("pet-motion-")) stage.classList.remove(cls);
    const cfg2 = stateOf(character, name2);
    const motion = cfg2?.motion;
    if (motion) stage.classList.add(`pet-motion-${motion}`);
    if (cfg2 && loaded.has(sheetKey(cfg2.sheet))) {
      showSprite(name2, cfg2);
      showingSprite = true;
    } else {
      showPlaceholder(name2);
      showingSprite = false;
    }
    stage.style.opacity = "0";
    const restoreOpacity = () => {
      stage.style.opacity = "1";
    };
    requestAnimationFrame(() => requestAnimationFrame(restoreOpacity));
    setTimeout(restoreOpacity, 60);
  };
  let stateBoxes = /* @__PURE__ */ new Map();
  const applyHitArea = () => {
    if (hitarea === null) return;
    const size = parseFloat(getComputedStyle(host).getPropertyValue("--pet-size")) || 110;
    const box = stateBoxes.get(animState) ?? { x: 0, y: 0, w: 1, h: 1 };
    const hitW = Math.max(40, size * box.w);
    const hitH = Math.max(40, size * box.h);
    const flipped = flip < 0;
    const offX = size * (flipped ? 1 - box.x - box.w : box.x);
    const offY = size * box.y;
    hitarea.style.left = `${offX}px`;
    hitarea.style.top = `${offY}px`;
    hitarea.style.width = `${hitW}px`;
    hitarea.style.height = `${hitH}px`;
  };
  const resetContentBox = () => {
    stateBoxes = /* @__PURE__ */ new Map();
  };
  const analyzeSheet = (img, frames) => {
    const canvas = document.createElement("canvas");
    const fw = img.naturalWidth / frames;
    canvas.width = fw;
    canvas.height = img.naturalHeight;
    const ctx2 = canvas.getContext("2d", { willReadFrequently: true });
    ctx2.drawImage(img, 0, 0, fw, img.naturalHeight, 0, 0, fw, img.naturalHeight);
    const data = ctx2.getImageData(0, 0, fw, canvas.height).data;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < fw; x++) {
        if (data[(y * fw + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return {
      x: minX / fw,
      y: minY / canvas.height,
      w: (maxX - minX + 1) / fw,
      h: (maxY - minY + 1) / canvas.height
    };
  };
  const loadImageWithRetry = (src, retries = 3) => new Promise((resolve) => {
    let attempts = 0;
    const attempt = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        attempts += 1;
        if (attempts < retries) setTimeout(attempt, 250 * attempts);
        else resolve(null);
      };
      img.src = src;
    };
    attempt();
  });
  const preload = (name2, cfg2) => loadImageWithRetry(sheetUrl(cfg2.sheet)).then((img) => {
    if (img === null) return;
    sheetSize.set(sheetKey(cfg2.sheet), { w: img.naturalWidth, h: img.naturalHeight });
    loaded.add(sheetKey(cfg2.sheet));
    const box = analyzeSheet(img, cfg2.frames);
    if (box !== null) stateBoxes.set(name2, box);
    applyHitArea();
  });
  const loadAssets = async (attempt = 1) => {
    try {
      const res = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const next = await res.json();
      if (next === null || typeof next !== "object") return;
      manifest = next;
      resetContentBox();
      const pref = (() => {
        try {
          return localStorage.getItem("whale-girl:character") ?? null;
        } catch {
          return null;
        }
      })();
      const roles = parseCharacters(manifest);
      const nextId = pref !== null && pref in roles.characters ? pref : roles.defaultId;
      characterId = nextId;
      character = getCharacter(manifest, nextId) ?? { id: nextId, states: {} };
      syncRoleBtnState();
      const stageSize = character.meta?.stageSize;
      if (typeof stageSize === "number" && !sizeConfigured) {
        host.style.setProperty("--pet-size", `${stageSize}px`);
      }
      const states = Object.entries(character.states);
      const idleEntry = states.find(([n]) => n === "idle");
      if (idleEntry) await preload(idleEntry[0], idleEntry[1]);
      for (const [n, cfg2] of states) if (n !== "idle") preload(n, cfg2);
    } catch {
      if (attempt < 3) setTimeout(() => loadAssets(attempt + 1), 500 * attempt);
    }
  };
  const switchCharacter = async (id) => {
    const target = getCharacter(manifest, id);
    if (target === null || id === characterId) return;
    try {
      resetContentBox();
      const nextLoaded = /* @__PURE__ */ new Set();
      const nextSize = /* @__PURE__ */ new Map();
      await Promise.all(Object.entries(target.states).map(([n, cfg2]) => loadImageWithRetry(`${ASSETS_URL}/characters/${id}/${cfg2.sheet}`).then((img) => {
        if (img === null) return;
        nextSize.set(`${id}:${cfg2.sheet}`, { w: img.naturalWidth, h: img.naturalHeight });
        nextLoaded.add(`${id}:${cfg2.sheet}`);
        const box = analyzeSheet(img, cfg2.frames);
        if (box !== null) stateBoxes.set(n, box);
        applyHitArea();
      })));
      characterId = id;
      character = target;
      loaded.clear();
      sheetSize.clear();
      for (const k of nextLoaded) loaded.add(k);
      for (const [k, v] of nextSize) sheetSize.set(k, v);
      const stageSize = target.meta?.stageSize;
      if (typeof stageSize === "number" && !sizeConfigured) {
        host.style.setProperty("--pet-size", `${stageSize}px`);
      }
      try {
        localStorage.setItem("whale-girl:character", id);
      } catch {
      }
      transient = null;
      transientUntil = 0;
      joyUntil = 0;
      animState = null;
      frame = 0;
      lastFrameAt = Date.now();
    } catch {
    }
  };
  const resetTransient = (now) => {
    const wasFun = transient === "eat" || transient === "play";
    transient = null;
    transientUntil = 0;
    if (wasFun) joyUntil = now + JOY_MS;
  };
  const tick = () => {
    const now = Date.now();
    if (transient !== null && now >= transientUntil) {
      resetTransient(now);
    }
    const target = pickState({ activity, dragging, walking, transient, sleeping, joyUntil, dragReleaseUntil, now, sessionThink: sessionMood.thinking, sessionWait: sessionMood.waiting, workingActive: working.active, celebrateUntil });
    if (shouldWake(animState, target, { dragging, transient })) {
      transient = "wake";
      transientUntil = now + WAKE_MS;
      setState(pickState({ activity, dragging, walking, transient, sleeping, joyUntil, dragReleaseUntil, now, sessionThink: sessionMood.thinking, sessionWait: sessionMood.waiting, workingActive: working.active, celebrateUntil }));
      return;
    }
    setState(target);
    const cfg2 = stateOf(character, animState);
    if (cfg2 && loaded.has(sheetKey(cfg2.sheet))) {
      if (cfg2.playback !== void 0 && !["loop", "pingpong", "once", "blink"].includes(cfg2.playback)) {
        console.warn(`[whale-girl] \u72B6\u6001 ${animState} playback "${cfg2.playback}" \u975E\u6CD5\uFF0C\u6309 loop \u64AD\u653E`);
      }
      const size = sheetSize.get(sheetKey(cfg2.sheet));
      const frameW = size.w / cfg2.frames;
      if (!showingSprite) {
        showSprite(animState, cfg2);
        showingSprite = true;
        frame = 0;
        lastFrameAt = Date.now();
      }
      if (animState === "idle" || animState === "think" || animState === "wait") {
        if (facingAt === 0) facingAt = nextFacingAt({ now });
        if (now >= facingAt) {
          flip = -flip;
          applyFacing();
          facingAt = nextFacingAt({ now });
        }
      } else if (facingAt !== 0) {
        facingAt = 0;
      }
      const holdFor = cfg2.frameMs?.[frame] ?? 1e3 / cfg2.fps;
      if (cfg2.frames > 1 && now - lastFrameAt >= holdFor) {
        if (cfg2.playback === "blink") {
          if (blinkActive) {
            lastFrameAt = now;
            frame += 1;
            if (frame >= cfg2.frames) {
              frame = 0;
              blinkActive = false;
              blinkAt = nextBlinkAt({ now });
            }
            applyFrame(frameW, frame);
          } else {
            if (frame !== 0) {
              frame = 0;
              applyFrame(frameW, frame);
            }
            if (blinkAt === 0) blinkAt = nextBlinkAt({ now });
            if (now >= blinkAt) blinkActive = true;
          }
          return;
        }
        lastFrameAt = now;
        frame += frameDirection;
        if (cfg2.playback === "pingpong" && cfg2.frames > 1) {
          if (frame >= cfg2.frames - 1 || frame <= 0) frameDirection *= -1;
          frame = Math.max(0, Math.min(cfg2.frames - 1, frame));
        } else if (frame >= cfg2.frames) {
          if (cfg2.playback === "loop") frame = 0;
          else {
            frame = cfg2.frames - 1;
            if (transient !== null && transient !== "wake") {
              resetTransient(now);
            }
          }
        }
        applyFrame(frameW, frame);
      }
    }
  };
  const releaseInteraction = () => {
    const decision = wakeFromInteraction({ visuallySleeping: interactFromSleep });
    sleeping = decision.sleeping;
    idleSince = 0;
    if (decision.wake) {
      transient = "wake";
      transientUntil = Date.now() + WAKE_MS;
    }
  };
  const spawnHearts = () => {
    for (let i = 0; i < 4; i++) {
      const heart = document.createElement("div");
      heart.className = "pet-heart";
      heart.textContent = "\u{1F497}";
      heart.style.cssText = `
        position: absolute; font-size: 20px; pointer-events: none; line-height: 1;
        left: ${20 + Math.random() * 110}px; top: ${30 + Math.random() * 80}px;
        z-index: 3; opacity: 1;
      `;
      effects.appendChild(heart);
      if (typeof heart.animate === "function") {
        heart.animate(
          [
            { opacity: 1, transform: "translateY(0) scale(.7)" },
            { opacity: 1, transform: "translateY(-60%) scale(1.25)", offset: 0.7 },
            { opacity: 0, transform: "translateY(-120%) scale(1.4)" }
          ],
          { duration: 1800, easing: "ease-out", fill: "forwards" }
        );
      }
      heart.addEventListener("animationend", () => heart.remove());
      setTimeout(() => heart.remove(), 2e3);
    }
  };
  const bubbleTimers = /* @__PURE__ */ new Set();
  let activeBubble = null;
  const clearBubble = () => {
    if (activeBubble !== null) {
      activeBubble.remove();
      activeBubble = null;
    }
  };
  const showReply = (text) => {
    clearBubble();
    const bubble = createPanel({ anchor: "above", variant: "plain", offsetY: 8, zIndex: "3" }).el;
    bubble.className = "pet-bubble";
    bubble.textContent = text;
    bubble.style.padding = "4px 8px";
    bubble.style.whiteSpace = "nowrap";
    bubble.style.opacity = "0";
    effects.appendChild(bubble);
    const bubbleUp = placeOverlay(bubble, { above: true, offsetY: 8 });
    if (typeof bubble.animate === "function") {
      bubble.animate(
        [
          { opacity: 0, transform: bubbleUp ? "translate(-50%, -85%)" : "translate(-50%, -15%)" },
          { opacity: 1, transform: bubbleUp ? "translate(-50%, -100%)" : "translateX(-50%)" }
        ],
        { duration: 250, easing: "ease-out", fill: "forwards" }
      );
    } else {
      bubble.style.opacity = "1";
    }
    activeBubble = bubble;
    if (typeof onBubbleShown === "function") onBubbleShown();
    const timer = setTimeout(() => {
      bubbleTimers.delete(timer);
      if (activeBubble === bubble) activeBubble = null;
      bubble.remove();
      if (typeof onBubbleShown === "function") onBubbleShown();
    }, cfg.bubbleMs);
    bubbleTimers.add(timer);
  };
  const interact = async (action) => {
    stopWalk();
    releaseInteraction();
    transient = action === "feed" ? "eat" : "play";
    transientUntil = Date.now() + TRANSIENT_MS;
    try {
      const res = await fetch(INTERACT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (body?.reply) showReply(body.reply);
      spawnHearts();
    } catch {
    }
    await refresh();
  };
  let refreshing = false;
  let failStreak = 0;
  let lastConfigRevision = 0;
  let sizeConfigured = false;
  let pollTimer = null;
  const fetchConfig = async () => {
    try {
      const res = await fetch(CONFIG_PATH);
      if (!res.ok) return null;
      const body = await res.json();
      return body !== null && typeof body === "object" ? body.config : null;
    } catch {
      return null;
    }
  };
  const applyClientConfig = (config) => {
    if (config === null || typeof config !== "object") return;
    if (config.enabled === false) {
      dispose();
      return;
    }
    const prevPollMs = cfg.pollMs;
    cfg = { ...CFG_DEFAULTS, ...config };
    if (typeof config.size === "number") {
      sizeConfigured = true;
      host.style.setProperty("--pet-size", `${config.size}px`);
      if (host.style.left) {
        const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth));
        const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight));
        host.style.left = `${x}px`;
        host.style.top = `${y}px`;
      }
    }
    if (typeof config.opacity === "number") host.style.setProperty("--pet-opacity", String(config.opacity));
    if (typeof config.pollMs === "number" && config.pollMs !== prevPollMs && document.visibilityState === "visible") {
      clearInterval(pollTimer);
      pollTimer = setInterval(refresh, cfg.pollMs);
    }
    scheduleWander();
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const res = await fetch(STATE_PATH);
      if (!res.ok) throw new Error(`state ${res.status}`);
      const body = await res.json();
      if (body !== null && typeof body === "object" && body.pet !== null && typeof body.pet === "object") {
        pet = body.pet;
      }
      const act = body?.activity;
      if (act !== null && typeof act === "object" && typeof act.name === "string") {
        activity = act;
      }
      if (act !== null && typeof act === "object") {
        sessionMood = {
          thinking: act.sessionThink === true,
          waiting: act.sessionWait === true,
          titles: []
        };
        if (Number.isFinite(act.turnCompletedUntil) && act.turnCompletedUntil > Date.now()) {
          celebrateUntil = Math.max(celebrateUntil, act.turnCompletedUntil);
        } else if (act.turnCompleted === true) {
          celebrateUntil = Math.max(celebrateUntil, Date.now() + TURN_COMPLETED_MS);
        }
        armWorking();
      }
      const isActive = activity.name !== "idle" || activity.until > Date.now();
      if (isActive) {
        idleSince = 0;
      } else if (idleSince === 0) {
        idleSince = Date.now();
      }
      sleeping = activity.name === "idle" && idleSince !== 0 && Date.now() - idleSince > cfg.sleepAfterMs;
      if (typeof body?.configRevision === "number" && body.configRevision !== lastConfigRevision) {
        lastConfigRevision = body.configRevision;
        const config = await fetchConfig();
        if (config !== null) applyClientConfig(config);
      }
      const nextCompanion = body?.companionOnline === true;
      if (nextCompanion !== companionOnline) {
        companionOnline = nextCompanion;
        syncInert();
      }
      failStreak = 0;
      renderStatus();
    } catch {
      failStreak += 1;
      if (failStreak >= 3) metaNote.textContent = "\u{1F4E1} \u79BB\u7EBF\u2026";
    } finally {
      refreshing = false;
    }
  };
  let startX = 0;
  let startY = 0;
  let lastPointerX = 0;
  let offsetX = 0;
  let offsetY = 0;
  const POS_KEY = "whale-girl:pos";
  const savePos = () => {
    try {
      if (host.style.left && host.style.top) {
        localStorage.setItem(POS_KEY, JSON.stringify({ x: parseFloat(host.style.left), y: parseFloat(host.style.top) }));
      }
    } catch {
    }
  };
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      const x = Math.max(0, Math.min(raw.x, window.innerWidth - host.offsetWidth));
      const y = Math.max(0, Math.min(raw.y, window.innerHeight - host.offsetHeight));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
    }
  } catch {
  }
  hitarea.addEventListener("pointerdown", (e) => {
    pressed = true;
    dragging = false;
    moved = false;
    interactFromSleep = animState === "sleep";
    stopWalk();
    startX = e.clientX;
    startY = e.clientY;
    lastPointerX = e.clientX;
    offsetX = e.clientX - host.offsetLeft;
    offsetY = e.clientY - host.offsetTop;
  });
  hitarea.addEventListener("pointermove", (e) => {
    if (!pressed) return;
    if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
      if (!moved) hitarea.setPointerCapture(e.pointerId);
      moved = true;
      dragging = true;
      transient = null;
      transientUntil = 0;
      joyUntil = 0;
      layoutStatus();
      const nextFlip = e.clientX < lastPointerX ? 1 : -1;
      if (nextFlip !== flip) {
        flip = nextFlip;
        const dragCfg = stateOf(character, "drag");
        if (animState === "drag" && dragCfg && loaded.has(sheetKey(dragCfg.sheet))) showSprite("drag", dragCfg);
        applyHitArea();
      }
    }
    lastPointerX = e.clientX;
    if (!moved) return;
    const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - host.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - host.offsetHeight));
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    if (menu.classList.contains("open")) layoutMenu();
  });
  hitarea.addEventListener("pointerup", (e) => {
    pressed = false;
    dragging = false;
    const wasMoved = moved;
    if (hitarea.hasPointerCapture(e.pointerId)) hitarea.releasePointerCapture(e.pointerId);
    if (wasMoved) {
      savePos();
      dragReleaseUntil = Date.now() + DRAG_RELEASE_MS;
      releaseInteraction();
      moved = false;
    }
    layoutStatus();
    if (!wasMoved && !e.target.closest("button")) toggleMenu();
  });
  const onDragAbort = () => {
    pressed = false;
    dragging = false;
    if (moved) {
      dragReleaseUntil = Date.now() + DRAG_RELEASE_MS;
      releaseInteraction();
      moved = false;
    }
    layoutStatus();
  };
  hitarea.addEventListener("pointercancel", onDragAbort);
  hitarea.addEventListener("lostpointercapture", onDragAbort);
  stage.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      interactFromSleep = animState === "sleep";
      toggleMenu();
    }
  });
  const onDocPointerDown = (e) => {
    if (!host.contains(e.target)) toggleMenu(false);
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") toggleMenu(false);
  };
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onKeyDown);
  feedBtn.addEventListener("click", () => {
    toggleMenu(false);
    void interact("feed");
  });
  playBtn.addEventListener("click", () => {
    toggleMenu(false);
    void interact("play");
  });
  roleBtn.addEventListener("click", () => {
    const roles = listCharacters(manifest);
    if (roles.length < 2) return;
    const idx = roles.indexOf(characterId);
    const next = roles[(idx + 1) % roles.length];
    switchCharacter(next);
    toggleMenu(false);
  });
  const onPetSay = (e) => {
    if (e.detail && typeof e.detail.text === "string" && e.detail.text.length > 0) showReply(e.detail.text);
  };
  const onPetFx = (e) => {
    if (e.detail?.type === "hearts") spawnHearts();
  };
  const onPetStatus = (e) => {
    if (e.detail && typeof e.detail.text === "string") {
      const prev = metaNote.textContent;
      metaNote.textContent = e.detail.text;
      setTimeout(() => {
        if (metaNote.textContent === e.detail.text) renderStatus();
      }, 2500);
    }
  };
  document.addEventListener("whale-girl:say", onPetSay);
  document.addEventListener("whale-girl:fx", onPetFx);
  document.addEventListener("whale-girl:status", onPetStatus);
  const stopWalk = () => {
    walking = false;
    if (walkRaf !== null) {
      cancelAnimationFrame(walkRaf);
      walkRaf = null;
    }
    scheduleWander();
  };
  const scheduleWander = () => {
    clearTimeout(wanderTimer);
    if (!cfg.walk.enabled) return;
    const wait = cfg.walk.minWaitMs + Math.random() * (cfg.walk.maxWaitMs - cfg.walk.minWaitMs);
    wanderTimer = setTimeout(() => {
      if (sleeping || sessionMood.thinking || sessionMood.waiting) {
        scheduleWander();
        return;
      }
      wander();
    }, wait);
  };
  const wander = () => {
    walking = true;
    walkDir = Math.random() < 0.5 ? 1 : -1;
    flip = -walkDir;
    const walkCfg = stateOf(character, "walk");
    if (animState === "walk" && walkCfg && loaded.has(sheetKey(walkCfg.sheet))) showSprite("walk", walkCfg);
    applyHitArea();
    const duration = cfg.walk.minMs + Math.random() * (cfg.walk.maxMs - cfg.walk.minMs);
    const start = performance.now();
    const maxX = Math.max(0, window.innerWidth - host.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - host.offsetHeight);
    const rect = host.getBoundingClientRect();
    const startLeft = Math.min(Math.max(rect.left, 0), maxX);
    const startTop = Math.min(Math.max(rect.top, 0), maxY);
    host.style.right = "auto";
    host.style.bottom = "auto";
    const step = (t) => {
      if (sleeping || dragging || sessionMood.thinking || sessionMood.waiting) {
        stopWalk();
        return;
      }
      const x = startLeft + walkDir * cfg.walk.speedPxPerSec * ((t - start) / 1e3);
      if (x <= 0 || x >= maxX || t - start >= duration) {
        host.style.left = `${Math.min(maxX, Math.max(0, x))}px`;
        host.style.top = `${startTop}px`;
        stopWalk();
        return;
      }
      host.style.left = `${x}px`;
      host.style.top = `${startTop}px`;
      walkRaf = requestAnimationFrame(step);
    };
    walkRaf = requestAnimationFrame(step);
  };
  const armWorking = () => {
    if (!sessionMood.thinking) {
      if (workingTimer !== null) clearTimeout(workingTimer);
      workingTimer = null;
      working = { active: false, until: 0 };
      return;
    }
    if (workingTimer !== null) return;
    const decision = nextWorkingRhythm({ now: Date.now(), sessionThink: true, working, random: Math.random });
    const delay = Math.max(0, decision.until - Date.now());
    workingTimer = setTimeout(() => {
      workingTimer = null;
      working = { active: decision.active, until: 0 };
      armWorking();
    }, delay);
  };
  let animTimer = null;
  let sse = null;
  const boot = async () => {
    const config = await fetchConfig();
    if (config !== null && config.enabled === false) {
      dispose();
      return;
    }
    if (config !== null) applyClientConfig(config);
    host.style.display = "";
    loadAssets();
    refresh();
    pollTimer = setInterval(refresh, cfg.pollMs);
    animTimer = setInterval(tick, TICK_MS);
    scheduleWander();
    armWorking();
    try {
      sse = new EventSource(EVENTS_PATH);
      sse.onmessage = () => refresh();
    } catch {
    }
  };
  boot();
  armWorking();
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      if (pollTimer === null) pollTimer = setInterval(refresh, cfg.pollMs);
      if (animTimer === null) animTimer = setInterval(tick, TICK_MS);
      refresh();
    } else {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (animTimer !== null) {
        clearInterval(animTimer);
        animTimer = null;
      }
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onResize = () => {
    if (host.style.left) {
      const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth));
      const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
    }
    layoutStatus();
    if (menu.classList.contains("open")) layoutMenu();
  };
  window.addEventListener("resize", onResize);
  let pageHidden = false;
  let companionOnline = false;
  const syncInert = () => {
    const dialog = document.querySelector('[role="dialog"]') !== null;
    const onboarding = document.getElementById("deepseek-onboarding-title") !== null || document.querySelector('[aria-labelledby="deepseek-onboarding-title"]') !== null;
    const next = onboarding ? "onboarding" : companionOnline ? "companion" : dialog ? "dialog" : null;
    if (next !== pageHidden) {
      pageHidden = next;
      if (next === "onboarding" || next === "companion") {
        host.setAttribute("data-whale-girl-hidden", "");
        host.removeAttribute("data-whale-girl-inert");
        host.style.display = "none";
        host.style.opacity = "";
      } else if (next === "dialog") {
        host.removeAttribute("data-whale-girl-hidden");
        host.style.display = "";
        host.setAttribute("data-whale-girl-inert", "");
        host.style.opacity = ".25";
      } else {
        host.removeAttribute("data-whale-girl-inert");
        host.removeAttribute("data-whale-girl-hidden");
        host.style.display = "";
        host.style.opacity = "";
      }
    }
  };
  const dialogObserver = new MutationObserver(syncInert);
  dialogObserver.observe(document.body, { childList: true, subtree: true });
  syncInert();
  const dispose = () => {
    clearInterval(pollTimer);
    if (animTimer !== null) clearInterval(animTimer);
    if (sse !== null) sse.close();
    clearTimeout(wanderTimer);
    if (workingTimer !== null) clearTimeout(workingTimer);
    if (walkRaf !== null) cancelAnimationFrame(walkRaf);
    for (const t of bubbleTimers) clearTimeout(t);
    bubbleTimers.clear();
    clearBubble();
    dialogObserver.disconnect();
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("whale-girl:say", onPetSay);
    document.removeEventListener("whale-girl:fx", onPetFx);
    document.removeEventListener("whale-girl:status", onPetStatus);
    host.removeEventListener("mouseenter", onHostEnter);
    host.removeEventListener("mouseleave", onHostLeave);
    window.removeEventListener("resize", onResize);
    if (offSettings !== null) {
      offSettings();
      offSettings = null;
    }
    host.remove();
    style.remove();
  };
  return dispose;
}
var name = "whale-girl";
var inject = ["slots", "locale", "configForms"];
		return module.exports;
	}
});
