# CLAUDE.md

<!-- Keep under 200 lines. Every line must prevent a mistake or save tokens. Delete what Claude already does correctly. -->

## Project
Gate-H — a standalone Electron desktop portal for managing HPC workloads (SSH terminal, Grafana
status, Jira tickets) across any number of clusters. Stack: Electron + React 19 + TypeScript,
bundled with `electron-vite`/Vite; `better-sqlite3` for local storage, `ssh2` + `@xterm/xterm` for
the terminal.

## Commands
- Install: `npm install`
- Dev: `npm run dev`
- Test (single file): none yet - no automated test suite exists (see `docs/STATUS.md`); verify
  with `npm run typecheck` and `npm run lint` instead
- Lint/typecheck: `npm run lint` / `npm run typecheck` (runs both `typecheck:node` and
  `typecheck:web`)
- Build: `npm run build` (typechecks first); platform packages: `build:linux` / `build:win` /
  `build:mac`

## Architecture (map only)
- `src/main/`: Electron main process - SQLite store (`db.ts`, `clusters.ts`), SSH sessions
  (`ssh/manager.ts`, `ssh/knownHosts.ts`), Grafana client/embed (`grafana/`), Jira client
  (`jira/`), background monitors (`monitor/` reachability+Jira, `notifications/`), one file per
  IPC namespace under `ipc/`
- `src/preload/`: the only bridge to the renderer - a narrow, explicit `contextBridge` API
  (`window.api`); the renderer never gets direct Node/Electron access
- `src/renderer/src/features/`: React UI, grouped by feature (`shell/` app frame + sidebar +
  panels, `terminal/`, `status/` Grafana+Jira widgets, `clusters/` add/edit form)
- `src/shared/types.ts`: types used by all three processes, and the `GateHApi` interface that
  `window.api` must implement - the source of truth for a cluster's shape; a new field almost
  always means touching main (DB column + migration + IPC handler), preload (bridge method), and
  renderer together
- Details: see `docs/ANALYSIS.md` (architecture rationale, prior art), `docs/STATUS.md`
  (feature-by-feature status + known limitations), `SPEC.md` (functional spec)

## Response Style
- Be terse. Lead with the answer or result.
- No preamble, no restating the question, no closing summary or offers.
- No unsolicited suggestions, refactors, or explanations.
- Show diffs/changed lines only, never whole files unless asked.
- Reference code as `path:line` instead of pasting it.
- User instructions override this file.

## Workflow
- Read before writing. Read each file once unless it changed.
- Search narrowly (grep/glob) before opening files. Never scan the whole repo.
- Plan first for tasks touching 3+ files or with unclear scope; wait for approval.
- Prefer targeted edits over rewrites. Smallest change that solves the problem.
- Verify: run the relevant test/lint/typecheck before declaring done. Fix, don't report, failures.
- Stop and ask if requirements are ambiguous or a step fails twice; don't loop.
- Unsure? Say so. Never invent APIs, paths, or flags; check the code or docs.

## Code Rules
- Follow existing patterns; find a similar file first (e.g. a new per-cluster setting almost
  always mirrors `activeMonitoring`/`setClusterActiveMonitoring` end to end).
- No new dependencies without asking.
- No speculative abstractions, extra config, or unused code.
- Only comment the "why", not the "what".
- Don't touch: `out/`, `dist/`, `node_modules/`, `package-lock.json`.

## Gotchas
- SQLite migrations (`src/main/db.ts`) are additive-only - `ALTER TABLE ... ADD COLUMN`, guarded
  by `columnExists()`, run unconditionally on every launch. There's no down-migration; a shipped
  column stays forever.
- Secrets (`connection_secret`, `grafana_token`, `jira_token`) are encrypted with
  `electron.safeStorage` and never sent back to the renderer - `ClusterSummary` only carries
  `has*Secret` booleans. Never add a field that round-trips a raw secret to the renderer.
- This environment can't render an actual Electron window (no X server, no sudo to install
  `xvfb`) - UI changes are verified with `typecheck`+`lint`+manual code review only. Say that
  explicitly in the PR instead of claiming a live UI test.
- macOS can't be built or run here; `.github/workflows/macos.yml` is the only check. Keep
  `resources/*.sh` bash-3.2 safe (empty arrays under `set -u` need `${a[@]+"${a[@]}"}`) and keep
  macOS shortcut/menu behavior in `src/renderer/src/lib/platform.ts` and `src/main/index.ts`.
- `git branch --show-current`/`gh auth status` first when picking a base branch or opening a PR -
  this repo's convention is one GitHub issue -> one branch -> one PR per task (see issues
  #14/#16/#18 and their branches), and a branch is sometimes deliberately stacked on another
  open PR's branch rather than on `main`.

## Context and Token Hygiene
- Delegate high-output work (tests, logs, docs lookup, wide research) to subagents; return summaries only.
- Pipe noisy commands through `head`/`grep`/`tail`; never dump full logs.
- Prefer CLI tools (`gh`, `aws`, etc.) over MCP servers when both work.
- Fast/simple tasks: lowest sufficient model and effort.
- Suggest `/clear` when the task changes; `/compact` at ~50-60% context.

## Compact Instructions
When compacting, keep: current task, decisions made, files changed, failing tests, next steps. Drop: exploration, dead ends, raw tool output.

## Git
- Conventional commits, small and focused.
- Never commit secrets, force-push, or skip hooks without asking.