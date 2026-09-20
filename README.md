# H-Gate

H-Gate is a standalone desktop application (not a browser app) for managing HPC (High Performance
Computing) workloads across multiple clusters, from a single Linux desktop.

## What it does

- **Multi-cluster management** — register any number of HPC clusters, each with its own SSH
  connection profile (host, port, user, auth method, optional jump/bastion host).
- **Connect & operate** — open an SSH session (embedded terminal) to any registered cluster
  without leaving the app.
- **Live status via Grafana** — pull cluster health/utilization data from each cluster's Grafana
  instance (nodes up/down, queue depth, job throughput, resource utilization) using the Grafana
  REST API.
- **Jira integration** — view, search, and create Jira issues related to a cluster directly from
  its dashboard (e.g. incident tickets, job-support requests).

## Status

Early development. See [CHANGELOG.md](./CHANGELOG.md) for the running build log and
[docs/ANALYSIS.md](./docs/ANALYSIS.md) for the prior-art research and architecture decisions.

## Tech stack

- **Shell**: Electron (Linux-first; cross-platform later if needed)
- **UI**: React + TypeScript, bundled with Vite
- **SSH / terminal**: `ssh2` (SSH client, SFTP, jump-host support) + `xterm.js` / `node-pty` for
  the embedded terminal
- **Secrets**: OS keychain via `keytar` (SSH passphrases, Grafana/Jira API tokens never stored in
  plaintext)
- **Local persistence**: `better-sqlite3` for cluster/profile configuration
- **Integrations**: Grafana HTTP API (API key/service account), Jira REST API (API token)

## Development

See [docs/ANALYSIS.md](./docs/ANALYSIS.md) for architecture details and the build plan. Each
feature is developed on its own `feature/*` branch and merged into `main` once it builds, lints,
and typechecks cleanly.

```bash
npm install       # install dependencies
npm run dev       # run the app in development mode
npm run lint       # eslint
npm run typecheck  # tsc, main + renderer
npm run build      # production build (main/preload/renderer)
npm run build:linux  # package as AppImage + .deb
```

Requires Node.js 20+. Project layout:

```
src/
  main/       # Electron main process — SSH, SQLite store, Grafana/Jira HTTP calls
  preload/    # contextBridge API exposed to the renderer
  renderer/   # React UI
```
