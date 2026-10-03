# Gate-H — Functional Specification

What Gate-H must do, as requirements. [docs/STATUS.md](docs/STATUS.md) is the current state of each
one (done / partial / not started, plus known issues) and wins if the two disagree;
[docs/ANALYSIS.md](docs/ANALYSIS.md) explains why it's built this way.

## 1. Purpose

A standalone desktop app (no server to stand up) that lets one person or a small team operate
several independent HPC clusters from one window: SSH terminals, Slurm and Grafana status, and Jira
tickets.

## 2. Entities

| Entity | Key fields | Notes |
|---|---|---|
| `Profile` | `id`, `name` | Groups clusters; exactly one is active. |
| `Cluster` | `name`, `description`, `tags`, `connection`, `grafana`, `jira`, `activeMonitoring` | Belongs to one profile. Every integration is optional. Tags also scope its Jira tickets (§3.5). |
| `ConnectionProfile` | `host`, `port`, `username`, `authMethod` (`password`\|`private-key`\|`agent`), optional `jumpHost` | A jump host composes with Direct or an Azure tunnel, and keeps its own stored secret. |
| `AzureTunnelConfig` | `mode` (`bastion`\|`az-ssh`), `subscription`, `tenant`, `resourceGroup`, `localPort`, target | SSH dials `127.0.0.1:localPort`. No secrets: the Azure CLI holds its own tokens. |
| `TeleportConfig` | `proxy`, `cluster`, `user`, `authConnector` | Exclusive with an Azure tunnel or jump host. No secrets: `tsh` holds its own certificates. |
| `GrafanaProfile` | `baseUrl`, `dashboardUids`, panel layout, optional `gpuDatasourceUid` | Service-account token stored, never returned to the renderer. |
| `JiraProfile` | `baseUrl`, `authMode` (`cloud`\|`datacenter`), `projectKey`, `jql` | Cloud = email + API token; Data Center = personal access token. |
| `SchedulerConfig` | `kind` (`slurm`), `scope` (`mine`\|`partitions`), optional `partitions`, `intervalSec`, `autoRefresh`, optional `execTarget` | `partitions` only narrows the jobs query. `execTarget` names another node to read Slurm from (§3.10). |
| `StorageConfig` | `paths`, `autoRefresh`, `intervalSec` | Paths whose usage and quota the Status widget checks. |
| `JobTemplate` | `name`, `body` | `{{name}}` / `{{name:default}}` placeholders, per profile. |
| `ClusterNotification` | `clusterId`, `kind`, `severity`, `message`, `read` | Persisted feed. |

Secrets (SSH password/passphrase, Grafana token, Jira token) are encrypted with
`electron.safeStorage` and write-only from the renderer: a cluster read back carries only
`has*Secret` booleans.

## 3. Requirements

### 3.1 Clusters and profiles
- Create, edit and remove clusters; any number, each self-contained.
- Import hosts from `~/.ssh/config` (and `Include`s); hosts using `ProxyJump`/`ProxyCommand` are
  flagged, not imported.
- Create, rename, delete and switch profiles. Switching clears the selection and closes every open
  cluster. Background monitors watch every cluster in every profile; only the view is scoped.

### 3.2 Reachability
- Probe every cluster's SSH port on an interval, confirming an SSH banner, whether or not the
  cluster is selected or in standby. Show a per-cluster LED with the round-trip time on hover.
- Re-check on window focus (throttled). A transition raises a notification (§3.7).

### 3.3 SSH terminal
- Interactive shell to the login node, directly or through a jump host. Auth: password, key (with
  passphrase) or agent.
- Host keys are pinned on first use; a changed key blocks the connection and notifies.
- Keepalive detects silently dropped connections.
- A dropped session retries a bounded number of times with backed-off, jittered delays, then
  pauses. A paused session retries when reachability reads online, or on a manual Reconnect. A
  persistently down cluster is never hammered.
- A session that isn't connected must look unmistakably so.

**Sessions and layout**
- Any number of sessions per cluster, as tabs (side list or top) or split panes: drag a tab to an
  edge to place it, drag borders to resize, drop on a tab to stack. Sessions can be renamed,
  maximized and restored. Session state lives only while the app runs.
- Scrollback search, clickable links, copy/paste and split/switch shortcuts (Cmd on macOS,
  Ctrl+Shift on Linux so plain Ctrl reaches the shell).
- Each session keeps a timestamped connection log. Named command snippets (per profile) insert into
  the active session.

### 3.3.1 Azure tunnel
- Before tunneling, check the Azure CLI sign-in **for the cluster's tenant**. A missing or expired
  one shows an "Azure authentication required" state with **Authenticate**, **Sign in with device
  code** (the user picks the account; no cached browser SSO) and **Clear cached sign-in**. Nothing
  signs in or retries by itself.
- Each tenant gets its own Azure CLI profile (`AZURE_CONFIG_DIR`, passed per spawned process, never
  set on the app's own environment), shared by that tenant's clusters, so clusters in different
  tenants stay signed in together. Clear removes only that tenant's profile. Unused profiles are
  pruned. Profile files are owner-only. Extensions stay shared (`AZURE_EXTENSION_DIR`).
- Connecting runs as gated stages: sign-in, subscription available, tunnel open, live SSH banner.
  Every `az` call is scoped per invocation with `--subscription`, never `az account set`.
- Bastion and `az ssh vm` accept a VM name (resolved at open time); Bastion also accepts a bare IP.
- The tunnel outlives sessions and is reopened if it died, replaced if a connect through it fails,
  and closed on quit, edit, removal or standby. A tunneled cluster's reachability reflects the
  tunnel. Every `az` call has stdin closed; the app warns when the CLI is older than 2.70.0.

### 3.3.2 Teleport
- The terminal is `tsh ssh` on a local PTY with the same behaviour as §3.3.
- A terminal never starts a login. A missing or soon-to-expire session shows *Teleport login
  needed*. Logging in is an explicit action in its own dialog; the app never answers a prompt. One
  login serves every cluster behind the same proxy and user.
- Notify once 15 minutes before expiry and allow renewal without interrupting sessions. Tracking is
  event-driven, with no polling and no `tsh` process when no Teleport cluster exists.
- Reachability reflects the proxy. Skipping certificate verification is opt-in per cluster.

### 3.4 Grafana status
- List dashboards with a health check. Embed chosen panels live, stacked or side by side, with
  resizable height and width.
- Refresh on an interval and when reachability changes, with backoff. Show the last good state at
  once and keep it on a failed refresh.

### 3.5 Jira
- List tickets in the cluster's scope and file a new one from its view. Works on Cloud and Data
  Center (Cloud's search API v3, falling back to v2 on Server/Data Center).
- **Scope:** an explicit JQL wins. Otherwise the project key and the cluster's tags narrow it; a tag
  matches a ticket's label or its text. A tagless, keyless cluster is shown a hint, and the list
  is limited to recent tickets.
- **Panel:** refresh button and auto-refresh; text search; Unresolved only (status category not
  Done); assigned to me, unassigned, a user, a group or a team.
- **Overview:** each cluster with a scope shows its unresolved ticket count. Standby clusters are
  skipped.
- Clicking a node in the Slurm view searches that scope for tickets mentioning it and offers
  **Create incident** when none match.

### 3.6 Connection lifecycle
- **Open:** selecting a cluster opens it. Switching away keeps its sessions until the user closes
  it (a second click confirms when sessions are live), puts it in standby, removes it, or switches
  profile.
- **Background:** an open, unselected cluster stays quiet: terminals keep receiving but stop
  resizing, no Grafana/Jira polling, and a dropped session pauses until selected.
- **Standby** (`activeMonitoring: false`): no session, polling or reconnects at all; a placeholder
  offers one-click resume, which behaves like a fresh selection. Reachability probes still run.

### 3.7 Notifications
- One feed for reachability changes, Jira activity, unexpected SSH disconnects and (opt-in) Slurm
  job and node changes. Unread count is visible; clicking one opens the cluster and the widget it
  concerns. Persisted until read.

### 3.8 Layout
- Terminal and Status render side by side or stacked. The user toggles either, swaps order, flips
  orientation and resizes the split; the choice persists. Status sections (Grafana, Slurm, Storage,
  Jira) can each be shown or hidden. Both are app-wide preferences.

### 3.9 Overview
- The default view is every cluster in the active profile as cards or a dense table (persisted):
  reachability, tags, integrations, Slurm summary, open-ticket count, unread count, quick actions.
- A summary strip shows fleet counts that double as filters, plus running/pending job totals from
  already-cached snapshots, never a new poll.

### 3.10 HPC orchestration
Design: [docs/HPC_ORCHESTRATION.md](docs/HPC_ORCHESTRATION.md).

**Slurm status**
- **Jobs:** the user's jobs, or everyone's (capped). `partitions` in the settings is optional and
  narrows only this query. The panel filters by job id, name, user, partition and state, and
  breaks pending jobs down by reason (clickable). Arrays stay collapsed until expanded.
- **Nodes:** always cluster-wide, never narrowed by partitions. Per-partition counts by state;
  down, draining and drained nodes first, each with its drain reason; a node with running jobs
  shows a badge that opens those jobs; healthy nodes group by state; a search finds any node.
  **Details** shows tickets mentioning the node (§3.5).
- **History:** on request, finished jobs for 24 hours, 7 days or 30 days from `sacct`, with state,
  exit code and CPU efficiency. Filter by id, name, user and date. "All users" drops the user
  filter. Never polled; loaded on open except on Teleport clusters.
- **GPUs:** installed GPUs per model split by node state (busy, idle, down), plus per-GPU
  utilization, memory and temperature for the user's running jobs, from Grafana/DCGM where
  available, otherwise an on-demand `nvidia-smi` inside one of the user's jobs (`srun --overlap`).

**Rules for scheduler commands**
- They never open a connection or log in. They run on the terminal's open session (an extra
  channel; for Teleport, a non-interactive `tsh ssh` while the session is valid). With no live
  session, nothing runs.
- **Another node:** when `execTarget` is set, the app runs `ssh <node>` from the connected node, so
  that node's keys, agent and config apply. The host must be a plain hostname and the port an
  integer. Blank means the connected node itself.
- Commands are fixed; the renderer never supplies one. Arguments are validated before reaching a
  shell. Each run has a timeout and output cap, and a cluster has at most one in flight.
- Polling happens only while the cluster is selected, not in standby, and a Slurm widget is
  visible, with a floor on the interval, backoff on failure and a slower cadence when the window is
  unfocused. Teleport clusters refresh manually unless opted in.
- **Notifications (opt-in):** the user's jobs finishing or starting, and nodes going down or
  drained. Bursts become one summary. A background cluster is checked at most every 5 minutes on
  its existing connection, never on Teleport; closed or standby clusters run nothing.

**Storage**
- Usage of the whole filesystem and the user's own quota where known (Lustre, GPFS), flagging
  usage over the soft limit. Paths come from the cluster settings and from the Status panel.
- Checked on request, or automatically at an interval chosen in the panel (the cluster's saved
  setting applies until then). Only while the section is visible, with backoff.

**Files and jobs**
- Browse, upload and download over SFTP on the existing connection, with progress; local paths come
  only from native dialogs; overwriting asks first. Not available on Teleport.
- Batch templates per profile. Submitting shows the rendered script and exact command, and runs
  `sbatch` only after a confirmation the main process requests itself. Cancelling has the same
  confirmation and applies only to the user's own jobs.

## 4. Non-functional requirements

- **Secrets stay in the main process**, as plaintext or ciphertext (§2).
- **No connection storms.** Every reconnect and re-poll path is bounded and backed off. Reachability
  and Jira sweeps cap their concurrency.
- **Hardened renderer.** Sandboxed, no raw `ipcRenderer` exposed, the app's own page is the only
  sender IPC accepts, external links open only as http/https, and navigation away is blocked.
- **No telemetry.** The only network calls go to endpoints the user configured.
- **Platforms.** Developed and verified on Linux. macOS (Apple Silicon and Intel) is built and
  smoke-tested in CI. Windows packaging exists but is unverified.
- **Releases.** Linux AppImage built in Docker (`./build-desktop.sh`); macOS `.dmg`/`.zip` per chip,
  ad-hoc signed and not notarized. A `v*` tag publishes both with `SHA256SUMS`.
- **Dependencies** stay free of known high-severity advisories (`npm audit`).

## 5. Out of scope

- Provisioning or lifecycle management of clusters.
- A multi-user, server-hosted portal.
- Admin actions (drain/resume nodes, change partitions, manage accounts) and `slurmrestd`. Nothing
  is submitted or cancelled without per-action confirmation.
- Notarized macOS and Windows builds, for now.
- PBS and LSF, for now.
