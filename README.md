# H-Gate

H-Gate is a standalone desktop application (not a browser app) for managing HPC (High Performance
Computing) workloads across multiple clusters, from a single Linux desktop.

## What it does

- **Multi-cluster management** — register any number of HPC clusters, each with its own SSH
  connection profile (host, port, user, auth method, optional jump/bastion host).
- **Connect & operate** — open an SSH session (embedded terminal) to any registered cluster
  without leaving the app.
- **Live status via Grafana** — pull cluster health and dashboard snapshots from each cluster's
  Grafana instance using the Grafana REST API.
- **Jira integration** — view matching issues and file new tickets against a cluster's Jira
  project, for both Jira Cloud and Jira Data Center/Server.

## Status

v0.1 — the core loop works end-to-end: add a cluster → connect to it over SSH → view its Grafana
status → view/file its Jira tickets. See [CHANGELOG.md](./CHANGELOG.md) for the running build log
and [docs/ANALYSIS.md](./docs/ANALYSIS.md) for the prior-art research and architecture decisions.

Known limitations, to be picked up next:

- Single terminal session at a time (no tabs/multi-session yet).
- A jump host with its own password (different from the target cluster's) isn't supported yet -
  see the note in `src/main/ssh/manager.ts`.
- Grafana dashboard snapshots require the `grafana-image-renderer` plugin on the target Grafana;
  without it, H-Gate falls back to showing the dashboard title/link only.
- No automated test suite yet - each feature has so far been verified via `typecheck`/`lint`/`build`.

## Tech stack

- **Shell**: Electron (Linux-first; cross-platform later if needed)
- **UI**: React + TypeScript, bundled with Vite (`electron-vite`)
- **SSH / terminal**: `ssh2` (SSH client, password/key/agent auth, jump-host chaining) +
  `@xterm/xterm` for the embedded terminal (no local PTY needed - every session is a remote SSH
  channel)
- **Secrets**: `electron.safeStorage` (OS keychain-backed, e.g. libsecret on Linux) - SSH
  passphrases and Grafana/Jira API tokens are encrypted at rest and never sent back to the
  renderer once saved
- **Local persistence**: `better-sqlite3` for cluster/profile configuration
- **Integrations**: Grafana HTTP API (service-account token), Jira REST API (Cloud: email + API
  token; Data Center: Personal Access Token)

## Development

See [docs/ANALYSIS.md](./docs/ANALYSIS.md) for architecture details and the build plan. Each
feature is developed on its own `feature/*` branch and merged into `main` once it builds, lints,
and typechecks cleanly.

```bash
npm install          # install dependencies
npm run dev           # run the app in development mode
npm run lint           # eslint
npm run typecheck      # tsc, main + renderer
npm run build           # production build (main/preload/renderer)
npm run build:linux      # package as AppImage + .deb
```

Requires Node.js 20+. Project layout:

```
src/
  shared/     # types shared between main and renderer (over the preload bridge)
  main/       # Electron main process — SSH sessions, SQLite store, Grafana/Jira HTTP calls
  preload/    # contextBridge API exposed to the renderer
  renderer/   # React UI (cluster list, terminal, Grafana/Jira status screens)
```
