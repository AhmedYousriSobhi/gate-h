# CLAUDE.md

## Project
Gate-H: an Electron + React 19 + TypeScript desktop app (`electron-vite`) for managing HPC clusters
(SSH terminal, Slurm, Grafana, Jira, Azure/Teleport access). Storage: `better-sqlite3`. Terminal:
`ssh2` + `@xterm/xterm`.

## Commands
- `npm install` · `npm run dev` · `npm run build` (typechecks first)
- `npm run typecheck` · `npm run lint`
- `npm test`: headless checks in `scripts/*.checks.ts`. Azure tunnel script: `scripts/test-azure-tunnel.sh`. One check
  file: `npx tsx scripts/slurm.checks.ts` (works for files with no Electron stubs).
- Platform packages: `build:linux` / `build:win` / `build:mac`

## Map
- `src/main/`: SQLite (`db.ts`, `clusters.ts`), SSH (`ssh/`), Azure (`azure/tunnel.ts`), Grafana,
  Jira (`jira/client.ts`), Slurm (`scheduler/`: `slurm.ts` builds/parses commands, `exec.ts` runs
  them, `monitor.ts` polls), storage, monitors, notifications. One file per IPC namespace in `ipc/`,
  all importing `ipcMain` from `ipc/guard.ts`.
- `src/preload/`: the only bridge, a narrow `window.api` via `contextBridge`.
- `src/renderer/src/features/`: `shell/` (frame, overview), `terminal/`, `status/` (Slurm, Jira,
  Storage, Grafana), `clusters/` (form).
- `src/shared/`: types used by all three processes (`types/`, the `GateHApi` interface) and helpers.
  A new field usually touches main (DB column + migration + IPC), preload, and renderer.
- Docs: `SPEC.md` (requirements), `docs/STATUS.md` (state + known issues), `docs/ANALYSIS.md`
  (rationale).

## Response style
- Terse: the answer or result first. No preamble, recap, closing summary or unrequested suggestions.
- Show changed lines only. Reference code as `path:line`.
- User instructions override this file.

## Workflow
- Read before writing; search narrowly (grep/glob) before opening files.
- Plan first for 3+ files or unclear scope, unless the user already gave the plan.
- Smallest change that solves the problem; follow the nearest existing pattern (a per-cluster
  setting mirrors `activeMonitoring` end to end).
- Verify with typecheck, lint and the relevant check before saying done. Fix failures. Stop and ask
  if a step fails twice.
- No new dependencies without asking. No speculative abstractions. Comment only the "why".
- Never touch `out/`, `dist/`, `node_modules/`, `package-lock.json`.

## Gotchas
- **Migrations** (`src/main/db.ts`) are additive only: `ALTER TABLE ... ADD COLUMN` guarded by
  `columnExists()`, run on every launch. No down-migration.
- **Secrets** (`connection_secret`, `grafana_token`, `jira_token`) are encrypted with
  `safeStorage` and never sent to the renderer; `ClusterSummary` carries `has*Secret` booleans only.
- **Renderer security:** the window is sandboxed. Never expose `ipcRenderer` or the electron-toolkit
  `electronAPI` from preload; a new channel is a named method on `window.api`. Handlers use
  `ipc/guard.ts`, which rejects calls from any frame but the app page. External links go through
  `openExternalSafely` (http/https only).
- **Azure:** per-tenant profiles via `AZURE_CONFIG_DIR` in the spawned process's `env` only, never
  `process.env`. `AZURE_EXTENSION_DIR` must stay set or `bastion`/`ssh` extensions vanish.
- **Slurm:** `partitions` only narrows `squeue`; `sinfo` is always cluster-wide. Commands are fixed
  strings built in `slurm.ts`; validate any argument before it reaches a shell. `execTarget` runs
  `ssh <node>` from the connected node.
- **Jira:** Cloud search is `/rest/api/3/search/jql` (v2 `search` returns 410), with a 404/405
  fallback for Server/Data Center. A query must be restricted.
- **Real window:** a real X server is running (`DISPLAY` set). `ELECTRON_RUN_AS_NODE=1` forces plain
  Node, so use `env -u ELECTRON_RUN_AS_NODE npm run dev`. `xwininfo -root -tree` finds the window,
  `xwd -id <id>` captures it. Use a throwaway `XDG_CONFIG_HOME`. Never commit a screenshot with real
  cluster or host data; use synthetic examples.
- **macOS** can't be built here; `.github/workflows/macos.yml` is the only check. Keep
  `resources/*.sh` bash-3.2 safe (`${a[@]+"${a[@]}"}` for empty arrays under `set -u`) and macOS
  shortcut/menu behaviour in `src/renderer/src/lib/platform.ts` and `src/main/index.ts`.
- **Branches:** one issue → one branch → one PR. Run `git branch --show-current` and
  `gh auth status` before picking a base or opening a PR; a branch is sometimes stacked on another
  open PR's. Squash-merging a base PR makes stacked PRs conflict: merge `main` into the stacked
  branch first.

## Context hygiene
- Delegate high-output work (tests, logs, wide research) to subagents and take back summaries.
- Pipe noisy commands through `head`/`grep`/`tail`. Prefer `gh` and other CLIs over MCP servers.
- Suggest `/clear` when the task changes and `/compact` at about 50-60% context.
- When compacting, keep: current task, decisions, files changed, failing tests, next steps.

## Git
- Conventional commits, small and focused. Never commit secrets, force-push or skip hooks without
  asking.
