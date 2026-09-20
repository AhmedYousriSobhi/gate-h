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

### 2026-09-20 — `feature/ssh-terminal`

- Added `ssh2`-based session management (`src/main/ssh/manager.ts`): connects using a cluster's
  stored connection profile (password, private key + optional passphrase, or SSH agent), chains
  through a jump/bastion host via `forwardOut` when configured, opens an interactive shell
  channel, and streams its output to the renderer. Sessions are tracked in memory and torn down
  on disconnect or app quit.
  - **Known v1 limitation** (documented in-code): a jump host currently reuses the target
    cluster's stored secret only when both use the same auth method; a jump host needing its own
    distinct password isn't supported yet and would need its own secret field — left for a
    follow-up rather than adding an unused option now.
- Exposed `ssh:connect` / `ssh:write` / `ssh:resize` / `ssh:disconnect` over IPC
  (`src/main/ipc/ssh.ts`) and the matching `window.api.ssh.*` bridge in preload, with `onData` /
  `onClosed` / `onError` subscriptions for the renderer.
- Built an embedded terminal (`src/renderer/src/features/terminal/TerminalView.tsx`) using
  `@xterm/xterm` + `@xterm/addon-fit`, wired to a new "Connect" button on each cluster card;
  `node-pty` was intentionally **not** added since it's only needed for a local shell — every
  H-Gate terminal is a remote SSH channel already provided by `ssh2`.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass. Could not test an
  actual SSH connection end-to-end in this sandbox (no reachable SSH server here, and see the GUI
  limitation noted above) — recommend testing `Connect` against a real cluster after `npm run dev`.

### 2026-09-20 — `feature/grafana-integration`

- Added a Grafana HTTP API client (`src/main/grafana/client.ts`) using a cluster's stored
  service-account token: `/api/health` for reachability/version, `/api/dashboards/uid/{uid}` for
  each configured dashboard's title/panel count, and `/render/d-solo/{uid}` (grafana-image-renderer)
  for a snapshot image of the first panel, falling back to just the title/link when the renderer
  plugin isn't installed.
  - Chose image-rendering over parsing per-panel queries directly so H-Gate stays genuinely
    datasource-agnostic — it works the same regardless of whether a cluster's Grafana sits on
    Prometheus, InfluxDB, or anything else, without H-Gate needing to understand that data source.
- Added `grafana:status` IPC handler (`src/main/ipc/grafana.ts`) and `window.api.grafana.getStatus`
  in preload.
- Added a cluster "Status" screen (`src/renderer/src/features/status/`) reachable via a new
  "Status" button on each cluster card, showing Grafana reachability and per-dashboard snapshots/links.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass. Could not test
  against a real Grafana instance in this sandbox (no reachable Grafana server here, plus the
  GUI limitation noted above) — recommend verifying the Status screen against a real Grafana
  instance (with and without grafana-image-renderer installed) after `npm run dev`.

### 2026-09-20 — `feature/jira-integration`

- Added a Jira REST client (`src/main/jira/client.ts`) supporting both **Jira Cloud** (Basic auth
  with account email + API token) and **Jira Data Center/Server** (Bearer + Personal Access
  Token), per the two auth modes captured on a cluster's Jira profile. Uses the `/rest/api/2/*`
  endpoints deliberately (not v3) so issue descriptions can stay plain strings instead of
  requiring Atlassian Document Format, keeping one code path generic across both Jira flavors.
  - `listJiraIssues` runs the cluster's configured JQL (or a default `project = X ORDER BY
    updated DESC`); `createJiraIssue` files a new ticket against the cluster's default project
    and returns its live status.
- Added `jira:list` / `jira:create` IPC handlers (`src/main/ipc/jira.ts`) and the matching
  `window.api.jira.*` preload bridge.
- Added a Jira section to the cluster Status screen (`src/renderer/src/features/status/JiraSection.tsx`):
  lists matching issues with a link to open each in the browser, and a small inline form to file
  a new ticket against the cluster's default project.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass. Could not test
  against a real Jira instance in this sandbox (no reachable Jira server here, plus the GUI
  limitation noted above) — recommend verifying issue listing/creation against both a Jira Cloud
  and a Jira Data Center instance after `npm run dev`.

### 2026-09-20 — v0.1 wrap-up

- The originally planned `feature/dashboard-shell` branch was folded into the work already done
  in `feature/ssh-terminal` and `feature/grafana-integration`: the single-window view-switching
  in `src/renderer/src/App.tsx` (cluster list ↔ terminal ↔ status) already covers that need, so a
  separate branch would have just re-touched the same files without adding anything new.
- Updated `README.md` to reflect the actual v0.1 feature set, tech stack (`safeStorage` instead of
  the originally-considered `keytar`, no `node-pty` since every terminal session is a remote SSH
  channel rather than a local shell), and known limitations/next steps: single terminal session at
  a time, jump-host-with-its-own-password not yet supported, Grafana snapshots need the
  `grafana-image-renderer` plugin, and no automated test suite yet.
- End-to-end result: add a cluster (with SSH connection, optional jump host, optional Grafana and
  Jira profiles) → Connect opens an embedded SSH terminal → Status shows Grafana health/dashboard
  snapshots and Jira issues, with the ability to file a new ticket - all from one standalone
  Electron app, verified via `npm run typecheck`, `npm run lint`, and `npm run build` at every step.

### 2026-09-20 — `feature/app-icon`

- Replaced the default electron-vite/Electron logo with a custom H-Gate mark: two rounded bars
  forming an "H" doubling as a gate/frame silhouette, with a glowing status node on the crossbar
  (nodding to the app's live Grafana monitoring), gradient blue on a dark navy rounded-square
  background - designed to read clearly down to a 16px taskbar size.
- No SVG/image tooling (ImageMagick, Inkscape, librsvg) is installed in this sandbox and there's
  no root access to add it, so the icon was rasterized by loading the SVG in the headless
  Chromium already cached here (from Playwright, itself installed for the screenshot work below)
  at each exact target resolution (16 to 1024px) rather than downscaling a single render - and
  `icon.ico` / `icon.icns` were assembled by hand (both formats accept plain PNG-encoded entries)
  since no packaging tool for those formats was available either.
- Replaced `resources/icon.png`, `build/icon.png`, `build/icon.ico`, and `build/icon.icns`; added
  `resources/icon.svg` as the editable vector source for future changes.
- Verified `npm run build` still succeeds with the new assets.
