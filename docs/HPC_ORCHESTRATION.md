# HPC orchestration: design

Status: **proposed, nothing built yet.** This is the design for Gate-H's next features: a Slurm
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
features/scheduler/              window.api.scheduler    ipc/scheduler.ts
  JobQueueWidget.tsx  ── subscribe(clusterId) ──►          │
  NodeHealthWidget.tsx ◄─ onSnapshot(snapshot) ──        scheduler/monitor.ts   (who polls, when)
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
| `src/main/ipc/scheduler.ts` | `subscribe` / `unsubscribe` / `refresh` handlers | the one-file-per-namespace IPC pattern |
| `src/renderer/src/features/scheduler/` | the Job queue and Node health widgets | `WidgetPicker.tsx` (the roadmap entries become real toggles), the panel layout |

### 2.1 Configuration

A cluster gains one optional field, mirrored end to end the way `activeMonitoring` is:

```ts
interface SchedulerConfig {
  kind: 'slurm'              // PBS/LSF would add kinds later; nothing else is designed for them yet
  scope: 'mine' | 'all'      // squeue --me (default) or the whole queue
  partitions?: string[]      // limit squeue/sinfo to these partitions
  intervalSec: number        // default 60, minimum 30
}
```

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
  login. **Each run is a new Teleport session and shows up in the cluster's audit log**, so
  Teleport clusters default to manual refresh, and automatic refresh is off until the user turns
  it on.
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

- `--me` becomes `--all` (and `--format` gains `%u`) when `scope` is `all`. `--partition=` is
  added when partitions are configured.
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
5. for Teleport, the user has turned on automatic refresh.

Cadence:

- **Default 60 s, minimum 30 s.** That is the same cadence as the reachability probe, and far
  below what `slurmctld` sees from `watch squeue`.
- **Failure backoff:** the interval doubles on each consecutive failure, capped at 5 minutes, the
  same as Grafana (`GRAFANA_MAX_REFRESH_BACKOFF_MS`). It resets on a success or when reachability
  flips back to online.
- **Manual refresh** is throttled to once every 10 s.
- **Unfocused window:** when the window loses focus, polling stretches to 5 minutes, and it catches
  up once on refocus, as reachability already does. A queue nobody is looking at doesn't need
  refreshing every minute.
- **Nothing runs in the background, and nothing runs when no widget is visible.** Snapshots are
  kept in memory per cluster, so switching back shows the last result straight away, marked with
  its age, while a fresh one loads.

Notifications stay out of v1. Detecting job completions or node drains means diffing snapshots,
which only works while the widget is polling, and a notification that only fires while you're
looking at the queue isn't worth having. Once the snapshot shape has settled, the natural next
step is `kind: 'scheduler'` notifications for *your job finished or failed* and *a partition's
nodes went down or drained*, backed by the same poll.

## 6. What the user sees

**Job queue widget.** A table of jobs: ID, partition, state, elapsed and limit, nodes, expected
start or reason, and name. It can be filtered by state, and counts by state are shown above it.
It is read-only in v1. A job ID can be copied, and *Show in terminal* types
`scontrol show job <id>` into the active terminal tab **without pressing Enter**, so the user
stays in control of what runs.

**Node health widget.** One row per partition: availability, node counts by state
(idle/mixed/allocated/down/drained), and the drain reasons from `sinfo --list-reasons`, with
problems listed first.

Both widgets show the snapshot's age, a manual refresh button, and the states from §4. They are
added to the panel layout the same way Status is: toggled from the widget picker, and kept mounted
(but unsubscribed) while hidden.

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
| 2 | `scheduler/monitor.ts` and the Job queue widget | 1 |
| 3 | Node health widget | 2 |
| 4 | Native GPU widget via Grafana `/api/ds/query`, plus the on-demand `srun … nvidia-smi` sample | 2 |
| 5 | SFTP panel | — |
| 6 | Batch templates and confirmed `sbatch`/`scancel` | 2, 5 |

## 10. Open questions

- **Teleport audit noise:** is manual-only refresh acceptable by default, or should a site be able
  to allow automatic refresh for all its clusters?
- **`scope: 'all'` on large sites:** the whole queue can run to tens of thousands of lines. Should
  v1 support only `--me` and partition-scoped views?
- **Job arrays:** show `123_[1-500]` collapsed, as `squeue` does by default, or expand them
  (`--array`)?
- **PBS/LSF:** keep `kind` open for them, but hold off until a user needs them.
