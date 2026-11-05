# External consumers

Local companion applications may read whale-girl state from a running DSH Web profile. The snapshot is read-only and non-consuming: multiple clients can observe the same activity windows without stealing events from one another.

## Endpoints

- `GET /whale-girl/state` returns the current snapshot with `cache-control: no-store`.
- `GET /whale-girl/events` is an SSE refresh signal. Fetch `/state` after each message and retain polling as a reconnect fallback.
- `GET /whale-girl/config` returns the current presentation configuration.
- `GET /whale-girl/assets/*` serves the character manifest and sprite sheets.
- `POST /whale-girl/presence` is the desktop-companion heartbeat (display-layer write, cross-origin guarded). A companion application that replaces the in-page pet posts `{ "online": true }` every 15s while running, and `{ "online": false }` on clean exit. While the presence window (45s TTL) is active, `/state` reports `companionOnline: true` and the in-page pet hides itself; if the companion dies without a farewell, the window expires and the in-page pet returns automatically.

The snapshot response is:

```json
{
  "apiVersion": 1,
  "pet": {},
  "activity": {
    "name": "idle",
    "until": 0,
    "sessionThink": false,
    "sessionWait": false,
    "turnCompleted": false,
    "turnCompletedUntil": 0
  },
  "configRevision": 1,
  "companionOnline": false
}
```

`turnCompletedUntil` is an absolute Unix timestamp in milliseconds. Consumers should use it as the animation deadline; `turnCompleted` is the corresponding convenience boolean. Unknown fields may be added compatibly within an API version.

```js
const base = 'http://127.0.0.1:3080'
const readState = async () => {
  const response = await fetch(`${base}/whale-girl/state`)
  if (!response.ok) throw new Error(`whale-girl state: HTTP ${response.status}`)
  return response.json()
}

const events = new EventSource(`${base}/whale-girl/events`)
events.onmessage = async () => render(await readState())
```

Keep DSH bound to loopback when its local state should not be visible to other machines. Consumers must tolerate the server being unavailable during DSH startup, shutdown, and profile restarts.

## In-page integration surface

A plugin running inside the same page (a `dsh.client` half) can drive the pet's display layer without importing whale-girl. The client half exposes one host node and three DOM events; both are additive to the HTTP surface above.

- **Host node**: `[data-whale-girl]` is the pet's fixed-position container. UI mounted inside it inherits the pet's position (the container moves when the pet is dragged) and its visibility (the container is hidden when `enabled: false` or while a desktop companion holds the presence window).
- **Events** are dispatched on `document` and validated before use: a missing or malformed `detail` is ignored silently, and so is an unknown `type` for `whale-girl:fx`.

| Event | `detail` | Effect |
|---|---|---|
| `whale-girl:say` | `{ text: string }`, non-empty | Speech bubble above the pet; closes the interaction menu first. Lifetime is the configured `bubbleMs` (default 2500 ms). |
| `whale-girl:fx` | `{ type: 'hearts' }` | Heart burst above the pet. Other `type` values are ignored. |
| `whale-girl:status` | `{ text: string }` | Overrides the note line of the hover status card for 2500 ms, then restores it if no later update replaced the text. |

```js
document.dispatchEvent(new CustomEvent('whale-girl:say', { detail: { text: '谷价开始了' } }))
```

**Dispatch on `document`, not on `window`.** The listeners are attached to `document`, so a `CustomEvent` dispatched on `window` never reaches them. Dispatching on `document` works, and so does dispatching on any DOM node inside it, because the events bubble.

`text` is written as text content, so markup such as `<b>` is displayed literally rather than rendered.

Pet chrome addressed by class name — the `.pet-menu` button row, `.pet-status`, `.pet-bubble` — is not a stable API: those names follow the client implementation and may change between releases. An integration that needs a stable entry point should mount into `[data-whale-girl]` and listen to the events above instead.

A consumer of this surface: [whale-purse](https://github.com/Kaiii521/whale-purse) renders a balance and peak-price badge inside the host node and speaks through `whale-girl:say`.
