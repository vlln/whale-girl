<p align="center">[中文](README.zh.md) | English</p>

<h1 align="center">whale-girl</h1>

<p align="center">
  <strong>A desktop pet in the DSH Web GUI (QQ-pet style)</strong><br/>
  A persistent companion floating bottom-right: draggable, feedable, playable —
  completed tasks, sessions, and companionship time accrue into seniority levels,
  titles, and memories.
</p>

<p align="center">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license" />
  <img src="https://badgen.net/badge/format/official%20bundle/8257D0" alt="official bundle" />
</p>

---

## Installation

Official **bundle plugin** (`dsh.bundle` + `dsh.client` in root `package.json`), managed via the official profile:

```sh
dsh plugin --profile web add "github:vlln/whale-girl#main"   # single-line git source (build artifacts committed)
# or npm source: dsh plugin --profile web add whale-girl@0.1.0
# or local directory: dsh plugin --profile web add <path-to-whale-girl>
```

**Restart web** after installing (bundle layers compose at startup); the pet appears bottom-right: click for its menu (🍗 feed / 🎾 play), drag to move, hover for the status bar (seniority level / task count / recent shared memories). Hidden on onboarding pages.

Update via `dsh plugin --profile web update whale-girl` (or switch the git ref), then restart.

## Usage

| You / event | Pet behavior |
|---|---|
| Drag the pet | Stretched diagonally (`drag`) |
| Menu 🍗 feed / 🎾 play | Chomping / ball toss (`eat`/`play`) → joy (`joy`) |
| Idle ≥60s | Naps (`sleep`); wakes on interaction (`wake`) |
| Task done / level-up / title / round done | Cheers (`celebrate`) |
| Task failed / request error | Startled (`error`) → disappointed (`disappointed`) |
| New session | Waves welcome (`welcome`) |
| Session running / thinking | Pensive company (`think`, occasional `working`) |
| Awaiting approval | Expectant waiting (`wait`) |
| Periodic wandering | Walking (`walk`) |
| Default | Idle standby (`idle`, random blinks / turns) |

Full state machine (priorities / transitions / triggers): [docs/state-machine.md](docs/state-machine.md).

## Desktop Companion (Optional)

`desktop/` is a **standalone companion app** (Node engine + Tauri shell, zero runtime deps) that keeps the whale girl resident on your OS desktop. **Not installed via `dsh plugin`** — enable it yourself:

```sh
# Prereqs: Node ≥18; the rendering shell needs Rust (cargo)
npm install -g whale-girl-desktop   # npm install (engine + Tauri shell source included)
whale-girl-desktop --headless       # headless: presence heartbeat + state polling + SSE
cd "$(npm root -g)/whale-girl-desktop/src-tauri" && cargo build --release  # first build ~5-15 min; artifact target/release/whale-girl-desktop (~12MB)
./target/release/whale-girl-desktop   # transparent always-on-top desktop pet (defaults to local DSH on 3080)
# WHALE_GIRL_BASE_URL=http://IP:PORT points at a non-local DSH
# or from source: cd desktop && npm install && cd src-tauri && cargo build --release
```

- Uses whale-girl's public endpoints (`/state`, `/events`, `/presence`, `/interact`, `/config`, `/assets`) **without touching the plugin**; the in-page pet hides while it runs (presence contract) and returns after exit/crash (TTL 45s).
- Shell: Tauri v2 (recommended, ~12MB); legacy Electron shell kept (`npm i -D electron`).
- Design & contracts: `desktop/DESIGN.md`, `desktop/BUILD-RUN.md`.

## State Preview

| State | Trigger | Preview |
|---|---|---|
| `idle` | Default standby | ![idle](docs/preview/idle.gif) |
| `working` | Random work spell while session thinks | ![working](docs/preview/working.gif) |
| `celebrate` | Task done / level-up / title / round done | ![celebrate](docs/preview/celebrate.gif) |
| `error` | Task failed / request error | ![error](docs/preview/error.gif) |
| `disappointed` | Brief dejection after failure | ![disappointed](docs/preview/disappointed.gif) |
| `joy` | Happy after feeding / playing | ![joy](docs/preview/joy.gif) |
| `eat` | Click to feed | ![eat](docs/preview/eat.gif) |
| `play` | Click to play | ![play](docs/preview/play.gif) |
| `drag` | While dragging | ![drag](docs/preview/drag.gif) |
| `walk` | Periodic wandering | ![walk](docs/preview/walk.gif) |
| `sleep` | Idle ≥60s | ![sleep](docs/preview/sleep.gif) |
| `wake` | Wake-up transition | ![wake](docs/preview/wake.gif) |
| `welcome` | New session | ![welcome](docs/preview/welcome.gif) |
| `think` | Company while session thinks | ![think](docs/preview/think.gif) |
| `wait` | Awaiting approval | ![wait](docs/preview/wait.gif) |

## Configuration

Edit the `whale-girl:` section in `<dshHome>/settings.yaml` (or the settings UI); changes **apply live, no restart**:

```yaml
whale-girl:
  enabled: true      # web render toggle (false disables the in-page pet while a desktop companion runs)
  size: 110          # pet size px (64–160)
  opacity: 1         # default opacity (0.2–1)
  walk:
    enabled: true    # wandering toggle
  sleepAfterMs: 60000
```

Full option list and why the semantic layer (XP / titles) is sealed: `lib/src/config.mjs`. **Not configurable** (changing XP / title thresholds would break the accumulation ledger).

## Characters

🎭 "Switch Character" cycles characters (or set `whale-girl:character` in localStorage); the button is **greyed out when the manifest has a single character** ("No other characters available"). Every character ships **all 15 states** (full contract: [docs/sprites-spec.md](docs/sprites-spec.md)); new characters: [docs/adding-a-character.md](docs/adding-a-character.md).

## Reference Implementation

whale-girl is a complete **bundle plugin format** exemplar (`dsh.bundle` + `cordis.patch.yml` + `lib/`, evolving with the official mechanism) — model new plugins on it:

- **Structure**: `lib/` (entry / logic / client / assets) separate from docs, decisions, scripts — root [AGENTS.md](AGENTS.md)
- **Conventions**: gates (`scripts/gates/run.mjs`) + decision records + full asset contracts; guidance: plugin-registry's [plugin-registry-create skill](https://github.com/vlln/plugin-registry/tree/main/skills/plugin-registry-create), [cookbook](https://github.com/vlln/plugin-registry/blob/main/docs/cookbook/creating-a-repository-plugin.md), [gotchas](https://github.com/vlln/plugin-registry/blob/main/skills/plugin-registry-create/references/gotchas.md)

## Contributing

**Issues and suggestions welcome** — your feedback shapes the pet's next steps:

- 🐛 **Bug**: file an issue with repro steps, browser & dsh versions; console errors for client issues
- 💡 **Feature ideas**: see [docs/state-machine.md](docs/state-machine.md) and [docs/growth-system.md](docs/growth-system.md), describe the expected effect
- 🎨 **New characters**: [docs/adding-a-character.md](docs/adding-a-character.md) §quick guide — read-only contract, 15 sheets + manifest entries, validated by `verify-assets`
- 🔧 **Code**: every non-trivial change needs a decision record (`decisions/`), gate self-checks, single-purpose commits ([docs/AGENTS.md](docs/AGENTS.md), root [AGENTS.md](AGENTS.md))

## Acknowledgements

Character by [ZipZipPipe](https://space.bilibili.com/4168597) (the "Whale Girl" sticker character); sprites generated from their design.

## License

MIT License
