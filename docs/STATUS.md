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
| Sidebar + panel shell | ✅ Done | persistent cluster sidebar (no scrolling away to "go back"); a main panel with Terminal/Status tabs per selected cluster |
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
| Multi-session terminal (tabs) | ❌ Not started | only one SSH session open at a time currently; switching clusters in the sidebar disconnects the previous session |
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
   on a normal desktop and pointing Gate-H at them is the natural next verification step.

## Known limitations / near-term roadmap

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
- **Single terminal session** — selecting a different cluster in the sidebar disconnects whichever
  SSH session was open; there's no way yet to keep two clusters connected simultaneously in
  separate tabs. The natural next step is a session switcher, reusing the existing `ssh:*` IPC
  channels (they're already keyed by `sessionId`, so the main-process side mostly just needs the
  renderer to track more than one) and keeping each `TerminalPanel` mounted (not unmounted) when
  its cluster isn't the active sidebar selection.
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
