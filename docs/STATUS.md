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
| Overview dashboard | ✅ Done | the default view (nothing selected) is a card grid (or a dense table, toggleable and persisted - `useOverviewViewMode`/`src/main/settings.ts`) of every cluster in the active profile - reachability, tags, Grafana/Jira badges, unread notification count, quick Connect/Status actions. A summary strip shows fleet counts plus running/pending job totals from already-cached Slurm snapshots (no new polling) |
| Cross-cluster notifications | ⚠️ Partial | bell icon covers reachability changes, Jira ticket activity, and unexpected SSH disconnects (all generic, cluster-agnostic signals). **Does not** cover scheduler-level events like Slurm node drains/downs - see the limitation below. |
| Automated tests | ❌ Not started | verification so far is `typecheck` + `lint` + `build` on every change, no unit/e2e suite yet |
| Multi-session terminal (tabs) | ✅ Done | any number of tabs/splits per cluster (`MainPanel.tsx`, `splitLayout.ts`). Switching clusters never disconnects: every opened cluster stays mounted with all its sessions until closed from the sidebar (inline second-click confirm when sessions are connected). In the background a cluster stops resizing its terminals, unmounts Status (no Grafana/Jira polling or embeds), and a dropped session pauses until the cluster is selected again. The old per-cluster pin is gone (its `keep_alive` column stays, unread). A profile switch closes every open cluster |
| Jump host with its own password | ✅ Done | its own stored, encrypted secret (`jump_host_secret`), independent of the target cluster's — falls back to reusing the target's secret only for pre-existing configs where it's unset and the auth methods happen to match |
| Azure tunnel pre-flight | ⚠️ Untested live | Per-cluster option: before SSH connects, `resources/azure-tunnel.sh` signs in with `az`, selects the subscription, and opens an Azure Bastion or `az ssh vm` tunnel. SSH then dials its local end (`src/main/azure/tunnel.ts`). Progress shows in the terminal. The tunnel is reopened on reconnect, replaced if a connect through it fails, and stopped on quit, edit, remove, or standby. The script is covered by `scripts/test-azure-tunnel.sh` against a fake `az`, but hasn't been run against real Azure. Linux/macOS only (needs bash; works with macOS's bash 3.2). See `docs/AZURE.md` |
| Teleport clusters in the terminal | ⚠️ Partial | Per-cluster option: the terminal runs `resources/teleport.sh ssh` on a local PTY (`node-pty`, `src/main/pty/manager.ts`). It checks for a tsh session and hands over to `tsh ssh`. A terminal never logs in by itself: with no session it shows *Teleport login needed*, and **Log in** opens a login dialog on its own PTY. One login resumes every terminal on that proxy. A notification and a **Renew** button appear 15 minutes before expiry. Session tracking (`src/main/teleport/sessionState.ts`) is event-driven, via a `~/.tsh` watch and one timer per session, and is covered by `scripts/teleport-sessions.checks.ts`. Reachability tracks the proxy's `/webapi/ping`. `PtyManager` and a real `tsh ssh` session are covered by `scripts/test-pty-manager.mjs` (run against a Teleport v18 lab). The form and status bar have not been exercised in a live window, and SSO login hasn't been tested live. Linux/macOS only (needs bash; works with macOS's bash 3.2, and needs `python3`). See `docs/TELEPORT.md` |
| macOS | ⚠️ Launches, cluster use untested | `.github/workflows/macos.yml` runs on Apple Silicon (`macos-15`) and Intel (`macos-15-intel`): typecheck, lint, the headless checks, and the script tests under macOS's own `/bin/bash` 3.2. It then packages an ad-hoc signed, un-notarized `.dmg`/`.zip` and smoke-tests the packaged app with `scripts/smoke-packaged-mac.sh`: the signature, plus better-sqlite3, ssh2 and node-pty (including its `spawn-helper`) loading from the asar and spawning a PTY. macOS code paths: the login shell's PATH (`src/main/shellPath.ts`), traffic lights instead of the custom window controls, an app menu (Cmd+C/V/Q), and the app staying live after its window closes. Terminals use Cmd+F / Cmd+\\ / Cmd+C/V. Published as the `v0.1.0` release (dmg and zip per chip). A person has built and launched it on a Mac and it works; adding a cluster and a real SSH session there is still untested. Not notarized (no Developer ID), so an IT-managed Mac may refuse to open it |
| Windows packaging | ⚠️ Untested | `electron-builder` config exists, but nothing has been built or run on Windows |
| SSH config import | ✅ Done | Read-only parser for `~/.ssh/config` and its `Include` files (`src/main/sshConfigImport.ts`); pick which hosts to bring in from a dialog. Host/port/user/identity file carry over; `ProxyJump`/`ProxyCommand` entries are flagged, not imported |
| Command snippets | ✅ Done | Per-profile saved commands, inserted into the active terminal session from a popover in its header (`src/main/snippets.ts`, `SnippetsDialog.tsx`) |
| Per-session connection log | ✅ Done | Every connect/reconnect/disconnect step for a session, timestamped, in a popover from the terminal header |
| Reachability latency | ✅ Done | The reachability probe's round-trip time, shown in the LED's tooltip (`ClusterReachability.latencyMs`) |
| Cluster form: connection mode | ✅ Done | No "Direct" choice to make - it's just the absence of the two independent, mutually-exclusive toggles "Azure tunnel" and "Teleport". A jump host is a separate, fixed-position checkbox composable with direct or Azure (`src/main/ssh/manager.ts` generalizes the existing forwardOut chaining to reach the jump host through whichever is picked, then hop to the final target); disabled for Teleport, the one case confirmed impossible at the protocol level (see below) |
| Cluster form: settings-style layout | ✅ Done | Replaced the one long scrolling column with a fixed left nav (Basics/SSH/Jump host/Azure/Teleport/Grafana/Slurm/Storage/Jira) and a single content pane showing only the active section - editing a cluster with several integrations configured no longer means scrolling past all of them. Each optional section's nav entry shows a dot when it's configured, without opening it. Save/Cancel sit outside the scrolling area. A save that fails validation switches to the section with the problem instead of leaving the error wherever the user happened to be |
| Jump host composed with Azure | ✅ Done | The tunnel reaches the jump host instead of the final target (`src/main/azure/tunnel.ts`) — same, well-exercised ssh2 chaining as Direct+jump-host |
| Jump host composed with Teleport | ❌ Not possible | Tried and confirmed broken against a live Teleport v18 lab, not just untested: `tsh proxy ssh` does hand `ssh2` a real duplex stream (the SSH handshake starts correctly), but every node Teleport can route to presents a certificate-format host key (`ecdsa-sha2-nistp256-cert-v01@openssh.com`), and the `ssh2` npm package has no support for certificate host keys at all (checked `node_modules/ssh2/lib/protocol/constants.js` — no `*-cert-v01@openssh.com` entries anywhere). Fails 100% of the time, before authentication is even attempted. Supporting it would mean patching or replacing the SSH library; out of scope here. The cluster form disables the jump-host toggle for Teleport rather than offering something that can't work |
| Slurm execution target | ✅ Done | Optional `scheduler.execTarget` (`src/main/scheduler/exec.ts`) runs squeue/sinfo/sacct on a different internal node than the terminal's own target, through one more forwarded ssh2 hop (or `tsh ssh --no-login` for a Teleport cluster, which doesn't hit the certificate issue above since it stays on tsh's own bare `ssh` path rather than a raw ssh2 socket) - for a bastion/login node that doesn't host Slurm itself |
| Azure tunnel: VM name, target-IP, subscription picker | ✅ Done | Bastion/`az ssh vm` accept a VM name (resolved to a resource ID at tunnel time) as an alternative to a resource ID, or a bare `--target-ip` for a target with no resource ID in reach; the subscription picker scopes every `az` call with `--subscription` instead of the process-wide `az account set`. See `docs/AZURE.md` |
| Teleport: skip certificate verification | ✅ Done | Per-cluster **Skip certificate verification** checkbox (`tsh`'s own `--insecure`), for a self-signed/lab proxy with no real CA to point `SSL_CERT_FILE` at; off by default. See `docs/TELEPORT.md` |
| macOS: SSL cert env adoption | ✅ Done | `adoptLoginShellPath()` also adopts `SSL_CERT_FILE`/`SSL_CERT_DIR` from the login shell at startup, the same way it already does `PATH`, so a Dock-launched app still sees an org CA exported in `.zshrc`/`.bash_profile` |

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
   The HPC orchestration screenshots (`slurm-status.png`, `storage-quota.png`,
   `file-transfer.png`, `job-templates.png`) were made the same way. The Status panel and the
   dialogs were rendered alone in headless Chromium at 1440×900, with sample Slurm, DCGM, Lustre
   and GPFS data.
3. **Not yet verified against real infrastructure**: an actual SSH server, a real Grafana
   instance, or a real Jira instance. If you have access to any of those, running `npm run dev`
   on a normal desktop and pointing Gate-H at them is the natural next verification step.

## Known limitations / near-term roadmap

- **HPC orchestration: built, not yet run against real infrastructure.** The design is in
  [HPC_ORCHESTRATION.md](./HPC_ORCHESTRATION.md) and the requirements in
  [SPEC.md §3.10](../SPEC.md#310-hpc-orchestration). The widget picker's old
  "coming soon" entries are gone: everything they previewed has shipped.
  Phases, each its own issue, branch and PR (1 to 3 shipped together):

  | # | Feature | Status | Approach |
  |---|---|---|---|
  | 1 | Scheduler config + safe command runner | ✅ Done | `SchedulerConfig` per cluster; fixed commands on the terminal's existing `ssh2` connection (`client.exec()`), or a non-interactive `tsh ssh` for Teleport; timeout, output cap, one command in flight per cluster; unit-tested parsers |
  | 2 | **Job queue** (Slurm) | ✅ Done | Slurm section of the Status widget (`features/status/SlurmSection.tsx`). One chained `squeue`+`sinfo` run per refresh; polls only while the cluster is selected and Status is showing (60 s default, 30 s floor, backoff to 5 min); manual refresh on Teleport by default; job arrays collapsed, expandable on demand. Verified by `scripts/slurm.checks.ts` and `scripts/scheduler-monitor.checks.ts`; **not yet run against a real Slurm cluster** |
  | 3 | **Node health** (Slurm) | ✅ Done | `sinfo` per-partition state counts plus `sinfo --list-reasons` for down/drained nodes, from the same poll |
  | 4 | **GPU usage** | ✅ Done | Per-GPU cards in the Slurm section for running jobs' nodes. Grafana `/api/ds/query` on DCGM exporter metrics with the existing token (new optional Grafana settings: datasource UID, node label), or an on-demand `srun --overlap --whole … nvidia-smi` sample inside the user's own job. Covered by `gpu.checks.ts` (hostlists, parsers, an HTTP round trip to a stand-in Grafana); **not yet run against real DCGM metrics or `srun`** |
  | 5 | **File transfer** (SFTP) | ✅ Done | *Files* dialog from the cluster panel's toolbar (`features/files/FilesDialog.tsx`): browse, download, upload with progress. One `client.sftp()` channel per existing connection; local paths only from native dialogs in main; confirms before overwriting. Not for Teleport clusters yet (`tsh scp`). Covered by `sftp.checks.ts` against a fake SFTP channel; **not yet run against a real SFTP server** |
  | 6 | **Job templates + submit/cancel** | ✅ Done | *Job templates* dialog (`features/templates/`): per-profile `job_templates` table, `{{name:default}}` placeholders, a review of the rendered script, then `sbatch --parsable` with the script on stdin (works on Teleport too). A cancel button on the user's own jobs runs `scancel --user="$(id -un)"`. Both are confirmed in a native dialog by the main process. Covered by `submit.checks.ts` and `scheduler-exec.checks.ts` (stdin over both paths) |
  | — | **Slurm notifications** | ✅ Done | Opt-in per cluster; snapshot diffs (`scheduler/changes.ts`) plus one `sacct` for final states; background check every 5 min on the open cluster's existing connection, never on Teleport. Covered by `slurm.checks.ts` and `scheduler-monitor.checks.ts` |
  | — | **Job history** | ✅ Done | `sacct` for the user's own allocations over 24 h or 7 days, on request only (`SlurmHistory.tsx`); reuses the phase 1 runner |
  | — | **Storage quota** | ✅ Done | Per-cluster `storage.paths`; on request, one command per refresh: `df` per path plus `lfs quota` (Lustre) or `mmlsquota -Y` (GPFS), picked by `stat -f`. Reuses the phase 1 runner. Covered by `storage.checks.ts`, which runs the real command in a local bash; the Lustre/GPFS parsers are checked against recorded output only |
  | — | PBS/LSF | 💡 Idea | `SchedulerConfig.kind` leaves room; not designed |

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
- **Scheduler event detection is Slurm-only and opt-in**. Job finished/started and node
  down/drained notifications exist for Slurm (see
  [HPC_ORCHESTRATION.md §5.1](./HPC_ORCHESTRATION.md#51-notifications)), but not for PBS/LSF. They
  only fire while the cluster is open, since the background check reuses its terminal's
  connection rather than opening one, and never on Teleport clusters.
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
- **A jump host can't be layered on a Teleport connection** — confirmed against a live Teleport v18
  lab: every node Teleport routes to presents a certificate-format host key, and the `ssh2` package
  this app uses has no certificate-host-key support at all. The cluster form doesn't offer the
  combination; see the entry above.
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
