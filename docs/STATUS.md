# Project status

This page is the detailed, point-in-time status of H-Gate: what's implemented, how it was
verified, and what's deliberately deferred. For the chronological build log (what changed, in
what order, and why), see [CHANGELOG.md](../CHANGELOG.md). For architecture and the prior-art
research behind the design decisions, see [ANALYSIS.md](./ANALYSIS.md).

## Version: v0.1 (initial build)

The core loop works end-to-end: add a cluster → connect to it over SSH → view its Grafana status
→ view/file its Jira tickets — all inside one standalone Electron app, with no browser involved.

| Area | Status | Notes |
|---|---|---|
| Multi-cluster registry | ✅ Done | SQLite-backed (`better-sqlite3`), add/edit/remove, per-cluster tags |
| SSH connection profiles | ✅ Done | password / private key (+ passphrase) / SSH agent, optional jump host |
| Secrets storage | ✅ Done | `electron.safeStorage` (OS keychain, e.g. libsecret on Linux) — never round-tripped to the renderer |
| Embedded SSH terminal | ✅ Done | `ssh2` + `@xterm/xterm`, one session at a time |
| Grafana status | ✅ Done | health check, per-dashboard title/link, panel snapshot image if `grafana-image-renderer` is installed |
| Jira issues | ✅ Done | list via JQL, file new tickets; supports both Jira Cloud (email + API token) and Data Center (PAT) |
| Linux packaging | ✅ Done | AppImage + `.deb` via `electron-builder` |
| App icon / branding | ✅ Done | custom mark, see `resources/icon.svg` |
| Automated tests | ❌ Not started | verification so far is `typecheck` + `lint` + `build` on every change, no unit/e2e suite yet |
| Multi-session terminal (tabs) | ❌ Not started | only one SSH session open at a time currently |
| Jump host with its own password | ⚠️ Partial | only supported when the jump host uses the *same* auth method as the target cluster (see the note in `src/main/ssh/manager.ts`) — a jump host needing an independent password isn't wired up yet |
| Windows / macOS packaging | ⚠️ Untested | `electron-builder` config exists for both, but the project is being developed and verified on Linux only |

## How each feature was verified

This environment can run `npm run typecheck`, `npm run lint`, and `npm run build` on every
change, but **cannot render an actual Electron GUI window** (`ELECTRON_RUN_AS_NODE=1` is enforced
here, which forces the Electron binary to always run as plain Node rather than open a window) and
has no reachable SSH/Grafana/Jira servers to test against live. So every feature so far has been:

1. Implemented and type-checked/linted/built successfully.
2. Where a UI was involved, visually verified by serving the React renderer alone through a plain
   Vite dev server, opening it in a headless Chromium browser (Playwright), and exercising it
   against a mocked `window.api` (the same interface the real Electron preload bridge exposes)
   with realistic sample data. This is how the screenshots and GIFs in the README were produced.
3. **Not yet verified against real infrastructure**: an actual SSH server, a real Grafana
   instance, or a real Jira instance. If you have access to any of those, running `npm run dev`
   on a normal desktop and pointing H-Gate at them is the natural next verification step.

## Known limitations / near-term roadmap

- **Single terminal session** — connecting to a second cluster while one is open isn't supported
  yet; the natural next step is tabs or a session switcher, reusing the existing `ssh:*` IPC
  channels (they're already keyed by `sessionId`, so the main-process side mostly just needs the
  renderer to track more than one).
- **Jump host secret reuse** — see `src/main/ssh/manager.ts`; a jump host with a different
  password than the target cluster needs its own stored secret, which the data model doesn't
  have a field for yet.
- **Grafana snapshots need the image-renderer plugin** — without it, H-Gate falls back to just
  the dashboard title and an "Open in Grafana" link. A future iteration could let a cluster point
  at specific panel IDs instead of just dashboard UIDs, for a more compact status view.
- **No automated tests** — the project has been verified manually (typecheck/lint/build, plus the
  headless-browser screenshot pipeline for UI changes) rather than with a test suite. Adding one
  (component tests for the renderer, and integration tests for the main-process SSH/Grafana/Jira
  clients against local mock servers) is the biggest gap before this could be called production-ready.
- **Reproducible builds / Docker** — not yet decided; see the open question in the project
  conversation history. The current recommendation is to containerize the *build* toolchain (a
  pinned Node + native-module build environment for `electron-builder`) rather than the packaged
  app itself, since H-Gate is a GUI app meant to run natively on the user's desktop and Electron
  GUIs inside Docker require finicky X11/Wayland socket forwarding that undermines the
  "standalone desktop app" goal.
