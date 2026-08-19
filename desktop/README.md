<p align="center">[中文](README.zh.md) | English</p>

# whale-girl-desktop

Renders the whale girl from [whale-girl](https://github.com/vlln/whale-girl) (the DSH Web GUI desktop-pet plugin) as a persistent companion on your **operating-system desktop**: a transparent, always-on-top window that can be dragged, fed, and played with, wanders around periodically, and tracks your DSH session state in real time (thinking / waiting / task-completion celebration).

**Zero runtime dependencies**: the Node engine ships with no third-party packages; the desktop rendering shell is built on Tauri (system webview, ~12MB vs. Electron's 277MB).

## Installation

```sh
npm i -g whale-girl-desktop          # or, inside a project: npm i whale-girl-desktop
# The desktop rendering shell requires the Rust toolchain (cargo):
cd "$(npm root -g)/whale-girl-desktop/src-tauri" && cargo build --release
```

## Usage

```sh
# Headless mode (presence heartbeat + state polling + SSE; for self-tests, CI, or headless environments)
whale-girl-desktop --headless

# Desktop pet (transparent, always-on-top window) — requires cargo build --release first
"$(npm root -g)/whale-girl-desktop/src-tauri/target/release/whale-girl-desktop"
# or, from the source repo: cd desktop && npm run build:tauri && npm run start:tauri
```

Point it at a non-local DSH instance: `WHALE_GIRL_BASE_URL=http://IP:PORT` (defaults to `http://127.0.0.1:3080`).

## Prerequisites

- The whale-girl plugin installed in DSH (`dsh plugin --profile web add "github:vlln/whale-girl#main"`)
- Node ≥18; cargo (Rust toolchain) for desktop rendering

## Behavior

- While the desktop pet is running, the in-web pet hides automatically (presence contract) and is restored after the desktop pet exits or crashes (presence TTL expires after 45s)
- State transitions, click interactions, dragging, and wandering are aligned with the plugin version; see [DESIGN.md](DESIGN.md) and [BUILD-RUN.md](BUILD-RUN.md) for the design and contracts

## License

MIT
