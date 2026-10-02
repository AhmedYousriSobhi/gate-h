# Gate-H — Current-State Architecture Baseline

**Part 1 of a modernization effort.** This document records what Gate-H actually does today,
verified against the code (file:line citations throughout), not what the docs or comments claim.
Where an existing doc has drifted from the code, that's called out explicitly rather than quietly
fixed — this is a baseline, not a refactor (see `docs/architecture/roadmap.md` for what comes
next).

## 1. Current architecture

Standard three-process Electron model, consistently followed:

```
Electron
├── main (src/main/)
│   ├── db.ts, clusters.ts, profiles.ts, settings.ts, secrets.ts   — persistence
│   ├── ssh/            manager.ts, connect.ts, knownHosts.ts      — SSH sessions, TOFU host keys
│   ├── azure/          tunnel.ts                                  — az CLI auth + tunnel lifecycle
│   ├── teleport/        session.ts, sessionState.ts               — tsh PTY + event-driven session tracking
│   ├── pty/            manager.ts                                 — node-pty wrapper (Teleport)
│   ├── scheduler/       exec.ts, slurm.ts, gpu.ts, monitor.ts,
│   │                    changes.ts, reuse.ts, submit.ts            — Slurm commands, polling, GPU, notifications
│   ├── grafana/         client.ts, embed.ts, gpu.ts                — Grafana REST + DCGM query
│   ├── jira/            client.ts                                  — Jira Cloud/Data Center REST
│   ├── monitor/         clusterMonitor.ts, reachability.ts,
│   │                    jiraMonitor.ts, concurrencyLimit.ts         — periodic sweeps
│   ├── notifications/   store.ts                                   — cross-cluster notification feed
│   ├── storage/         usage.ts                                   — df/lfs quota/mmlsquota
│   ├── files/           sftp.ts                                    — SFTP over existing session
│   ├── templates.ts, snippets.ts, sshConfigImport.ts, shellPath.ts
│   ├── userData.ts, index.ts                                       — app bootstrap
│   └── ipc/             one file per namespace (16 files; layout.ts
│                         deliberately bundles 4 related settings namespaces)
├── preload (src/preload/)
│   └── index.ts         — single narrow contextBridge surface (`window.api`), typed by GateHApi
└── renderer (src/renderer/src/)
    ├── hooks/           9 files — IPC-mediating hooks for a SUBSET of the API surface
    └── features/        shell/, terminal/, status/, clusters/, files/, templates/, toast/
                          grouped by domain, React state only
```

This structure map is accurate as of this audit. The one-IPC-file-per-namespace convention holds
with one acknowledged exception (`src/main/ipc/layout.ts` bundles `layout:*`/`statusLayout:*`/
`sidebarWidth:*`/`clusterOrder:*` — all thin `settings.ts` passthroughs, organized by "shell layout
persistence" rather than strict namespace-per-file).

**Shared types** live in `src/shared/types/{cluster,ui,index}.ts` (split earlier this session from
a single 842-line `types.ts`): `cluster.ts` holds per-cluster configuration shapes, `ui.ts` holds
pure UI-preference shapes, `index.ts` holds `GateHApi` plus domain/event types and re-exports both.

## 2. Current data flow

### Cluster connection (terminal)
`TerminalPanel.tsx:456` → `window.api.ssh.connect(id)` → preload → `ipc/ssh.ts` →
`openSshSession()` (`ssh/manager.ts:77-232`, optionally through an Azure tunnel or jump host, or
`openTeleportSession()` for Teleport via `node-pty`) → session stored in an in-memory `Map`
(`manager.ts:37,205`) → `stream.on('data')` pushes `ssh:data` over IPC → preload `onData` →
`TerminalPanel.tsx` writes to xterm.

### Slurm jobs/nodes
`SlurmSection.tsx:117` `window.api.scheduler.watch(id)` → `ipc/scheduler.ts:15` →
`watchScheduler()` (`scheduler/monitor.ts:255-279`) → `runOnCluster()` (`scheduler/exec.ts:201-215`,
one command in flight per cluster) → **reuses the terminal's existing `ssh2.Client`**
(`manager.ts:306-311`) via `client.exec()` — never opens a new connection or re-authenticates.
Commands come from `snapshotCommand()` (`scheduler/slurm.ts:50-59`, one chained
`squeue`+`sinfo`+`sinfo --list-reasons` exec per refresh), parsed by pure functions
(`slurm.ts:117-237`), pushed to the renderer over `scheduler:snapshot`.

### GPU telemetry — two sources, clearly disambiguated, never conflated
- **Grafana/DCGM** (preferred, when `cluster.grafana.gpuDatasourceUid` is set): `GpuUsage.tsx:57-76`
  → `grafana/gpu.ts:84-99` → Grafana `/api/ds/query`, no SSH involved.
- **`nvidia-smi` sample** (always available as a per-job button): `scheduler/gpu.ts:69-78` builds
  `srun --jobid=<id> --overlap --whole ... nvidia-smi`, run via the same `runOnCluster()` as every
  Slurm command — **inside the user's own job**, never directly on the login node and never a
  direct SSH to a compute node.

Both write into one `gpus` state (`GpuUsage.tsx:47`) labeled by a `source` string, so the UI never
shows stale/live ambiguity — this is the one place two sources overlap, and it's handled correctly.

### Azure authentication
`checkAzureAuth()` (`azure/tunnel.ts:143-168`) is a **one-shot, point-in-time check** — `az account
show` (reads cache) then `az account get-access-token` (validates liveness) — run once per connect
attempt, not a watched session. `az login` fires only from an explicit "Authenticate" click
(`TerminalPanel.tsx:803-819`), never automatically. Device-code vs. browser flow is chosen by
`needsDeviceCode()` detecting a missing `DISPLAY`/`WAYLAND_DISPLAY` (`tunnel.ts:172-174`).

### Reachability, notifications
Both are main-process-driven **pushes**, not renderer polls: `clusterMonitor.ts` sweeps every 60s
(concurrency-capped at 20) and pushes `reachability:update`; four independent producers
(reachability flips, Jira activity, unexpected SSH/Teleport closes, Slurm job/node changes) all
call the same `addNotification()` (`notifications/store.ts:47`), which pushes `notifications:created`.

### Verified: no React component executes SSH, parses Slurm/nvidia-smi output, or self-manages infra polling
Confirmed by reading every status/terminal component and grepping `window.api.` usage across
`src/renderer/src/features/`: all parsing lives in `src/main/scheduler/*.ts` and
`src/main/grafana/*.ts`; every renderer call goes through the typed `GateHApi` surface. The only
renderer-side timers are: `SlurmSection.tsx:126` (a 15s UI clock tick for a relative-time label, not
a data fetch), `StorageSection.tsx:99-130` (a real `setTimeout`-driven poll loop, but it only calls
`window.api.storage.usage()` — no local SSH/parsing), and `TerminalPanel.tsx`'s reconnect-backoff
timers (state machine, not infra access).

## 3. Current domain model

Entities in `src/shared/types/`: `Profile` → `Cluster`/`ClusterSummary` (connection + optional
Grafana/Jira/Azure/Teleport/Scheduler/Storage config) → `SchedulerSnapshot` (→ `SlurmJob`,
`SlurmPartition`, `SlurmNodeIssue`) and `GpuSample`, `StorageUsage`/`StorageQuota`,
`ClusterReachability`, `ClusterNotification`. UI-preference entities (`PanelLayout`, `StatusLayout`,
`OverviewViewMode`, sidebar width, `ClusterOrder`) are kept in a separate module (`types/ui.ts`) and
a separate persistence table (`app_settings`) from cluster configuration — confirmed consistent at
both the type layer and the DB layer (see §7).

## 4. Current HPC topology

**No login-node/cluster conflation found anywhere.** This was the audit's central HPC-correctness
question, and the answer is clean:

- `nvidiaSmiCommand()` (`scheduler/gpu.ts:69-78`) only ever samples a *running job's* compute nodes
  via `srun --overlap --whole`; `GpuUsage.tsx:91` returns nothing when there are no running jobs.
  There is no code path that runs `nvidia-smi` on the SSH-connected login node and presents it as
  cluster state.
- `ClusterReachability` (host/proxy-level: `status`/`checkedAt`/`latencyMs`) and `SchedulerSnapshot`
  (cluster/Slurm-level: jobs/partitions/node issues) are distinct types with distinct `status` enums
  (`ReachabilityStatus` vs `SchedulerStatus`), never merged into one "cluster status" object anywhere
  in the codebase — only combined visually, as separate props passed to separate UI sections.

**What *was* missing: a full cluster compute-inventory model.** The topology at the time of this
baseline was:

| Scope | Type | What it covers |
|---|---|---|
| Connection/login-node | `ConnectionProfile`, `JumpHostConfig`, `AzureTunnelConfig`, `TeleportConfig` | how to reach a node — not cluster compute state |
| Cluster | `Cluster`/`ClusterSummary` | identity + which integrations are configured |
| Partition | `SlurmPartition` | first-class: name, availability, total nodes, counts by state |
| Node | `SlurmNodeIssue` | **only problem nodes** (down/drained, from `sinfo --list-reasons`) — no full node inventory |
| GPU | `GpuSample` | **only GPUs of a running job's nodes** — no cluster-wide GPU capacity/allocation entity |
| Job | `SlurmJob`, `SlurmHistoryJob` | first-class |

There was nowhere in the type system or the UI that answered "this cluster has N nodes / M GPUs, Y%
allocated" as a standing fact — only "these specific nodes currently have a problem" and "these
specific GPUs belong to my running job." **Phase 2 (`docs/architecture/roadmap.md`) closed half of
this**: `SlurmNode[]` (full node inventory, from `sinfo -N`) and `totalGpuCapacity()` (summed from
each node's Slurm GRES config, not DCGM) now exist in `SchedulerSnapshot`/`scheduler/slurm.ts`. What
Phase 2 deliberately left open: a GPU *allocation* (in-use) figure, which needs either a validated
squeue GRES-per-job format or `scontrol show node`'s `AllocTRES` — neither attempted yet, flagged
rather than guessed at. Surfacing the new inventory in any UI is also still open (Phase 5).

## 5. Current data sources

| Information | Current source | Scope | Collection method | Refresh |
|---|---|---|---|---|
| Cluster reachability | TCP+SSH-banner probe / Teleport `/webapi/ping` | login-node/proxy | `monitor/reachability.ts:18-45,75-83`, fanned out by `clusterMonitor.ts:84-95` | 60s, 20 concurrent, 15s-floor refocus catch-up |
| Slurm jobs/nodes | `squeue`+`sinfo`+`sinfo --list-reasons` (one chained exec) | cluster | `scheduler/exec.ts` on the terminal's live session | 60s default/30s floor, only while selected+visible+live session+autoRefresh |
| GPU state | (a) Grafana DCGM `/api/ds/query`; (b) `srun ... nvidia-smi` | job's compute nodes | (a) `grafana/gpu.ts:84-99`; (b) `scheduler/gpu.ts:69-78` | (a) with every Slurm snapshot; (b) on-demand, 30s dedup |
| Storage quota | `df`+`lfs quota`/`mmlsquota` | per configured path | `runOnCluster`-based, same exec path | On request; optional 60s-floor/300s-default auto-refresh (renderer `setTimeout`) |
| Grafana dashboard health | Grafana HTTP API | per cluster | `grafana/client.ts` | Own backoff loop in `GrafanaStatusSection.tsx` |
| Jira issues | Jira REST (Cloud/Data Center) | per cluster project/JQL | `jira/client.ts` | Background sweep every 3 min (8 concurrent) + on-demand |

Only one overlapping pair exists (GPU via Grafana vs. via `nvidia-smi` sample), and it's correctly
disambiguated in the UI via a `source` label rather than silently preferring one.

## 6. Current polling model

| Sweep | Interval | Concurrency cap | Backoff | Focus-aware |
|---|---|---|---|---|
| `clusterMonitor.ts` (reachability) | 60s | 20 (`concurrencyLimit.ts`) | none (failed = offline, same cadence) | yes (15s-floor refocus catch-up) |
| `jiraMonitor.ts` | 3 min | 8 | none | **no** |
| `scheduler/monitor.ts` (foreground) | 60s default/30s floor | 1 active cluster by construction (only the selected+visible cluster polls) | doubles on failure, capped 5 min | yes (5 min when unfocused) |
| `scheduler/monitor.ts` `sweepBackground()` (open-but-backgrounded, notify-on) | 60s | **none found** | none | n/a |

**The one concrete scalability gap found**: `sweepBackground()` (`scheduler/monitor.ts:228-249`)
loops every cluster with `notify` enabled and a live connection, firing a `refresh()` for each due
cluster in the same tick, unconditionally — unlike the other two sweeps, it does not use
`runWithConcurrency`. In normal use this is bounded by how many clusters a user has open with a live
terminal *and* notifications on simultaneously (user-driven, not large by default), but at a large
open-fleet scale this is the one place the "N clusters × SSH exec every tick" pattern the audit
asked about could actually occur without a cap.

**Scaling estimate**:
- **1 cluster/10 nodes**: every path is trivially fine.
- **100 clusters**: reachability and Jira sweeps stay safe (concurrency-capped); scheduler
  foreground polling is naturally limited to one active cluster; `sweepBackground()` is the one
  path without a ceiling.
- **A cluster with 1000+ nodes**: node/partition data is pre-aggregated server-side by `sinfo`
  (healthy nodes are counts, not per-node rows) and the job table hard-caps at 2,000 rows with a
  surfaced `truncated` flag — Gate-H avoids the "N nodes × SSH" fan-out pattern entirely by
  construction, because it only ever runs one chained command per cluster per refresh, never one
  per node. The one real ceiling is GPU hostlist expansion, silently capped at 64 nodes
  (`scheduler/gpu.ts:12`) with **no truncation indicator** in the UI (unlike the job table's).

## 7. Authentication model

### SSH
- Auth methods (password/private-key+passphrase/agent) built in `buildConnectConfig`
  (`ssh/connect.ts:30-83`); jump host reuses the same three methods for its own leg.
- **Host-key verification is trust-on-first-use**, SHA-256 fingerprint keyed by `host:port`
  (`ssh/knownHosts.ts:21-40`), backed by the `known_hosts` SQLite table. A key mismatch **blocks the
  connection** (returns `false` to ssh2's `hostVerifier`, which rejects the handshake) and raises a
  persistent notification with context — it does not silently proceed. Recovery requires an
  explicit `forgetKnownHost()` call; no UI button calls it yet (acknowledged in `docs/STATUS.md`).
- Keepalive every 15s (`keepaliveInterval`/`keepaliveCountMax`, `ssh/connect.ts:47-48`) detects a
  silently-dropped path (e.g. Azure's 4-minute idle drops) within ~45s.
- **Retry/backoff policy lives in the renderer**, not main (`TerminalPanel.tsx:79-82,204-234`): 2
  attempts in a 2-minute rolling window, exponential backoff with jitter, then "paused" until either
  reachability flips online or a manual reconnect. This is a layering inconsistency worth noting —
  every other piece of reliability policy (reachability sweep, scheduler poll backoff) lives in the
  main process.
- **Error classification is lost before reaching the renderer**: ssh2 internally tags errors with a
  `.level` (`'client-authentication'`, `'client-timeout'`, `'handshake'`, etc.), but Gate-H never
  reads or forwards it — only `err.message` text crosses the IPC boundary, so auth failure, timeout,
  and host-key mismatch are distinguishable only by message text, not a stable code.
- Jump host is mutually exclusive with Teleport, explicitly enforced and explained in a code comment
  (`manager.ts:25-27,235-239`): every Teleport-routed node presents a certificate-format host key
  the `ssh2` package used here cannot verify at all (confirmed against a live Teleport v18 lab per
  `docs/STATUS.md`).

### Azure
One-shot pre-flight check (`checkAzureAuth`, `azure/tunnel.ts:143-168`), not a continuously watched
session — explicitly contrasted with Teleport's model below. Status enum `'valid'|'expired'|
'signed-out'|'cli-missing'` is differentiated in the UI with three distinct messages
(`TerminalPanel.tsx:805-812`), and the "Authenticate" button is hidden entirely when the CLI itself
is missing. `az login` only ever runs from an explicit click. Known Azure CLI bugs
(`azure-cli#28367` hung-tunnel, `azure-cli#24600` single-connection Bastion limit) are cited in code
comments and drive specific workarounds (tear down and replace a hung tunnel rather than reuse it).

### Teleport (for contrast)
Fully event-driven (`teleport/sessionState.ts`): `tsh status` runs at startup, on cluster-list
change, after a login dialog closes, and on an `fs.watch` of `~/.tsh` (500ms debounce) — never
polls. Per-session-group timers fire a 15-minute-before-expiry warning exactly once. This is the
structural opposite of Azure's point-in-time check, and the contrast is deliberate and already
well-documented in `docs/TELEPORT.md`/`docs/AZURE.md`.

## 8. Persistence model

- **Migrations**: additive-only, `columnExists()`-guarded `ALTER TABLE`s run unconditionally on
  every `getDb()` call (`db.ts`). No down-migration, no schema-version table — by design, documented
  tradeoff.
- **Secrets**: `electron.safeStorage` wrapper (`secrets.ts`) with **no plaintext fallback** — throws
  if encryption is unavailable rather than silently storing plaintext. Four encrypted columns
  (`connection_secret`, `jump_host_secret`, `grafana_token`, `jira_token`); `ClusterSummary` carries
  only `has*Secret` booleans, and the one function that can see plaintext
  (`clusters.ts:274-289`'s `getClusterSecrets()`) has an explicit "never expose this to the
  renderer" doc comment and is in fact only ever called from main-process SSH/Grafana/Jira code.
- **Corrupt/missing settings degrade to defaults, never throw**: every typed getter in
  `settings.ts` (`getPanelLayout`, `getStatusLayout`, `getClusterOrder`, `getSidebarWidth`, etc.)
  catches a parse/shape failure and falls back to a hardcoded default.
- **UI preferences vs. cluster config are cleanly separated** at both the type layer (§3) and the
  storage layer: UI preferences (`panelLayout`, `statusLayout`, `overviewViewMode`, `sidebarWidth`,
  `clusterOrder`, `activeProfileId`) live in the generic `app_settings` key/value table; per-cluster
  configuration lives in typed JSON columns on the `clusters` table. Nothing was found mixing the
  two.
- **Known dead column**: `clusters.keep_alive` — acknowledged dead in `docs/STATUS.md` itself ("the
  old per-cluster pin is gone, its `keep_alive` column stays, unread"); can't be cleanly dropped
  under the additive-only migration model.
- **Notifications**: persisted in a dedicated `notifications` table, capped at 200 rows
  (newest-first pruning on every insert), with per-item delete/clear-all/read tracking.

## 9. Main architectural issues, ranked

**Critical** — none found. HPC topology, secrets handling, host-key verification, and scheduler
safety limits (fixed commands only, validated partition names, one-command-in-flight, timeout +
output cap) are all sound.

**High**
1. `scheduler/monitor.ts`'s `sweepBackground()` has no concurrency cap, unlike every other periodic
   sweep in the app — the one place an unbounded "N clusters × SSH exec per tick" pattern could
   occur at a large open-fleet scale.
2. Most infrastructure-touching features (Slurm, GPU/DCGM, SFTP, job submit/cancel, storage quota)
   are explicitly documented (`docs/STATUS.md`) as never run against real infrastructure —
   typecheck/lint/build plus mocked-`window.api` screenshots are not a substitute for integration
   testing, and this matters specifically because the real endpoints are production HPC login
   nodes, not disposable test targets.
3. SSH error classification collapses to a raw message string before reaching the renderer — the UI
   can't react differently to "wrong password" vs. "network timeout" vs. "host key changed" beyond
   whatever substring happens to be in the text.

**Medium**
1. Inconsistent IPC-mediation layer: 9 renderer hooks exist for a subset of the API surface
   (notifications, profiles, reachability, scheduler snapshots, layout/order persistence), but ~15
   components call `window.api.*` directly for the larger surfaces (ssh, scheduler actions, azure,
   grafana, jira, files, templates, snippets, teleport, window controls).
2. SSH reconnect/backoff policy lives in the renderer (`TerminalPanel.tsx`) rather than alongside
   the rest of the app's reliability policy in the main process.
3. The same poll-with-exponential-backoff shape is independently reimplemented three times
   (`TerminalPanel.tsx` reconnect, `GrafanaStatusSection.tsx`, `StorageSection.tsx`) with no shared
   hook/helper — the fourth comparable case (`SlurmSection.tsx`) correctly avoids this by relying on
   a main-process push instead.
4. ~~No full cluster-level node/GPU inventory entity exists~~ **Closed by Phase 2**: `SlurmNode[]`
   (full node inventory) and `totalGpuCapacity()` (GPU count, from Slurm GRES) now exist (§4). GPU
   *allocation* (in-use count) remains open, and nothing surfaces the new inventory in the UI yet.
5. GPU hostlist expansion silently truncates at 64 nodes with no UI indicator, unlike the job
   table's surfaced 2,000-row truncation flag.
6. CI runs only on macOS (`.github/workflows/macos.yml`) despite Linux-first positioning and
   cross-platform packaging targets — zero Linux or Windows CI coverage.
7. `docs/HPC_ORCHESTRATION.md` has drifted from the current code in two small ways: its status
   banner undersells what's shipped (phases 1-6 are built per `docs/STATUS.md`, not just 1-3), and
   it names the scheduler DB column `scheduler_config` where the actual column is `scheduler`.

**Low**
1. Dead `clusters.keep_alive` column (already acknowledged in `docs/STATUS.md`).
2. No CSS-level responsive/breakpoint behavior — the app enforces a hard 640×480 minimum window
   size at the Electron level instead; a reasonable choice for a desktop app, not a bug.
3. `docs/STATUS.md`'s "No automated tests" line understates the real hand-rolled
   `scripts/*.checks.ts` + `test-pty-manager.mjs` suite that exists and runs in CI — it's not
   framework-based and isn't wired into an `npm test` script, but it's a genuine regression suite,
   not nothing.
4. Two functions in `teleport/sessionState.ts` are `export`ed but only used within their own file —
   cosmetic.

## 10. Environment correction (not a code issue — a tooling-knowledge correction)

**This environment can render a real Electron window.** `CLAUDE.md`'s documented gotcha ("no X
server, no sudo to install xvfb") is stale/incomplete and was repeated uncritically across this
entire session's prior PRs as the reason no live UI testing was possible. Verified directly today:
`DISPLAY=:1` is set, a real Xorg server is running (`xdpyinfo` responds, `/tmp/.X11-unix/X1`
exists), and the actual blocker is `ELECTRON_RUN_AS_NODE=1` being set in the environment, which
forces Electron to run as plain Node regardless of display availability. Running
`env -u ELECTRON_RUN_AS_NODE npm run dev` opened a real, correctly-rendered "Gate-H" window
(confirmed via a window-specific `xwd` capture decoded with PIL — not retained, since it showed the
user's real existing cluster profile data, which per standing practice never belongs in this repo).
This directly affects validation strategy for every future phase in the roadmap — see
`docs/architecture/roadmap.md`'s validation notes. **Recommend the user decide whether to correct
`CLAUDE.md`'s gotcha** — left as-is here since editing durable project instructions is outside this
baseline task's scope.

## Sources

Primary docs read in full for this baseline: `docs/ANALYSIS.md`, `docs/STATUS.md`,
`docs/HPC_ORCHESTRATION.md`, `docs/AZURE.md`. Code read directly or via delegated research covering
`src/main/**`, `src/preload/**`, `src/renderer/src/**`, `src/shared/types/**`, `package.json`,
`tsconfig*.json`, `eslint.config.mjs`, `.prettierrc.yaml`, `electron.vite.config.ts`,
`electron-builder.yml`, `.github/workflows/macos.yml`, `scripts/*`.
