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
  connect to a real HPC cluster. Feedback from that session drove this and the following changes.
  (The specific cluster's identity/hostnames are deliberately not recorded anywhere in this repo.)
- Renamed the product from "H-Gate" to "Gate-H" everywhere: the in-app header, `package.json`
  (`name`, `description`), `electron-builder.yml` (`appId`, `productName`, `win.executableName` -
  the packaged AppImage is now `Gate-H-<version>.AppImage`), the `<title>` tag (previously still
  the electron-vite template default, never actually set), the `HGateApi` → `GateHApi` TypeScript
  interface, and every mention across `README.md`/`CHANGELOG.md`/`docs/*.md` and the Docker
  image/volume names in `build-desktop.sh`.
- **Protected existing user data across the rename**: Electron was deriving the userData directory
  (where the cluster database lives) from the old `hgate` package name, so renaming it outright
  would have made the app start looking in a new, empty directory - silently "losing" a real
  user's already-saved clusters (including the one from the testing session above).
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
after using it against a real cluster, a genuine `Connect` attempt started failing with `ssh2`'s
"Timed out while waiting for handshake" - the TCP port was reachable (the LED was green), but the
SSH protocol handshake itself never completed.

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
- Unconfirmed either way: the tester's follow-up attempt was made without the VPN connection
  needed to reach that cluster at all, so whether the original timeout was really a ban versus
  something else couldn't be re-tested. The scanner-signature bug above is real and worth fixing
  regardless of which explanation was correct for this specific incident.

### 2026-09-20 — privacy cleanup: scrubbed the real test cluster's identity from history

The manual testing described in the last few entries above was done against one of the tester's
own real HPC clusters. Its name, hostnames, and username were never meant to be kept anywhere -
they'd only ended up in this repo (in prose, and rendered into the README preview
screenshots/GIFs) because the tester's own screenshot was used as reference material while fixing
bugs. Once flagged, the identifying details were removed properly rather than just edited out of
the current files:

- Rewrote every commit's message and file content across **all local branches** (via
  `git-filter-repo`) to replace the cluster's name and organization with generic placeholders -
  this is a real history rewrite (every commit got a new hash), not just a new commit papering
  over old ones, so the identifying strings aren't recoverable from this repo's history either.
- Fully purged every historical version of `docs/assets/` (the only place the identity appeared
  in binary, non-text form - baked into rendered screenshots/GIFs) rather than trying to redact
  pixels, then regenerated the entire README preview (all screenshots and all three procedure
  GIFs) from scratch using fully fictional sample data (`Frontier-Dev`, `login.frontier.example.org`,
  `demo-user`, etc.) - the same generic placeholders used before real-cluster testing ever
  happened.
- The prose in the last few changelog entries above was reworded by hand afterward to read
  naturally without the mechanical placeholder text the history rewrite left behind, while still
  keeping the substance of what was learned (real user, real cluster, real bugs found and fixed).
- **What this can't reach**: this repo's own git history and working tree are clean, but the
  identifying details were also visible earlier in this project's chat conversation, which lives
  outside this repository - scrubbing that is outside what a code change can do.

### 2026-09-20 — `feature/minimalist-redesign`

A full visual pass, grounded in current UI/UX research (Linear's design-token approach - near-black
surfaces, a single chromatic accent, a tight 4px spacing scale, Inter at an in-between "510" weight
- and the minimalist/graphical direction of tools like Raycast and Termius) rather than tweaking
colors ad hoc.

- **Design tokens** (`assets/base.css`): replaced the scattered `--ev-*` variables with a real
  token set - layered near-black surfaces (`--color-bg` → `--color-surface-active`), a single blue
  accent (`--color-accent`, matching the existing app icon) reserved for interactive/active
  elements, semantic online/offline/checking colors reserved for status only, a 4px spacing scale,
  and a 6/10/14px radius scale. Old `--ev-*` names are kept as aliases so nothing broke mid-migration.
- **Typography**: self-hosted Inter (`@fontsource-variable/inter`) at `font-weight: 510` for UI
  text (Linear's signature "between regular and medium" weight) and JetBrains Mono
  (`@fontsource/jetbrains-mono`) for hostnames/connection strings, both bundled locally rather than
  loaded from Google Fonts/a CDN - this is a desktop app that should render its own UI correctly
  with no network access.
- **Iconography**: replaced every unicode glyph and emoji (✎, ✕, 📊, 🎫) with real SVG icons from
  `lucide-react` - tree-shakeable, MIT-licensed, `currentColor`-based so they follow the theme.
- **Sidebar**: each cluster now gets a colored monogram avatar (deterministic per name, like a
  Slack/Linear workspace icon) with its reachability LED as a small badge on the avatar itself
  instead of a separate dot; the active row gets a left accent bar instead of just a background
  tint; the "checking" LED now pulses.
- **Status panel**: Jira issues get a status-colored pill (accent for "in progress", green for
  "done", neutral for "to do") instead of one flat gray pill for every status; health badges and
  links got matching icons.
- **Terminal panel**: status bar now shows a small colored connection-state dot plus the
  connection string in monospace, and the xterm instance itself uses JetBrains Mono and an accent
  cursor color to match the rest of the app.
- Regenerated the README preview screenshots/GIFs against the redesigned UI (same headless-browser
  pipeline as before).
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass; the two new font
  packages add ~350KB of bundled `.woff2`/`.woff` assets (only the subsets actually used get
  fetched at runtime) and `lucide-react` tree-shakes to only the ~15 icons actually imported.

### 2026-09-20 — `feature/notifications`

Added a cross-cluster notification bell, per a follow-up request for something like "tell me when
a cluster's connection drops, a related Jira ticket changes, or a node gets drained" - implemented
the first two generically since H-Gate can observe them for any cluster; deliberately did not fake
the third (see the limitation recorded in `docs/STATUS.md` - real node-drain detection needs
H-Gate to run scheduler-specific commands like `sinfo` remotely, which is a separate feature).

- **Notification store** (`src/main/notifications/store.ts`): an in-memory, capped (200) feed with
  `addNotification`/`listNotifications`/`markNotificationRead`/`markAllNotificationsRead`, plus a
  settable broadcaster so any main-process module can push a live event to the renderer without
  importing Electron/IPC concerns directly.
- **Reachability transitions** (`clusterMonitor.ts`): now tracks each cluster's last *settled*
  status separately from the transient "checking" state, so a genuine online→offline or
  offline→online flip fires a notification - without this, comparing against the immediately-prior
  "checking" entry would mean the transition never matches and nothing would ever fire.
- **Jira activity** (new `src/main/monitor/jiraMonitor.ts`): polls every 3 minutes (Jira's API is
  heavier/more rate-limit-sensitive than the reachability TCP probe) per cluster with a Jira
  profile configured, diffing against last-seen issue status to notify on new tickets and status
  changes - silently baselining on each cluster's first sweep this run so opening the app with
  existing tickets doesn't fire a wall of "new ticket" notifications.
- **Unexpected SSH disconnects** (`src/main/ssh/manager.ts`): distinguishes an app-initiated
  disconnect (switching clusters, quitting) from the remote end dropping the connection on its own,
  via an `intentionalCloses` set checked in the stream's `close` handler - only the latter
  notifies, so routine cluster-switching doesn't spam "connection lost" messages.
- **UI**: a bell icon (with an unread-count badge) in the sidebar header opens a dropdown of
  recent notifications; clicking one marks it read and jumps to the relevant cluster (and, for
  Jira/SSH notifications, the relevant tab) - which meant lifting the Terminal/Status tab state
  up from `MainPanel` into `AppShell` so a notification click can control it.
- Caught and fixed two CSS bugs while screenshotting this for real: the notification panel's text
  wasn't wrapping (`.notification-item-body` needed `flex: 1` to actually claim row width instead
  of shrinking to content), and the whole dropdown was getting silently clipped at the sidebar's
  edge because `.sidebar` had `overflow: hidden` - changed to `visible` since only the inner
  `.cluster-rows` list actually needs its own scroll.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass, and visually
  confirmed the bell/badge/dropdown via the same headless-browser + mocked-data pipeline used for
  the README screenshots.

### 2026-09-20 — `feature/jira-guide-and-auto-label`

A follow-up request asked for a tutorial on connecting Jira, and - the real underlying question -
how to tell multiple clusters' tickets (and eventually Confluence pages) apart when each cluster
has its own distinct login/compute/controller hostnames that don't make sense as a shared key.

- **Added `docs/JIRA_GUIDE.md`**: step-by-step Jira Cloud/Data Center setup, a dedicated section
  explaining why hostnames aren't the right cross-tool identifier (they differ per cluster and
  even per node-type within a cluster) and why the cluster's own Gate-H name is, JQL recipes for
  the common cases (shared project split by label/component, dedicated project per cluster,
  open-only, node-specific), and an honest status check on Confluence: not integrated - no
  client/auth/UI exists - with a no-code-change workaround (put the link in the cluster's
  description) and the intended future pattern (label-based page search, mirroring Jira) rather
  than pretending it works today.
- **Added `src/shared/clusterSlug.ts`** (`toClusterSlug`): normalizes a cluster's name into a
  Jira-label-safe slug, shared between the renderer and main process rather than duplicated.
- **`ClusterForm`**: the Default JQL field now shows a live example placeholder built from the
  cluster's own name (e.g. `project = HPC AND labels = "frontier-dev"` for a cluster named
  "Frontier-Dev"), plus a hint explaining the shared-project gotcha, so the guide's advice is
  visible right where you'd need it instead of only in a doc.
- **Auto-labeling on ticket creation**: `createJiraIssue` now tags new tickets (filed via the
  Status tab's "Create ticket") with the cluster's own slug as a label, so tickets created through
  Gate-H already satisfy the recommended JQL without the user tagging them by hand. Falls back to
  creating the ticket without the label if a Jira project's create screen doesn't have a Labels
  field configured, rather than failing ticket creation over a nice-to-have.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass, and unit-tested
  `toClusterSlug` directly against several inputs (including empty/symbols-only and non-ASCII
  names). Could not verify the auto-label behavior against a real Jira instance (none reachable in
  this sandbox) - the fallback-on-failure path means a misconfigured Jira project degrades to the
  previous (unlabeled) behavior rather than breaking ticket creation, but that path itself is
  also unverified against a real API response.

### 2026-09-20 — fix: double-clicking the title bar didn't maximize the window

Root cause: on Linux, double-click-to-maximize on a *native* title bar is handled entirely by the
window manager/compositor, not by Electron - it's inconsistent across WMs and, on at least some
Wayland setups, doesn't fire for Electron windows at all. There was no reliable way to fix this
while still using the OS-native frame.

- **Went frameless** (`frame: false` on the `BrowserWindow`) and added a custom title bar
  (`src/renderer/src/features/shell/TitleBar.tsx`) with its own minimize/maximize/close buttons
  and a draggable region (`-webkit-app-region: drag`), so this now works identically everywhere
  instead of depending on window-manager behavior. Double-clicking the drag region (but not the
  buttons themselves) calls the same toggle-maximize path as the maximize button.
- Added `window:minimize` / `window:toggleMaximize` / `window:close` / `window:isMaximized` IPC
  (`src/main/ipc/window.ts`) and a `window:maximized-changed` event so the maximize button's icon
  reflects the real window state (including when maximized/restored via the OS, e.g. a keyboard
  shortcut or snapping to a screen edge).
- Set `minWidth`/`minHeight` on the window - frameless windows lose the OS's usual minimum-size
  affordance along with the rest of the native chrome.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass. Verified the
  double-click → toggle → icon-swap logic end-to-end via the headless-browser pipeline (with a
  mock that actually simulates the maximized-state-changed round trip, unlike a bare stub).
  **Could not verify actual OS-level window maximizing** - that only happens in a real window
  manager, which this sandbox doesn't have; this needs confirming on a real desktop.

### 2026-09-20 — fix: cluster didn't auto-reconnect after VPN came back

Reported after real testing: a cluster's SSH session had dropped, and after reconnecting the VPN,
Gate-H kept showing it as closed until "Reconnect" was clicked by hand - it should have noticed
the cluster was reachable again on its own.

- **`useReachability`** can now take an `onTransition` callback that fires once per genuine
  online↔offline flip (not the transient "checking" state, and not the first reading). `AppShell`
  uses it to bump a `reconnectSignal` counter - but only when the transition is for the currently
  *selected* cluster and specifically offline→online.
- **`TerminalPanel`** watches that signal and, if its session is currently sitting `closed`,
  retries exactly once. This is a single nudge, not a retry loop: a second offline→online flap
  while already connected does nothing, since there's nothing to nudge - verified directly (see
  below), which also means it can't turn into repeated connection attempts against the cluster.
- **Caught up faster on refocus**: added `triggerImmediateSweepIfStale()` to
  `clusterMonitor.ts`, called when the window regains focus (e.g. switching back to Gate-H right
  after turning a VPN on) - but only if at least 15 seconds have passed since the last sweep, so
  alt-tabbing in and out repeatedly can't increase how often a cluster gets probed beyond the
  normal 60-second cadence.
- To be clear about what "reachable" already means here: the existing reachability probe
  (`src/main/monitor/reachability.ts`, from the earlier fix) already does a real check - it
  connects, waits for the SSH server's identification banner, and replies with one - not a bare
  ping. This fix is about *reacting* to that check's result automatically, not about the check
  itself being more thorough.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass. Verified the full
  scenario end-to-end via the headless-browser pipeline with a mock that counts `ssh:connect`
  calls: selecting a cluster connects once (StrictMode's dev-only double-invoke aside - that
  doesn't happen in production builds), an unexpected close then an offline→online transition
  triggers exactly one more connect and lands on "connected" with no click, and a *second*
  offline→online flap while already connected triggers zero further connects. **Could not verify
  against a real cluster or real VPN** - only the transition-handling logic itself, via mocked
  reachability events.

### 2026-09-20 — `feature/profiles`: profiles and an overview dashboard

Two more requests, implemented together since the dashboard is naturally profile-scoped: "a
profile mode where each profile has its own dashboard and clusters" and "an intro dashboard
showing all connected clusters."

- **Data model** (`src/main/db.ts`, new `src/main/profiles.ts`): added a `profiles` table and an
  `app_settings` key/value table (for the active profile id), and a `profile_id` column on
  `clusters`. Written as a migration that runs on every launch but only ever does real work once:
  it creates a default "Personal" profile if none exist, backfills any cluster with no
  `profile_id` into it, and points `activeProfileId` at a real profile - so an existing install
  upgrading into this doesn't lose or orphan any clusters. Verified directly against a real
  better-sqlite3 database (not just typechecked): ran the exact migration SQL against a simulated
  pre-profiles database, confirmed it backfills correctly, is idempotent (running it twice doesn't
  duplicate anything), and that deleting a profile cascades to its clusters and reassigns the
  active profile if needed.
- **Scoping**: `clusters:list` (what the sidebar/dashboard show) is now scoped to the active
  profile; a new cluster is assigned to whichever profile is active when it's created. Deliberately
  left the reachability and Jira monitors watching *every* cluster in *every* profile regardless of
  which is active, so notifications keep arriving for a profile you're not currently looking at.
- **`ProfileSwitcher`**: a dropdown in the sidebar (replacing the static "Gate-H" label) to switch
  profiles, and create/rename/delete them - deleting warns how many clusters will go with it via
  `profiles:countClusters`, and refuses to delete the last remaining profile.
- **`OverviewDashboard`**: the new default view (nothing selected) - a card grid of every cluster
  in the active profile with its reachability LED, tags, configured integrations, unread
  notification count, and Connect/Status actions, plus a summary line (N clusters · N online · N
  unreachable). A pinned "Overview" row above the cluster list gets back to it at any time.
- Regenerated all README screenshots against the new UI (title bar + profile switcher are now
  visible in every shot).
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass; visually confirmed
  the dashboard and profile switcher (including the create-profile form) via the headless-browser
  pipeline. **Not verified**: switching between two profiles that actually have different clusters
  end-to-end in a real running app (the mock used for screenshots doesn't re-filter clusters by
  profile) - the underlying scoping logic is the same `listClustersByProfile` query exercised in
  the migration test above, but the full round trip through Electron IPC is unverified here.

### 2026-09-20 — `fix/connection-hardening-and-cleanup`: SSH hardening + memory/cleanup pass

A general code review across clean code, memory, and HPC-specific SSH connection practices,
rather than a single reported bug.

- **SSH keepalive** (`src/main/ssh/manager.ts`): every connection (target and jump host) now sets
  `keepaliveInterval: 15000` / `keepaliveCountMax: 3`. ssh2 sends no keepalive at all by default,
  which matters specifically for HPC clusters: login nodes are commonly reached through a VPN or
  behind a firewall/NAT that silently drops idle connections, so without this a session can sit
  showing "connected" for a long time after the underlying connection is actually dead - the same
  problem OpenSSH's `ServerAliveInterval` exists to solve.
- **Host key pinning** (new `src/main/ssh/knownHosts.ts`, new `known_hosts` SQLite table): ssh2
  also does *no host verification* by default - it completes a handshake with whatever host key a
  server presents, unlike every real SSH client (OpenSSH, PuTTY), which is a real exposure for a
  tool that manages cluster credentials over a network. Added trust-on-first-use pinning: the
  first connection to a `host:port` records the SHA-256 fingerprint of its host key, and every
  connection after that must present the same one; a mismatch is refused and surfaces a
  notification explaining it could mean a legitimate reinstall or a man-in-the-middle. Verified
  directly against a real `better-sqlite3` database: first-use trust, repeat-match, and
  mismatch-detection (and that a mismatch doesn't silently re-trust) all confirmed, plus that
  different hosts/ports are tracked independently.
- **Fixed a dead/leaked error listener**: `connectClient()`'s internal `.on('error', reject)`
  handler was never removed once the connection succeeded, so it sat attached for the session's
  entire life, silently no-op'ing (`reject()` on an already-settled promise does nothing) instead
  of visibly reporting later errors. Now removed the moment the promise settles. This meant the
  jump host's connection previously had *no* real error visibility after connecting; it now logs
  jump-host errors explicitly (the forwarded stream closing already notifies the user; this adds
  the specific reason to the console for debugging) and, just as importantly, keeps a listener
  attached at all - an SSH `Client` is an `EventEmitter`, and an `'error'` event with zero
  listeners throws and crashes the whole main process.
- **Guarded `WebContents.send` calls in the SSH manager** against a destroyed window: `ssh:data`/
  `ssh:closed`/`ssh:error` could still fire from a session's streams after the window that owns
  them was destroyed (e.g. quitting while a session was mid-teardown), and `send()` on a destroyed
  `WebContents` throws. Added a `safeSend()` helper (`sender.isDestroyed()` check) used at every
  call site - the reachability/notification broadcasters in `src/main/index.ts` already did this;
  the SSH manager didn't.
- **Bounded the renderer's notification list**: the main process caps its notification feed at
  200 (`src/main/notifications/store.ts`) but broadcasts every new one regardless of that cap, so
  `useNotifications.ts`'s `[notification, ...prev]` had no matching bound and would grow without
  limit over a very long-running session. Capped it to the same 200.
- **Removed duplicated fetch logic** in `useProfiles.ts`: the initial-load effect and `refresh()`
  each had their own copy of the same "fetch list + active id, then set state" code; extracted the
  shared `fetchProfiles()` helper.
- Verified `npm run typecheck`, `npm run lint`, and `npm run build` all pass. **Not verified**:
  actual keepalive/host-key behavior against a real SSH server or a real man-in-the-middle - only
  the TOFU pinning logic itself (against a real database) and that the config values are wired
  through correctly.
