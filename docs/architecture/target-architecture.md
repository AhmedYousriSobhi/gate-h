# Gate-H — Target Architecture (proposed, not implemented)

This describes where Gate-H's architecture should move, grounded in what already exists (see
`current-state.md`) rather than a generic template. **Nothing here is implemented yet** — this is
the target that `roadmap.md`'s phases work toward, each independently and incrementally.

## Why this and not a bigger rewrite

The current-state audit found no Critical issues, no HPC-correctness conflation, no circular
dependencies, and a scheduler module (`src/main/scheduler/`) that already implements the target
pattern correctly for one slice of the app. The target below is mostly **"make the rest of the app
consistent with the one part that's already right,"** not a new architecture invented from
scratch. Concretely: `scheduler/exec.ts` + `scheduler/slurm.ts` + `scheduler/monitor.ts` already
separate *running a command* from *parsing its output* from *deciding when to poll* — that three-way
split is the target pattern, generalized.

## Conceptual layering

```
UI (React components)
  ↓  props only, no window.api calls
Domain/Application State (renderer hooks — src/renderer/src/hooks/)
  ↓  one hook per IPC surface, always, never bypassed
IPC bridge (src/preload/, src/main/ipc/) — already consistent, unchanged
  ↓
Collection/Normalization (src/main/<provider>/*.ts — exec/run + parse, pure functions)
  ↓
Infrastructure Providers:  SSH (ssh2/node-pty) · Slurm (exec over SSH) · DCGM/Prometheus (via Grafana)
                            · Grafana · Jira · Azure CLI · Teleport (tsh)
```

**What changes, concretely, per layer:**

### UI layer
No structural change needed — components are already thin where they're pushed data (e.g.
`SlurmSection.tsx` via `onSnapshot`). The target is that this becomes true everywhere, by fixing the
layer below it.

### Domain/Application State (renderer hooks)
Target: **every** `window.api.*` surface gets a hook, not just notifications/profiles/
reachability/scheduler-snapshots/layout. Concretely, extend the existing `hooks/` pattern to cover:
`ssh` (connection lifecycle + reconnect/backoff — currently inline in `TerminalPanel.tsx`), `azure`
(auth state + tunnel status — currently inline), `grafana` (status fetch + backoff — currently
inline in `GrafanaStatusSection.tsx`), `storage` (currently inline in `StorageSection.tsx`), `files`,
`templates`, `snippets`, `teleport`. Each new hook follows the exact shape `useReachability.ts`/
`useSchedulerSnapshots.ts` already establish: subscribe on mount, unsubscribe on unmount, expose
state + a narrow action surface, no business logic beyond that.

This single change also resolves two Medium findings at once: the reconnect/backoff state machine
moves out of `TerminalPanel.tsx` into a `useSshSession` (or similar) hook, and the three
independently-reimplemented poll-backoff loops (`TerminalPanel`, `GrafanaStatusSection`,
`StorageSection`) collapse into one shared backoff helper the new hooks all call — rather than a
fourth bespoke implementation of the same shape.

### Collection/Normalization (main process)
Already the right shape in `scheduler/`; target is to make every provider look the same:

| Provider | Exec/run (already exists or target) | Parse (already exists or target) | Poll policy (already exists or target) |
|---|---|---|---|
| Slurm | `scheduler/exec.ts` ✅ | `scheduler/slurm.ts` ✅ | `scheduler/monitor.ts` ✅ |
| GPU (DCGM) | `grafana/gpu.ts` ✅ | same file ✅ | driven by Slurm snapshot cadence ✅ |
| GPU (nvidia-smi) | `scheduler/gpu.ts` ✅ | same file ✅ | on-demand, reuse-cached ✅ |
| Storage | `storage/usage.ts` ✅ | same file ✅ | **target**: move the renderer's `setTimeout` loop (`StorageSection.tsx`) into a main-process monitor, matching `scheduler/monitor.ts`'s shape, so storage polling stops being the one renderer-owned exception |
| SSH session reliability | `ssh/manager.ts`, `ssh/connect.ts` ✅ | n/a | **target**: reconnect/backoff policy moves from `TerminalPanel.tsx` into a main-process module alongside `ssh/manager.ts` (e.g. `ssh/reconnect.ts`), pushed to the renderer as session-status events the same way reachability already is |
| Grafana dashboard status | `grafana/client.ts` ✅ | same file ✅ | **target**: its backoff loop moves out of `GrafanaStatusSection.tsx` into a small main-process monitor or a shared renderer backoff hook (either closes the gap; which one is a Phase 3 decision, not decided here) |
| `sweepBackground()` concurrency | — | — | **target**: add the same `runWithConcurrency` cap `clusterMonitor.ts`/`jiraMonitor.ts` already use — this is the one High-severity scalability gap found, and the fix is literally reusing existing code |

### Infrastructure Providers
Unchanged in shape — SSH/Slurm/DCGM-Prometheus/Grafana/Jira/Azure/Teleport each stay exactly where
they are. The target doesn't introduce a new abstraction layer over them (e.g. no generic
"InfrastructureProvider" interface) because the audit found no evidence of a problem that would
justify one — each provider's access pattern is different enough (SSH exec vs. HTTP REST vs. CLI
shell-out vs. PTY) that forcing a common interface would be exactly the speculative abstraction
CLAUDE.md warns against. One command runner is shared (`scheduler/exec.ts`), and that's the right
amount of sharing.

## HPC topology: Connection / Cluster / Partition / Node / GPU / Job

Already correctly distinguished at the type level (`ClusterReachability` vs. `SchedulerSnapshot` are
never merged) — the target closes the one real gap: **no cluster-wide node/GPU inventory exists.**

```
Connection          →  ConnectionProfile / AzureTunnelConfig / TeleportConfig   (how to reach a node)
     ↓ SSH
Login Node          →  reachability-only today (ClusterReachability)            (host-level, not cluster state)
     ↓ Slurm
Cluster              →  Cluster/ClusterSummary                                   (identity + integrations)
     ↓
Partition             →  SlurmPartition (already first-class: totals + counts by state)
     ↓
Compute Node          →  TARGET: a cluster-wide node inventory, not just SlurmNodeIssue
                         (problem nodes only, today)
     ↓
GPU                   →  TARGET: a cluster-wide GPU capacity/allocation entity, not just
                         GpuSample (one running job's nodes only, today)
     ↓
Job                   →  SlurmJob/SlurmHistoryJob (already first-class)
```

**Design constraint carried forward from the current, correct implementation**: a cluster-wide node
or GPU inventory must come from `sinfo`'s own server-side aggregation (the same one-chained-exec
pattern `scheduler/slurm.ts` already uses for partitions), **never** from polling individual compute
nodes over SSH one at a time. `sinfo --Node` or `sinfo -N` already reports a full node list to
`slurmctld` in one RPC; the target is to parse that into a new `SlurmNode[]` type alongside the
existing `SlurmPartition[]`/`SlurmNodeIssue[]`, and similarly aggregate GPU capacity from the same
DCGM/Prometheus datasource already configured per cluster (a `sum by (node)` style query), not from
a new per-node `nvidia-smi` fan-out. This is explicitly a Phase 2/3 concern (roadmap) — not
implemented here, and not safe to implement without first confirming real `sinfo -N`/DCGM output
shapes against actual infrastructure (per the High-severity "untested against real infra" finding).

## What this target explicitly does NOT add

Per the audit's own instructions and this repo's `CLAUDE.md` (no speculative abstractions, no large
rewrite without a clear reason): no generic plugin/provider framework, no new state-management
library (hooks + IPC pushes already work and scale fine for this app's size), no command-palette/
RBAC/action-framework (out of scope per the task), no rewrite of the IPC bridge or process model
(both are already correct). The target is narrower and more conservative than it might look at
first glance: close four specific, found gaps (hook coverage, reconnect-policy location, background
sweep concurrency, node/GPU inventory), not redesign anything that's already working.
