# Changelog

All notable changes to H-Gate are documented in this file, in the order they happened.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### 2026-09-20 — Project kickoff

- Initialized local git repository (`main` branch), configured local git identity
  (`ahmedyousrisobhi` / `ahmedyousrisobhi@gmail.com`).
- Defined the working process: every feature is built on its own `feature/*` branch and merged
  into `main` only once it builds/lints/verifies cleanly.
- Decided on tech stack: **Electron + React + TypeScript** (Vite bundler) for a standalone,
  Linux-first desktop app — chosen over Tauri/Rust and Python/PySide6 for fastest path to a
  working app with mature SSH, terminal, and REST-integration libraries.
- Decided on integration approach: **REST API with API tokens** for both Grafana and Jira,
  rather than embedding Grafana panels via iframe — keeps the app fully self-contained and not
  dependent on a browser runtime or Grafana's public-sharing settings.
- Added `README.md` (project overview, tech stack) and this changelog.
- Kicked off research into prior art (Open OnDemand, ColdFront, XDMoD, Bright Cluster Manager,
  Slurm web UIs, Ganglia, generic SSH managers) and technical building blocks (Node SSH clients,
  embedded terminal libraries, Electron secrets storage, Grafana/Jira REST APIs) — findings
  recorded in `docs/ANALYSIS.md`.

### 2026-09-20 — `feature/app-scaffold`

- No system Node.js was available and there is no root/sudo access in this environment, so a
  Node.js LTS (v22.14.0) build was installed for the local user under `~/.local/opt/node`
  (added to `PATH` via `~/.bashrc`) instead of using `apt`/system packages. No system packages
  were touched and no reboot was required.
- Scaffolded the Electron + React + TypeScript app using `electron-vite`'s official
  `react-ts` template (main / preload / renderer process split).
- Renamed the app to **H-Gate** throughout (`package.json`, `electron-builder.yml`: app id
  `de.yousri.hgate`, product name `H-Gate`); linux packaging targets set to AppImage + deb.
- Wrote `docs/ANALYSIS.md`: prior-art comparison (Open OnDemand, ColdFront/XDMoD, Bright Cluster
  Manager, Slurm-web, Ganglia, Termius/MobaXterm/Remmina), the chosen architecture (Electron
  process split, `ssh2` + jump-host chaining, `xterm.js` + `node-pty` terminal,
  `electron.safeStorage` for secrets instead of the now-deprecated `keytar`, `better-sqlite3` for
  local storage, Grafana/Jira REST integration details), and the branch-by-branch build plan.
- Verified the scaffold end-to-end: `npm install`, `npm run typecheck`, `npm run lint`, and
  `npm run build` all pass cleanly.

### 2026-09-20 — `feature/cluster-store`

- Added the shared `Cluster` / `ClusterInput` / `ClusterSummary` data model
  (`src/shared/types.ts`) covering a cluster's identity, its SSH connection profile (host, port,
  user, auth method, optional jump/bastion host), and its optional Grafana and Jira profiles.
- Implemented the local cluster store: `better-sqlite3` for structured data
  (`src/main/db.ts`, `src/main/clusters.ts`) and `electron.safeStorage` for encrypting SSH
  passphrases/API tokens at rest (`src/main/secrets.ts`) — `keytar` was deliberately avoided since
  it is deprecated; `safeStorage` (OS keychain-backed, libsecret on Linux) is Electron's current
  recommended replacement.
- Exposed cluster CRUD to the renderer through a narrow `contextBridge` API
  (`src/preload/index.ts`, IPC handlers in `src/main/ipc/clusters.ts`) — secrets are write-only
  across this bridge and are never sent back to the renderer once saved.
- Built the first real UI: a cluster list/dashboard shell and an add/edit cluster form covering
  SSH connection details (including the jump-host toggle), Grafana config, and Jira config
  (`src/renderer/src/features/clusters/`), replacing the electron-vite demo page.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly. Could not
  visually smoke-test the running app in this sandbox: it has no working Electron GUI runtime
  (`ELECTRON_RUN_AS_NODE=1` is enforced here, which forces the Electron binary to run as plain
  Node rather than launch a window) — recommend running `npm run dev` on a normal desktop to
  visually verify this screen.
