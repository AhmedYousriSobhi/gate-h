# HPC orchestration: design

Status: **phases 1 to 3 (the Slurm job queue and node health) are built; the rest is proposed.**
This is the design for Gate-H's next features: a Slurm
job queue and node view, GPU and node telemetry, and later a file transfer panel and a job
submission helper. [SPEC.md §3.10](../SPEC.md#310-hpc-orchestration-planned) states the
requirements; [STATUS.md](./STATUS.md#known-limitations--near-term-roadmap) tracks progress.

The Slurm module is designed in detail here. GPU telemetry, file transfer and job submission are
covered at the level needed to see how they fit, and each gets its own detailed design before it
is built.

## 1. Constraints this design has to respect

These come from what Gate-H already promises, not from Slurm:

1. **No extra load on shared infrastructure** (SPEC §4). `squeue` and `sinfo` are RPCs to
   `slurmctld`, which every user on the cluster shares. A desktop app that polls it for every
   open cluster, all day, is exactly what HPC admins rate-limit and complain about.
2. **Background clusters stay quiet** (SPEC §3.6). An open cluster that isn't selected runs no
   Grafana polling today; the scheduler has to follow the same rule.
3. **Standby means no connections at all.** A cluster with `activeMonitoring: false` must not run
   a single scheduler command.
4. **No new logins.** Many clusters need MFA, a Teleport login or an Azure tunnel. A widget that
   opens its own SSH connection would either prompt again or quietly fail.
5. **The renderer never builds commands.** It has no Node access (`src/preload/` is the only
   bridge), and it must not be able to make the main process run arbitrary shell text.

## 2. Where the pieces go

```
renderer                         preload                 main
features/status/                 window.api.scheduler    ipc/scheduler.ts
  SlurmSection.tsx    ── watch(clusterId) ─────►           │
   (queue + nodes)    ◄─ onSnapshot(snapshot) ──         scheduler/monitor.ts   (who polls, when)
                                                           │
                                                         scheduler/slurm.ts     (fixed commands + parsers)
                                                           │
                                                         scheduler/exec.ts      (run on the live session)
                                                           ├─ ssh2: client.exec() on the existing Client
                                                           └─ Teleport: teleport.sh ssh --no-login -- … <cmd>
```

| Layer | New code | Reuses |
|---|---|---|
| `src/shared/types.ts` | `SchedulerConfig`, `SlurmJob`, `SlurmPartition`, `SlurmNodeIssue`, `SchedulerSnapshot`; a `scheduler` namespace on `GateHApi` | `Cluster`, `ClusterSummary` |
| `src/main/db.ts` | one additive column, `scheduler_config TEXT` (JSON, nullable), guarded by `columnExists()` | the existing migration pattern |
| `src/main/scheduler/exec.ts` | runs one fixed command on the cluster's live session, with a timeout and an output cap | the `Client` held in `ssh/manager.ts`'s `sessions` map; `teleport/session.ts`'s `scopeArgs()` |
| `src/main/scheduler/slurm.ts` | the command strings and their parsers | nothing; pure functions, which makes this the first code in Gate-H that is easy to unit test |
| `src/main/scheduler/monitor.ts` | decides when to poll, backs off on failure, pushes snapshots | the backoff shape in `GrafanaStatusSection.tsx` |
| `src/main/ipc/scheduler.ts` | `watch` / `unwatch` / `refresh` / `arrayTasks` handlers | the one-file-per-namespace IPC pattern |
| `src/renderer/src/features/status/SlurmSection.tsx` | the job queue and node health, as a section of the Status widget | `StatusPanel.tsx`, next to Grafana and Jira |

### 2.1 Configuration

A cluster gains one optional field, mirrored end to end the way `activeMonitoring` is:

```ts
interface SchedulerConfig {
  kind: 'slurm'                    // the only kind; no PBS/LSF abstraction until someone needs it
  scope: 'mine' | 'partitions'     // squeue --me, or every user's jobs in `partitions`
  partitions: string[]             // required for 'partitions'; an optional filter for 'mine'
  intervalSec: number              // default 60, minimum 30
  autoRefresh: boolean             // default on, except on Teleport clusters (see §3)
}
```

There is no "whole queue" scope. On a large site, `squeue --all` can return tens of thousands of
rows, and parsing and rendering them would cost more CPU and memory than the rest of Gate-H put
together. Every user's jobs are only shown for named partitions.

`null` means the cluster has no scheduler integration, which is the default, so existing clusters
behave exactly as before. There are no secrets: every command runs as the SSH user on the session
that is already authenticated.

## 3. Running commands: `scheduler/exec.ts`

**The rule: a scheduler command only ever runs on a session the user already opened.** It never
opens a connection of its own.

- **SSH and Azure clusters.** `ssh2` multiplexes channels over one connection, so the command runs
  as `client.exec()` on the same `Client` that carries the terminal. That means no new TCP
  connection, no new authentication, and no MFA prompt. The Azure tunnel is already under that
  client, so it is covered too.
- **Teleport clusters.** The terminal is `tsh ssh` on a PTY, so there is no client to share. The
  command runs as a separate non-interactive `teleport.sh ssh --no-login -- login@node '<cmd>'`,
  and only while the Teleport session is valid (`teleport/sessionState.ts`). It never triggers a
  login. **Each run is a new Teleport session and shows up in the cluster's audit log.** Polling
  every minute would add well over a thousand routine `squeue` entries a day to the site's
  security logs, so Teleport clusters default to manual refresh (`autoRefresh: false`). Users can
  opt in per cluster.
- **No live session** (terminal closed, paused, or not yet connected): nothing runs. The widget
  says *Waiting for a terminal session* and resumes when one connects.

Safety limits on every run:

- **Fixed commands only.** The IPC surface takes a `clusterId`, never command text. Commands are
  built in `slurm.ts` from constants; the only configurable input is partition names, which are
  validated against `^[A-Za-z0-9_.-]+$` and then passed as a single-quoted argument.
- **One command at a time per cluster.** OpenSSH's default `MaxSessions` is 10, and terminal tabs
  already use some of those channels. The scheduler never holds more than one extra channel per
  cluster.
- **15 s timeout and 1 MiB output cap.** Past either limit the channel is closed and the run
  counts as a failure. A hung `slurmctld` must not leave channels piling up.
- Commands run with `LC_ALL=C`, so the time and number formats the parsers read are predictable.

## 4. What runs: `scheduler/slurm.ts`

One refresh sends **one** `exec` that chains the queries, so a refresh costs one channel, not
three:

```sh
LC_ALL=C squeue --me --noheader --format='%i|%P|%T|%M|%l|%D|%S|%R|%j'
echo '@@gateh@@'
LC_ALL=C sinfo --noheader --format='%R|%a|%D|%T'
echo '@@gateh@@'
LC_ALL=C sinfo --noheader --list-reasons --format='%N|%T|%E'
```

- With `scope: 'partitions'`, `--me` is dropped, `--format` gains `%u`, and `--partition=` is
  always set. With `scope: 'mine'`, `--partition=` is added only when partitions are configured.
- **Job arrays stay collapsed**, the way `squeue` shows them by default (`123_[1-500]` is one row),
  which keeps the table short. Expanding an array row runs one on-demand
  `squeue --array --jobs=<id>` for that array's tasks. The ID is validated as digits only, and
  the result is reused for 30 s, so expanding and collapsing a row doesn't cost a run each time.
- **At most 2,000 jobs are parsed** per refresh. Past that, the snapshot is marked truncated and
  the widget suggests narrowing the partitions.
- **Free text goes last.** The job name (`%j`) and the drain reason (`%E`) can contain `|`, so the
  parser splits on the first N−1 delimiters only.
- **Why not `squeue --json`:** it needs Slurm 21.08 or later, built with a JSON data-parser
  plugin, and many sites don't have that. The delimited format works on every Slurm version still
  in use. `--json` can be added later as an optional fast path, detected once per session.
- `%S` is the expected start time for pending jobs, which gives the *wait time* the roadmap asks
  for without running `squeue --start` separately.
- **Errors map to states, not stack traces.** A missing `squeue` becomes *No Slurm on this login
  node*. A `slurmctld` timeout or a rate-limit reply becomes *Scheduler busy, retrying in N
  minutes* and counts toward backoff.

The parsers are pure `(stdout: string) => T` functions. They are the natural place to add Gate-H's
first unit tests, using recorded `squeue`/`sinfo` output from real sites.

## 5. When it runs: `scheduler/monitor.ts`

The monitor lives in the main process, like `monitor/clusterMonitor.ts`, so polling doesn't depend
on React effect timing and there is one poll per cluster however many widgets are showing it.

A cluster is polled only while **all** of these are true:

1. it has a `SchedulerConfig`,
2. it is not in standby,
3. it is the selected cluster, and a Job queue or Node health widget is visible (the renderer
   subscribes when the widget mounts visibly and unsubscribes when it is hidden, backgrounded or
   unmounted),
4. it has a live session (§3), and
5. `autoRefresh` is on. With it off, the only runs are ones the user starts with the refresh
   button, and the first snapshot after the section opens.

Cadence:

- **Default 60 s, minimum 30 s.** That is the same cadence as the reachability probe, and far
  below what `slurmctld` sees from `watch squeue`.
- **Failure backoff:** the interval doubles on each consecutive failure, capped at 5 minutes, the
  same as Grafana (`GRAFANA_MAX_REFRESH_BACKOFF_MS`). It resets on a success.
- **Manual refresh** is throttled to once every 10 s.
- **Unfocused window:** when the window loses focus, polling stretches to 5 minutes, and it catches
  up once on refocus, as reachability already does. A queue nobody is looking at doesn't need
  refreshing every minute.
- **Nothing runs in the background, and nothing runs when no widget is visible.** Snapshots are
  kept in memory per cluster, so switching back shows the last result straight away, marked with
  its age, while a fresh one loads.

### 5.1 Notifications

Each cluster can opt in with `notify`. Change detection (`scheduler/changes.ts`) compares each new
snapshot against the last good one and raises `kind: 'scheduler'` notifications for:

- **your jobs that left the queue.** One `sacct --jobs=…` call gets their final state (completed,
  failed with its exit code, hit the time limit, cancelled, out of memory). Without accounting
  storage, they're reported as having left the queue;
- **your pending jobs that started**, with the nodes they started on;
- **nodes newly down or drained**, with the reason.

It only compares the user's own jobs. Collapsed array rows are skipped, because their IDs change as
tasks start, and truncated snapshots are skipped, because a missing row there doesn't mean the job
left. More than three changes of one kind become a single summary. The first snapshot is only a
baseline.

A notification that only fires while you're looking at the queue isn't worth much. So with
`notify` on, an **open cluster in the background** keeps being checked, but only under these
limits:

- on the SSH connection its terminal already holds. With no live connection (the cluster is
  closed, or in standby) nothing runs;
- every 5 minutes at most, or the cluster's interval if longer, backing off to 30 minutes on
  failures;
- never on Teleport clusters, where each run would be an audited session.

A once-a-minute in-memory sweep (`sweepBackground`) decides which clusters are due. One refresh per
cluster is in flight at a time, shared by the foreground and background paths, so a change is never
reported twice.

## 6. What the user sees

The queue and node health are a **Slurm section of the Status widget**, next to Grafana and Jira,
rather than separate panes. The panel layout holds exactly two panes, and a cluster's scheduler
state belongs with its other status. The section is subscribed only while the Status widget is
showing, and the widget picker's *Job queue* and *Node health* roadmap entries are dropped.

**Job queue.** Counts by state, then a table of jobs: ID, partition, state, elapsed and limit,
nodes, expected start or reason, and name (and user, for partition scope). It is read-only.
An array row expands to show its tasks.

**Node health.** One row per partition: availability and node counts by state, plus the down and
drained nodes from `sinfo --list-reasons` with their reasons.

The section shows the snapshot's age, a refresh button, and the states from §4.

### 6.1 Job history

Below the node health, **History** lists the user's own allocations from the last 24 hours or 7
days (`sacct --user … --allocations --parsable2 --starttime=now-<N>days`), newest first, with
state, exit code, elapsed time and end time. `sacct` reads `slurmdbd`, not `slurmctld`, and there's
no reason to poll it, so it only runs when a range button is clicked. Like array tasks, a repeat
within 30 s reuses the last result. Sites without accounting storage show `sacct`'s own error.

### 6.2 Storage quota

A cluster can list paths (`storage.paths`, e.g. `~`, `/scratch/$USER`), and the Status widget's
**Storage** section checks them on request. One command covers every path. For each one it reads
the filesystem type with `stat -f -c %T`, the whole filesystem's usage with `df -Pk`, and the user's
own quota:

- on Lustre, `lfs quota -q -u "$(id -un)" <path>`;
- on GPFS/Spectrum Scale, `mmlsquota -u … -Y --block-size 1K`, a machine-readable format that is
  read by header name.

Other filesystems get `df` only. Paths are validated against `[A-Za-z0-9_./~-]` plus `$USER` and
`$HOME`, then double-quoted, with a leading `~` rewritten to `$HOME`. Quota tools hit the
filesystem's metadata servers and nothing there changes minute to minute, so this never polls, and a
repeat within 30 s reuses the result. Usage over the soft limit (the start of the grace period) is
flagged, not just usage near the hard limit.

## 7. GPU and node telemetry (outline)

The **preferred source is Grafana**, because many GPU sites already run NVIDIA's
[DCGM exporter](https://github.com/NVIDIA/dcgm-exporter) into Prometheus. That costs the cluster
nothing extra, and Gate-H already holds a Grafana token for the cluster.

1. **Embedded panels.** This works today: pick the site's DCGM dashboard panels in the Status
   widget.
2. **Native GPU widget, backed by Grafana.** The main process queries Grafana's
   `/api/ds/query` with the existing service-account token, for `DCGM_FI_DEV_GPU_UTIL`,
   `DCGM_FI_DEV_FB_USED` and `DCGM_FI_DEV_GPU_TEMP`, filtered to the nodes of the user's running
   jobs from the Slurm snapshot. The renderer draws compact per-GPU bars. The token stays in main
   as it does now. This needs one new setting per cluster: the Prometheus datasource UID.
3. **Fallback over SSH, on demand only.** For sites without DCGM:
   `srun --jobid=<id> --overlap --ntasks-per-node=1 nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits`,
   run against one of the user's **own running jobs**, only when the user clicks *Sample GPUs*.
   It never polls, and it never SSHes into compute nodes directly, which many sites forbid.
   Login nodes usually have no GPU, so running `nvidia-smi` there tells you nothing.

Node-level CPU, memory and load stay with Grafana (node exporter). Gate-H won't build a second
metrics pipeline.

## 8. File transfer and job submission (outline)

- **SFTP panel.** `ssh2`'s `client.sftp()` on the same shared `Client`, so no new login, as in §3.
  It covers browsing, upload, download and transfer progress. Teleport clusters would need
  `tsh scp` and are out of the first version.
- **Batch script templates.** A local library of `#SBATCH` templates, stored in SQLite and
  scoped per profile, with placeholders filled in through a form. Submitting uploads the script
  over SFTP, shows the full rendered script and the exact `sbatch <path>` command, and runs it
  only on an explicit confirm. `scancel` would follow the same rule: only the user's own jobs,
  and only after confirmation.

Both change SPEC §5, which today keeps job management out of scope. SPEC §3.10 now says what's
allowed: reading is automatic, and writing always needs an explicit confirmation.

## 9. Delivery plan

Each phase is one GitHub issue, one branch and one PR, following the repo convention.

| Phase | Scope | Depends on |
|---|---|---|
| 1 | `SchedulerConfig` end to end (type, column, form, IPC), `scheduler/exec.ts` with its limits, `slurm.ts` parsers with unit tests | — |
| 2 | `scheduler/monitor.ts` and the job queue | 1 |
| 3 | Node health | 2 |

Phases 1 to 3 ship as one PR, because phase 1 on its own would add code nothing calls yet.
| 4 | Native GPU widget via Grafana `/api/ds/query`, plus the on-demand `srun … nvidia-smi` sample | 2 |
| 5 | SFTP panel | — |
| 6 | Batch templates and confirmed `sbatch`/`scancel` | 2, 5 |

## 10. Decisions

These were open questions, now settled for v1:

- **Teleport audit noise.** Refresh is manual by default on Teleport clusters, because each run
  is an audited session. Automatic refresh is an opt-in per cluster (`autoRefresh`).
- **Large queues.** There is no whole-queue scope. The options are `--me`, or every user's jobs in
  named partitions, with a 2,000-row parse cap as a backstop.
- **Job arrays.** Collapsed by default, as `squeue` shows them. A row expands on demand to list its
  tasks.
- **PBS/LSF.** Not now. `kind: 'slurm'` leaves room in the type, but there is no scheduler
  abstraction until a real user asks for one.
