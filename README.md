<p align="center">
  <img src="resources/icon.png" alt="Gate-H icon" width="96" height="96">
</p>

<h1 align="center">Gate-H</h1>

<p align="center">
  A standalone desktop app (not a browser app) for managing HPC workloads across multiple
  clusters, from a single Linux desktop.
</p>

## What it does

- **Multi-cluster management** — register any number of HPC clusters, each with its own SSH
  connection profile (host, port, user, auth method, optional jump/bastion host).
- **Connect & operate** — open an SSH session (embedded terminal) to any registered cluster
  without leaving the app.
- **Live status via Grafana** — pull cluster health and dashboard snapshots from each cluster's
  Grafana instance using the Grafana REST API.
- **Jira integration** — view matching issues and file new tickets against a cluster's Jira
  project, for both Jira Cloud and Jira Data Center/Server.

## Preview

<p align="center">
  <img src="docs/assets/screenshots/cluster-list.png" alt="Cluster list" width="720"><br/>
  <sub>Every cluster you manage, with its connection, Grafana, and Jira status at a glance.</sub>
</p>

<table>
<tr>
<td width="50%" align="center">
  <img src="docs/assets/screenshots/ssh-terminal.png" alt="Embedded SSH terminal" width="360"><br/>
  <sub>Connect over SSH without leaving the app</sub>
</td>
<td width="50%" align="center">
  <img src="docs/assets/screenshots/cluster-status.png" alt="Cluster status screen" width="360"><br/>
  <sub>Grafana health/snapshots + Jira issues, per cluster</sub>
</td>
</tr>
</table>

### Procedures

<table>
<tr>
<td align="center">
  <b>Add a cluster</b><br/><br/>
  <img src="docs/assets/gifs/add-cluster.gif" alt="Adding a cluster" width="320">
</td>
<td align="center">
  <b>Connect over SSH</b><br/><br/>
  <img src="docs/assets/gifs/ssh-connect.gif" alt="Connecting over SSH" width="320">
</td>
<td align="center">
  <b>Status + file a Jira ticket</b><br/><br/>
  <img src="docs/assets/gifs/cluster-status.gif" alt="Viewing status and filing a Jira ticket" width="320">
</td>
</tr>
</table>

> These were captured by driving the real UI code in a headless browser against sample data (this
> environment can't open an actual Electron window) — see [docs/STATUS.md](docs/STATUS.md) for
> exactly how, and what's still unverified against real infrastructure.

## Get the app

The reproducible way to get a runnable Gate-H, no local Node/toolchain setup required — just
[Docker](https://docs.docker.com/engine/install/):

```bash
./build-desktop.sh
./dist/Gate-H-*.AppImage
```

`build-desktop.sh` builds a pinned Node + native-module toolchain image, then builds and packages
Gate-H inside a container from it — the same result on any machine, regardless of what's installed
locally. See [docker/build.Dockerfile](docker/build.Dockerfile) for exactly what's in that image.

Then, inside the app:

1. Click **+ Add cluster** and fill in a name plus its SSH connection details (host, user, auth
   method). Grafana and Jira are optional per cluster.
2. Click **Connect** on a cluster card to open an embedded SSH terminal to it.
3. Click **Status** on a cluster card to see its Grafana health/dashboards and Jira issues, and to
   file a new ticket.

## Development

For active development (with hot reload), run Gate-H directly with Node instead — Docker doesn't
give you a GUI window, so it's only used for reproducible packaging above, not for `dev`:

```bash
npm install       # install dependencies (Node.js 20+ required)
npm run dev       # launch Gate-H in development mode
```

Other useful scripts: `npm run lint`, `npm run typecheck`, `npm run build`.

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

Project layout:

```
src/
  shared/     # types shared between main and renderer (over the preload bridge)
  main/       # Electron main process — SSH sessions, SQLite store, Grafana/Jira HTTP calls
  preload/    # contextBridge API exposed to the renderer
  renderer/   # React UI (cluster list, terminal, Grafana/Jira status screens)
```

## Learn more / project status

This README stays focused on what Gate-H is and how to run it. For anything deeper:

- **[docs/STATUS.md](docs/STATUS.md)** — current feature completeness, how each feature has been
  verified so far, and known limitations/roadmap.
- **[CHANGELOG.md](CHANGELOG.md)** — the chronological build log: every change, in the order it
  happened, and why.
- **[docs/ANALYSIS.md](docs/ANALYSIS.md)** — prior-art research (Open OnDemand, ColdFront/XDMoD,
  Slurm-web, etc.) and the architecture decisions behind Gate-H.

Each feature is developed on its own `feature/*` branch and merged into `main` once it builds,
lints, and typechecks cleanly.
