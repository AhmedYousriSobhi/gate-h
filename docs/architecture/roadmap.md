# Gate-H — Implementation Roadmap

Each phase is independent, incremental, and backed by a specific finding in `current-state.md` —
nothing here is speculative. Follow this repo's convention: one phase (or a clear sub-slice of one)
per GitHub issue, branch, and PR. No phase after Phase 1 is implemented yet.

## Phase 1 — Repository/architecture foundation
**Objective**: close the one concrete, low-risk gap found, and settle the open questions this audit
surfaced before building on top of them.
**Expected code areas**: `src/main/scheduler/monitor.ts` (add a `runWithConcurrency` cap to
`sweepBackground()`, reusing `src/main/monitor/concurrencyLimit.ts` — the exact pattern
`clusterMonitor.ts`/`jiraMonitor.ts` already use); `package.json` (decide: wire
`scripts/*.checks.ts` + `test-pty-manager.mjs` into an npm `test` script, or leave as-is and fix
`docs/STATUS.md`'s wording instead); `CLAUDE.md` (decide whether to correct the stale
"no X server" gotcha — this session confirmed a real X server and a working `npm run dev` window
are both available; see `current-state.md` §10); `docs/HPC_ORCHESTRATION.md` (fix the
`scheduler_config`/`scheduler` column-name drift and the stale "phases 1-3" status banner).
**Dependencies**: none — this is foundation work.
**Risk**: Low. The concurrency-cap fix is a mechanical reuse of existing, already-tested code. The
doc fixes are text-only. The `CLAUDE.md`/test-script decisions are the only ones needing the user's
input rather than being purely mechanical.
**Validation**: `npm run typecheck`/`lint`/`build`; for the concurrency fix, a targeted run of
`scripts/scheduler-monitor.checks.ts` (already covers backoff/throttle policy — extend it with a
case for the new cap rather than writing a new check file from scratch).

## Phase 2 — Domain model and HPC topology
**Status: node inventory + GPU capacity done; GPU allocation and UI surfacing still open.**
**Objective**: add the one missing piece of the topology model — a cluster-wide node/GPU inventory
— without breaking the existing, correct separation between host-level reachability and
cluster-level Slurm state.
**Done**: `SlurmNode`/`SlurmGres` types (`src/shared/types/index.ts`); `parseNodes`/`parseGres`/
`totalGpuCapacity` (`src/main/scheduler/slurm.ts`), parsing one more chained `sinfo -N` call folded
into the existing single-exec `snapshotCommand()` (still one channel per refresh); `nodes:
SlurmNode[]` added to `SchedulerSnapshot`. GPU capacity is summed from each node's own Slurm GRES
config (`sinfo %G`), not DCGM — capacity is a static scheduler-config fact, a different question
from DCGM's live utilization/health reading (`GpuSample`), so the two were kept separate rather
than conflated. Covered by `scripts/slurm.checks.ts` against synthetic `sinfo -N` output (real
format documented as an ASSUMPTION/EVIDENCE/DECISION comment on `snapshotCommand` — not yet
confirmed against a live cluster).
**Still open**: a GPU *allocation* (currently-in-use) figure — needs either a validated squeue
GRES-per-job format or `scontrol show node`'s `AllocTRES`, neither attempted since the exact field
format couldn't be confirmed without real infrastructure to check against; surfacing any of this
in the UI (that's Phase 5's job, not Phase 2's, per this phase's original code-area scope).
**Expected code areas**: `src/shared/types/index.ts`, `src/main/scheduler/slurm.ts` (done, above);
GPU allocation, if pursued, touches the same two files plus possibly `scheduler/exec.ts` if a new
command type (`scontrol`) is needed rather than reusing the existing chained `sinfo`/`squeue` exec.
**Dependencies**: Phase 1 (don't build on top of an unbounded background sweep) — done.
**Risk**: Medium — new functionality, not a refactor, but it must be validated against real
`sinfo -N` output before being trusted in production (per the High-severity "untested against real
infra" finding) — a wrong assumption about `sinfo -N`'s column format would ship a silently-broken
inventory view, the same class of risk the existing `squeue`/`sinfo` parsers already manage
carefully (delimiter choice, `LC_ALL=C`, free-text-last). The parser degrades defensively (a
non-matching `%C` field yields null CPU counts rather than crashing or guessing), which bounds the
damage of that risk but doesn't eliminate the need to verify against a real cluster.
**Validation**: unit tests against recorded real `sinfo -N`/DCGM output (same style as
`scripts/slurm.checks.ts`'s existing recorded-output tests); if a real Slurm/DCGM test lab becomes
available (the repo's `CHANGELOG.md` references a local Vagrant lab used for exactly this purpose
previously), verify against it before merging.

## Phase 3 — Collection/normalization
**Objective**: make every infrastructure surface look like `scheduler/`'s already-correct shape —
one hook per IPC surface in the renderer, reconnect/backoff policy living in main, not the renderer.
**Expected code areas**: new renderer hooks (`useSshSession`, `useAzureAuth`, `useGrafanaStatus`,
`useStorageUsage`, following `useReachability.ts`/`useSchedulerSnapshots.ts`'s exact shape); move
`TerminalPanel.tsx`'s reconnect/backoff state machine (`TerminalPanel.tsx:79-82,204-234`) into a
main-process module alongside `src/main/ssh/manager.ts`; move `StorageSection.tsx`'s renderer-side
poll loop into a main-process monitor matching `scheduler/monitor.ts`'s shape; consolidate
`GrafanaStatusSection.tsx`'s independent backoff loop into either the new hook layer or a shared
helper, closing the "reimplemented three times" Medium finding.
**Dependencies**: Phase 1 (settle the test-script question first, since this phase needs solid
regression coverage to move session-lifecycle logic safely).
**Risk**: **High** — this touches `TerminalPanel.tsx`'s reconnect state machine, which is the single
most behavior-sensitive piece of UI in the app (session pause/resume/backoff semantics, exactly the
kind of logic this session's `MainPanel.tsx` hook-extraction work already treated with extra care
for similar reasons). Do this with the live-UI validation path confirmed in `current-state.md` §10
available, not blind.
**Validation**: typecheck/lint/build plus **live manual exercise** of reconnect/pause/resume against
a real or lab SSH target, now that live UI testing is confirmed possible in this environment — this
phase should not be merged on typecheck/lint/build alone, unlike most of this session's earlier UI
refactors which had no safer option available at the time.

## Phase 4 — Caching/freshness/reliability
**Objective**: close the remaining Medium findings around error transparency and truncation
visibility.
**Expected code areas**: `src/main/ssh/connect.ts`/`manager.ts` (forward ssh2's `err.level` as a
typed error code instead of a raw message string, surfaced through the IPC event types in
`src/shared/types/index.ts`); `src/main/scheduler/gpu.ts`/`GpuUsage.tsx` (surface a `truncated` flag
for the 64-node GPU hostlist cap, mirroring the job table's existing `truncated` flag).
**Dependencies**: Phase 3 (the new SSH hook is the natural place to consume a typed error code,
rather than adding it to `TerminalPanel.tsx` just before it's refactored out).
**Risk**: Low — additive fields on existing event types, no behavior change to what already works.
**Validation**: typecheck/lint/build; unit-test the new error-code mapping against the known ssh2
`.level` values already cited in this audit.

## Phase 5 — Global dashboard
**Objective**: surface Phase 2's new cluster-wide node/GPU inventory in the Overview dashboard,
building on this session's already-shipped responsive grid, cards/table toggle, and cluster
drag-reorder.
**Expected code areas**: `src/renderer/src/features/shell/OverviewDashboard.tsx`,
`ClusterCard.tsx`/`ClusterTableRow.tsx` (add node/GPU capacity summary once Phase 2's types exist).
**Dependencies**: Phase 2 (the data has to exist before it can be displayed).
**Risk**: Low-Medium — UI-only once the underlying data model is solid; the main risk is
over-displaying (the audit's own guidance, carried from the original architecture review, is to
show capacity/allocation summaries, not a live per-node/per-GPU grid, on the fleet-wide view).
**Validation**: typecheck/lint/build plus live UI check (now confirmed possible) against sample or
real data at a few fleet sizes (1, a handful, and as many clusters as are available to test with).

## Phase 6 — Navigation and personalization
**Objective**: this phase is **substantially already done** this session (resizable sidebar,
keyboard-accessible cluster drag-reorder, cards/table dashboard toggle, dashboard filtering/search)
— what's left is narrower than the original scope implied.
**Expected code areas**: per-cluster panel layout (today it's one global preference —
`docs/STATUS.md` already flags this as a known, deliberate scope limitation, not a bug); any
further keyboard-accessibility gaps found outside the sidebar (this session fixed the sidebar
specifically; a broader accessibility pass over the rest of the UI is still open).
**Dependencies**: none beyond what's already shipped.
**Risk**: Low.
**Validation**: typecheck/lint/build plus live UI check.

## Phase 7 — Jobs/nodes/GPU/alerts
**Objective**: richer per-entity views (job detail, node drill-down, GPU drill-down) once Phase 2's
topology model exists, plus correlating alerts across reachability/Slurm/Jira into one coherent
"what needs attention" view (the notification feed already unifies these four producers at the
storage layer — see `current-state.md` §2 — this phase is about presentation, not new plumbing).
**Expected code areas**: `src/renderer/src/features/status/`, `src/main/notifications/` (if
correlation logic is needed beyond what `addNotification()`'s shared producers already provide).
**Dependencies**: Phase 2 (node/GPU drill-down needs the inventory model).
**Risk**: Medium — new UI surfaces, but on top of a data model that will have already been validated
in Phase 2.
**Validation**: typecheck/lint/build plus live UI check; this is also the natural point to finally
exercise the Slurm/GPU features against real infrastructure if a test lab is available, closing the
High-severity "never verified against real infra" finding for good.

## Phase 8 — Security/actions/production hardening
**Objective**: everything needed to call this "production ready" rather than "built and
typechecked."
**Expected code areas**: `.github/workflows/` (add Linux CI at minimum — currently macOS-only
despite Linux-first positioning; Windows CI if a test machine becomes available); macOS
notarization (currently ad-hoc signed only); a real-infrastructure verification pass across every
feature `docs/STATUS.md` currently marks "not yet run against real infrastructure"; a decision on
the automated-test-framework question raised in Phase 1.
**Dependencies**: all prior phases — this is the final hardening pass, not something to do early.
**Risk**: Low for CI/notarization (infrastructure work, not application logic); Medium for the
real-infrastructure verification pass (likely to surface genuine bugs in code that's only ever been
tested against mocks/fakes — that's the point of doing it, not a reason to avoid it).
**Validation**: full CI matrix (Linux + macOS + Windows if added) green; a documented
real-infrastructure test pass replacing `docs/STATUS.md`'s current "not yet verified" caveats one by
one.
