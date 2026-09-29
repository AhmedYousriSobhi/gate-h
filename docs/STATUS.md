# Project status

This page is the detailed, point-in-time status of Gate-H: what's implemented, how it was
verified, and what's deliberately deferred. For the chronological build log (what changed, in
what order, and why), see [CHANGELOG.md](../CHANGELOG.md). For architecture and the prior-art
research behind the design decisions, see [ANALYSIS.md](./ANALYSIS.md).

## Version: v0.1 (initial build)

The core loop works end-to-end: add a cluster → connect to it over SSH → view its Grafana status
→ view/file its Jira tickets — all inside one standalone Electron app, with no browser involved.
As of this update, a real user tried v0.1 against one of their own HPC clusters and gave feedback
that directly shaped the sidebar layout, live LEDs, and terminal-close behavior below. (Exact
cluster identity/hostnames from that testing session are deliberately not recorded anywhere in
this repo or its history.)

| Area | Status | Notes |
|---|---|---|
| Multi-cluster registry | ✅ Done | SQLite-backed (`better-sqlite3`), add/edit/remove, per-cluster tags |
| SSH connection profiles | ✅ Done | password / private key (+ passphrase) / SSH agent, optional jump host |
| SSH keepalive & host key pinning | ✅ Done | SSH-level keepalive (`keepaliveInterval`/`keepaliveCountMax` in `src/main/ssh/manager.ts`) so idle sessions through a VPN/firewall are detected as dead instead of sitting falsely "connected"; trust-on-first-use host key verification (`src/main/ssh/knownHosts.ts`) refuses to connect - and notifies - if a host's key ever changes, the same model as OpenSSH's `known_hosts` |
| Secrets storage | ✅ Done | `electron.safeStorage` (OS keychain, e.g. libsecret on Linux) — never round-tripped to the renderer |
| Sidebar + panel shell | ✅ Done | persistent cluster sidebar (no scrolling away to "go back"); a main panel showing a selected cluster's widgets |
| Dynamic split-pane widgets | ✅ Done | Terminal and Status render side by side (or stacked) instead of behind tabs (`src/renderer/src/features/shell/MainPanel.tsx`); a toolbar lets you swap pane order, flip orientation, and toggle either widget via a picker (`WidgetPicker.tsx`) that also previews planned widgets - see the roadmap below. Both widgets stay mounted even when hidden, so toggling Terminal off never disconnects its SSH session. The layout itself is persisted (`src/main/settings.ts`) and restored on the next launch |
| Live reachability monitoring | ✅ Done | main process TCP-probes every cluster's SSH port on a timer (`src/main/monitor/`); sidebar shows a green/red/gray LED per cluster, always up to date |
| Embedded SSH terminal | ✅ Done | `ssh2` + `@xterm/xterm`; closes cleanly to a "closed" state with a Reconnect button instead of a stuck full-page view; one session at a time |
| Grafana status | ✅ Done | health check, per-dashboard title/link, panel snapshot image if `grafana-image-renderer` is installed |
| Jira issues | ✅ Done | list via JQL, file new tickets (auto-labeled with the cluster's own identity, see `docs/JIRA_GUIDE.md`); supports both Jira Cloud (email + API token) and Data Center (PAT) |
| Confluence integration | ❌ Not started | no client/auth/UI exists; `docs/JIRA_GUIDE.md` documents a no-code-change workaround (link in the cluster's description) and the intended future pattern (search by the same cluster-identity label Jira uses) |
| Linux packaging | ✅ Done | AppImage via `electron-builder`, built reproducibly inside Docker (`./build-desktop.sh`) |
| App icon / branding | ✅ Done | custom mark, see `resources/icon.svg`; product renamed H-Gate → Gate-H after user feedback |
| Visual design system | ✅ Done | token-based dark theme (`assets/base.css`), self-hosted Inter/JetBrains Mono, `lucide-react` icons throughout - see the redesign entry in `CHANGELOG.md` |
| Custom title bar | ✅ Done | frameless window with its own minimize/maximize/close + double-click-to-maximize, fixing a Linux window-manager inconsistency where the native title bar's double-click-to-maximize didn't work |
| Profiles | ✅ Done | clusters belong to a profile (`profiles`/`app_settings` tables, migrated in automatically for existing installs); switch/create/rename/delete from the sidebar. Reachability and Jira monitoring watch every cluster in every profile regardless of which is active - only the sidebar/dashboard view is scoped |
| Overview dashboard | ✅ Done | the default view (nothing selected) is a card grid of every cluster in the active profile - reachability, tags, Grafana/Jira badges, unread notification count, quick Connect/Status actions |
| Cross-cluster notifications | ⚠️ Partial | bell icon covers reachability changes, Jira ticket activity, and unexpected SSH disconnects (all generic, cluster-agnostic signals). **Does not** cover scheduler-level events like Slurm node drains/downs - see the limitation below. |
| Automated tests | ❌ Not started | verification so far is `typecheck` + `lint` + `build` on every change, no unit/e2e suite yet |
| Multi-session terminal (tabs) | ✅ Done | any number of tabs/splits per cluster (`MainPanel.tsx`, `splitLayout.ts`). Switching clusters never disconnects: every opened cluster stays mounted with all its sessions until closed from the sidebar (inline second-click confirm when sessions are connected). In the background a cluster stops resizing its terminals, unmounts Status (no Grafana/Jira polling or embeds), and a dropped session pauses until the cluster is selected again. The old per-cluster pin is gone (its `keep_alive` column stays, unread). A profile switch closes every open cluster |
| Jump host with its own password | ⚠️ Partial | only supported when the jump host uses the *same* auth method as the target cluster (see the note in `src/main/ssh/manager.ts`) — a jump host needing an independent password isn't wired up yet |
| Azure tunnel pre-flight | ⚠️ Untested live | Per-cluster option: before SSH connects, `resources/azure-tunnel.sh` signs in with `az`, selects the subscription, and opens an Azure Bastion or `az ssh vm` tunnel. SSH then dials its local end (`src/main/azure/tunnel.ts`). Progress shows in the terminal. The tunnel is reopened on reconnect, replaced if a connect through it fails, and stopped on quit, edit, remove, or standby. The script is covered by `scripts/test-azure-tunnel.sh` against a fake `az`, but hasn't been run against real Azure. Linux/macOS only (needs bash). See `docs/AZURE.md` |
| Teleport clusters in the terminal | ⚠️ Partial | Per-cluster option: the terminal runs `resources/teleport.sh ssh` on a local PTY (`node-pty`, `src/main/pty/manager.ts`). It checks for a tsh session and hands over to `tsh ssh`. A terminal never logs in by itself: with no session it shows *Teleport login needed*, and **Log in** opens a login dialog on its own PTY. One login resumes every terminal on that proxy. A notification and a **Renew** button appear 15 minutes before expiry. Session tracking (`src/main/teleport/sessionState.ts`) is event-driven, via a `~/.tsh` watch and one timer per session, and is covered by `scripts/teleport-sessions.checks.ts`. Reachability tracks the proxy's `/webapi/ping`. `PtyManager` and a real `tsh ssh` session are covered by `scripts/test-pty-manager.mjs` (run against a Teleport v18 lab). The form and status bar have not been exercised in a live window, and SSO login hasn't been tested live. Linux/macOS only (needs bash). See `docs/TELEPORT.md` |
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
   on a normal desktop and pointing Gate-H at them is the natural next verification step.

## Known limitations / near-term roadmap

- **Planned per-cluster widgets** — the widget picker (puzzle-piece icon on a cluster's panel)
  already lists these as disabled "coming soon" entries; none exist yet, and each needs a real
  backend (either a scheduler client run over the existing SSH session, or its own API), not just
  a UI addition. Roughly in order of expected value, based on what HPC-specific monitoring stacks
  (Slurm-web, Grafana's Slurm dashboards, XDMoD) surface that Gate-H doesn't yet:
  - **Job queue** — pending/running jobs and wait times (`squeue`/`qstat`/`bjobs`).
  - **GPU usage** — per-node GPU utilization, memory, and temperature.
  - **Storage quota** — home/scratch usage vs. quota (`lfs quota`, `df`, GPFS `mmlsquota`).
  - **Node health** — partition/node up, down, and drained state (`sinfo`/`pbsnodes`).
  - **Job history** — completed job accounting, runtime, exit code (`sacct`).
- **No drag-to-resize between panes** — the side-by-side/stacked split is a fixed 50/50 today
  (`src/renderer/src/features/shell/shell.css`, `.panel-pane`); a draggable divider is a natural
  follow-up once there's demand for uneven splits.
- **Panel layout is a single global preference, not per-cluster** — swapping panes or hiding a
  widget applies to whichever cluster you look at next too. It's saved to disk (`app_settings`
  table, `src/main/settings.ts`) and restored on the next launch, but that's one layout for the
  whole app; making it remember a different layout per cluster is future work, not a limitation
  discovered by testing so much as scope deliberately kept small for now.
- **Can't move a cluster between profiles** — a cluster is assigned to whichever profile was
  active when it was created, and there's no "move to another profile" action yet; the only way is
  to delete it and re-add it under the target profile (re-entering its SSH/Grafana/Jira details).
- **No scheduler-level event detection (e.g. Slurm node drains)** — deliberately not implemented
  yet, rather than faked. The notification bell's signals (`src/main/monitor/clusterMonitor.ts`,
  `jiraMonitor.ts`, `src/main/ssh/manager.ts`) are all things H-Gate can observe generically across
  any cluster: is the SSH port up, did a Jira ticket change, did an open session drop. Detecting
  "node X went into drain state" would mean H-Gate itself periodically running a non-interactive
  command like `sinfo`/`pbsnodes`/`bhosts` over SSH and parsing scheduler-specific output - a
  real, separate feature (and one that varies by scheduler: Slurm/PBS/LSF each report this
  differently) rather than a small addition to the existing monitors.
- **Reachability is an SSH-banner probe, not a real health check** — `src/main/monitor/reachability.ts`
  checks every 60 seconds (plus an on-refocus catch-up, throttled to at most once per 15s) whether
  the SSH port opens *and* actually speaks SSH (see the "fixed" entry in `CHANGELOG.md` for why
  it's not a bare TCP connect); a cluster behind a firewall that blocks the probe but is otherwise
  fine would show red, and a host with an SSH-shaped banner but a broken daemon behind it would
  show green. It's a reasonable proxy for "can I probably SSH in right now" - not a substitute for
  the actual Grafana-based health data on the Status tab. When the currently open cluster's
  session is closed and its reachability flips back to online, `TerminalPanel` retries the
  connection once automatically (see the auto-reconnect entry in `CHANGELOG.md`).
- **No way to un-pin a host key from the UI yet** — if a cluster's login node is legitimately
  reinstalled (its host key changes on purpose), `forgetKnownHost()` in
  `src/main/ssh/knownHosts.ts` exists to clear the old pinned key, but nothing in the UI calls it
  yet; today the only way to recover from an expected key change is to delete the row from the
  `known_hosts` SQLite table directly. A "trust this new key" button on the connection-refused
  error is the natural next step.
- **Jump host secret reuse** — see `src/main/ssh/manager.ts`; a jump host with a different
  password than the target cluster needs its own stored secret, which the data model doesn't
  have a field for yet.
- **Grafana snapshots need the image-renderer plugin** — without it, Gate-H falls back to just
  the dashboard title and an "Open in Grafana" link. A future iteration could let a cluster point
  at specific panel IDs instead of just dashboard UIDs, for a more compact status view.
- **No automated tests** — the project has been verified manually (typecheck/lint/build, plus the
  headless-browser screenshot pipeline for UI changes) rather than with a test suite. Adding one
  (component tests for the renderer, and integration tests for the main-process SSH/Grafana/Jira
  clients against local mock servers) is the biggest gap before this could be called production-ready.
- **`.deb` packaging is dropped for now** — electron-builder's `.deb` target (via `fpm`) requires
  a `homepage` field in `package.json`, and there's no public repo/homepage URL for this project
  yet to put there truthfully. Only `AppImage` is built until one exists; re-adding `deb` to
  `linux.target` in `electron-builder.yml` plus a real `homepage` field is a one-line change once
  it does.
- **Reproducible builds via Docker** — done: `./build-desktop.sh` builds a pinned Node +
  native-module toolchain image (`docker/build.Dockerfile`) and runs the actual build inside it,
  bind-mounting the repo rather than baking source into the image, so editing code never requires
  rebuilding the image. It deliberately does **not** run the packaged *app* itself in Docker - a
  GUI app inside a container needs finicky X11/Wayland socket forwarding and would undermine the
  "standalone desktop app" goal - only the build toolchain is containerized. The container runs as
  the host user (`--user "$(id -u):$(id -g)"`) so `dist/` output is host-owned, and `node_modules`
  plus the npm/electron-builder download caches live in named Docker volumes (never bind-mounted
  from the host), so it can't collide with a `node_modules` used for local `npm run dev`.
