# Changelog

All notable changes to Gate-H are documented in this file, in the order they happened.
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
- Renamed the app to **Gate-H** throughout (`package.json`, `electron-builder.yml`: app id
  `de.yousri.hgate`, product name `Gate-H`); linux packaging targets set to AppImage + deb.
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
  Gate-H terminal is a remote SSH channel already provided by `ssh2`.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass. Could not test an
  actual SSH connection end-to-end in this sandbox (no reachable SSH server here, and see the GUI
  limitation noted above) — recommend testing `Connect` against a real cluster after `npm run dev`.

### 2026-09-20 — `feature/grafana-integration`

- Added a Grafana HTTP API client (`src/main/grafana/client.ts`) using a cluster's stored
  service-account token: `/api/health` for reachability/version, `/api/dashboards/uid/{uid}` for
  each configured dashboard's title/panel count, and `/render/d-solo/{uid}` (grafana-image-renderer)
  for a snapshot image of the first panel, falling back to just the title/link when the renderer
  plugin isn't installed.
  - Chose image-rendering over parsing per-panel queries directly so Gate-H stays genuinely
    datasource-agnostic — it works the same regardless of whether a cluster's Grafana sits on
    Prometheus, InfluxDB, or anything else, without Gate-H needing to understand that data source.
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

- Replaced the default electron-vite/Electron logo with a custom Gate-H mark: two rounded bars
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

### 2026-09-20 — `feature/docs-preview`

- Split the README in two: it now stays focused on what Gate-H is, a visual preview, and how to
  run it, while `docs/STATUS.md` (new) carries the detailed, point-in-time status - a
  feature-by-feature completeness table, exactly how each feature has been verified so far, and
  known limitations/roadmap - for anyone who wants the deeper picture. `CHANGELOG.md` (this file)
  stays the chronological log; `docs/ANALYSIS.md` stays the architecture/prior-art doc.
- Generated real preview media from the actual UI code rather than mockups: served the React
  renderer alone through a plain Vite dev server (bypassing Electron, which this sandbox can't
  render), drove it with the same headless Chromium used for the earlier screenshots against a
  mocked `window.api` with realistic sample data, and captured:
  - Four static screenshots (`docs/assets/screenshots/`): cluster list, add-cluster form, SSH
    terminal, cluster status.
  - Three short procedure GIFs (`docs/assets/gifs/`): adding a cluster, connecting over SSH, and
    viewing status + filing a Jira ticket. Built by capturing a timed sequence of screenshots at
    each meaningful UI state (not a continuous screen recording) and encoding them with the
    pure-JS `gifenc`/`pngjs` packages, since no system video/image tooling (ffmpeg with a PNG
    decoder, ImageMagick) is available in this sandbox - the only ffmpeg present is Playwright's
    own stripped-down build, which can encode video for screen recording but can't decode PNG.
- All temporary tooling (the standalone Vite config, the mock-API/recording scripts) lived in the
  scratchpad directory and was not committed; only the resulting README, `docs/STATUS.md`, and
  `docs/assets/` media are part of the repo.

### 2026-09-20 — `feature/docker-build`

- Added `docker/build.Dockerfile` (a pinned `node:22-bookworm` toolchain image with the native-module
  build deps for `better-sqlite3` and the Linux packaging deps for `electron-builder`) and
  `build-desktop.sh`, which builds that image and then runs `npm ci && npm run typecheck && npm run
  build:linux` inside a container from it, bind-mounting the repo rather than baking source into
  the image - so editing app code never requires rebuilding the toolchain image.
- The container runs as the host user (`--user "$(id -u):$(id -g)"`) so build output ends up
  host-owned; `node_modules` and the npm/electron-builder download caches live in named Docker
  volumes (not bind-mounted from the host), so a Docker-built `node_modules` can never collide
  with the one used for local `npm run dev`. Docker was actually available in this sandbox, so
  this was verified end-to-end (not just written blind): `./build-desktop.sh` was run for real
  and produced `dist/Gate-H-0.1.0.AppImage`, host-owned and executable.
- Dropped `.deb` from `linux.target` in `electron-builder.yml`: electron-builder's `fpm`-based deb
  packaging requires a `homepage` field in `package.json`, and there's no real public repo/homepage
  URL for this project yet to put there - fabricating one felt worse than just building the
  `AppImage` (the format actually asked for) until a real URL exists. Also fixed `appImage.artifactName`
  to use `${productName}` instead of `${name}`, so the output is `Gate-H-<version>.AppImage` rather
  than `hgate-<version>.AppImage`, and excluded `docs/`, `docker/`, and `build-desktop.sh` from the
  packaged app's files (they're project docs/tooling, not app runtime files).
- Updated `README.md` (Docker is now the documented way to get a runnable build; `npm run dev`
  stays the documented path for local development, since Docker can't give you a GUI window) and
  `docs/STATUS.md` (packaging status, and the `.deb`/homepage limitation) to match.

### 2026-09-20 — `feature/rebrand-gate-h`

- First real user testing happened: the packaged AppImage was actually installed and used to
  connect to a real cluster ("TestCluster"). Feedback from that session drove this and the following
  changes.
- Renamed the product from "H-Gate" to "Gate-H" everywhere: the in-app header, `package.json`
  (`name`, `description`), `electron-builder.yml` (`appId`, `productName`, `win.executableName` -
  the packaged AppImage is now `Gate-H-<version>.AppImage`), the `<title>` tag (previously still
  the electron-vite template default, never actually set), the `HGateApi` → `GateHApi` TypeScript
  interface, and every mention across `README.md`/`CHANGELOG.md`/`docs/*.md` and the Docker
  image/volume names in `build-desktop.sh`.
- **Protected existing user data across the rename**: Electron was deriving the userData directory
  (where the cluster database lives) from the old `hgate` package name, so renaming it outright
  would have made the app start looking in a new, empty directory - silently "losing" a real
  user's already-saved clusters (including the "TestCluster" cluster from the testing session above).
  Added `src/main/userData.ts`: it now pins `userData` to an explicit `gate-h` directory
  (independent of whatever the npm package happens to be named, so this class of bug can't recur),
  and on first run after the rename, moves a pre-existing `~/.config/hgate/hgate.sqlite3` into the
  new location automatically before anything else touches it.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass after the rename.

### 2026-09-20 — `feature/sidebar-shell-and-monitoring`

Three more pieces of feedback from that same real-cluster testing session (see above): no live
indication of which clusters were actually reachable, a closed SSH session leaving the terminal
screen stuck until manually dismissed, and a request for a layout where the cluster list is
always visible instead of a full-page swap between "list" and "terminal"/"status".

- **Live reachability monitoring**: added `src/main/monitor/reachability.ts` (a TCP connect probe
  against each cluster's SSH host:port - no ICMP/raw sockets needed, and it reflects what actually
  matters here: can we SSH in) and `src/main/monitor/clusterMonitor.ts` (sweeps every registered
  cluster every 20s, broadcasts each result over a new `reachability:update` IPC event, and
  triggers an immediate check right after a cluster is added/edited rather than waiting for the
  next sweep). Exposed via `window.api.reachability.{getAll,onUpdate}` and a `useReachability()`
  renderer hook.
- **Sidebar + panel shell redesign**: replaced the old full-page navigation (`ClusterListPage` ⇄
  `TerminalView` ⇄ `ClusterStatusPage`, swapped via `App.tsx` state) with a persistent two-pane
  layout (`src/renderer/src/features/shell/`): a `Sidebar` listing every cluster with its live
  reachability LED, and a `MainPanel` with Terminal/Status tabs for whichever cluster is selected.
  Switching tabs no longer remounts anything (a background SSH session stays alive while looking
  at the Status tab); switching to a *different* cluster does tear down the previous session
  (see the multi-session limitation noted in `docs/STATUS.md`).
  - `TerminalView.tsx` and `ClusterStatusPage.tsx` (each previously a full page with its own
    header and a "Back to clusters" button) were replaced by `TerminalPanel.tsx` and
    `StatusPanel.tsx`, which just render their content into the shared shell instead of owning
    page-level chrome.
  - Consolidated `.btn`/`.error-banner`/`.hint` - previously defined in `clusters.css` and only
    incidentally available everywhere because `ClusterListPage` happened to import it - into
    `main.css` as genuinely shared primitives, now that the component that used to import them is
    gone.
- **Terminal no longer gets "stuck" when a session ends**: since the sidebar is always visible,
  there's no full page to navigate back from any more. `TerminalPanel` now shows a clear "closed"
  state with a **Reconnect** button in its status bar instead of requiring any dismissal - you can
  also just click a different cluster in the sidebar at any time, closed session or not.
- Regenerated all README preview screenshots/GIFs against the new UI, using the same headless
  Chromium + mocked `window.api` pipeline as before (see `docs/STATUS.md` for how). Updated
  `docs/STATUS.md`'s feature table and limitations to match.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass.

### 2026-09-20 — fix: reachability monitor was tripping cluster intrusion detection

Real-world fallout from the LED feature above, caught within the same testing session: shortly
after using it against TestCluster, a genuine `Connect` attempt started failing with `ssh2`'s "Timed out
while waiting for handshake" - the TCP port was reachable (the LED was green), but the SSH
protocol handshake itself never completed.

- **Root cause**: the original `checkTcpReachable` opened a TCP connection and immediately
  destroyed it without ever speaking SSH - a bare "connect then hang up." That specific pattern
  makes `sshd` log `Did not receive identification string from <ip>`, which is the exact signature
  `fail2ban`/`sshguard` and most HPC-center intrusion detection use to identify port scanners. At
  a 20-second polling interval, that's ~30 "scanner-shaped" connections in a 10-minute window -
  comfortably past the default `fail2ban` sshd jail threshold (5 in 10 minutes) - so it's the
  most likely explanation for why a real connection attempt started timing out shortly after the
  monitor had been running for a while.
- **Fix**: `checkTcpReachable` now waits for the server's `SSH-2.0-...` identification banner and
  replies with one of its own before closing, the same "connect, read the banner, reply,
  disconnect" pattern used by standard SSH-aware monitoring tools (e.g. Nagios/Icinga's
  `check_ssh`) - recognizable as benign monitoring rather than a scan. Also raised the sweep
  interval from 20s to 60s, matching those tools' typical default check interval, as further
  headroom.
- Verified the fix in isolation (outside Electron, which this sandbox can't run) against three
  mock TCP servers: one that sends a real SSH banner and expects a reply (confirms it now behaves
  like a real client), one that accepts the connection but never sends anything (confirms it
  still correctly reports "unreachable" rather than hanging), and a closed port. All three
  matched expectations.
- **This fix prevents future occurrences but can't undo an existing block** - if a cluster's login
  node has already rate-limited or temporarily banned the connecting IP because of the old
  behavior, that block is outside this app's control; it should clear on its own after the
  cluster's ban window elapses (commonly 10 minutes to an hour), or sooner if its HPC support team
  lifts it directly.
