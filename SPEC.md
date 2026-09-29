# Gate-H — Functional Specification

This is the functional spec: what Gate-H is supposed to do, stated as requirements. It complements
two other docs rather than duplicating them:

- [docs/ANALYSIS.md](docs/ANALYSIS.md) — *why* it's built this way (prior art, architecture
  decisions).
- [docs/STATUS.md](docs/STATUS.md) — the *current, point-in-time* state of each requirement below
  (done / partial / not started) plus known limitations. When this file and STATUS.md disagree on
  what's shipped, STATUS.md is correct — this file describes the target, not a completion log.

## 1. Purpose

A standalone desktop application (not a browser tab, no server to stand up) that lets one person
or small team operate several independent HPC clusters — SSH access, Grafana-based status, and
Jira ticketing — from a single window, without juggling a terminal, several browser tabs, and a
ticket tracker separately.

## 2. Core entities

| Entity | Key fields | Notes |
|---|---|---|
| `Profile` | `id`, `name` | Groups a set of clusters (e.g. "Work" vs "Research"); exactly one profile is active at a time. |
| `Cluster` | `id`, `name`, `description`, `tags`, `connection`, `grafana`, `jira`, `activeMonitoring` | Belongs to exactly one `Profile`. `grafana`/`jira` are optional — a cluster may be SSH-only. |
| `AzureTunnelConfig` | `mode` (`bastion`\|`az-ssh`), `subscription`, `resourceGroup`, `localPort`, Bastion name + target VM id or VM name | Optional per cluster. SSH dials `127.0.0.1:localPort`, and `connection.host`/`port` are the tunnel's far end. No secrets: the Azure CLI keeps its own tokens. |
| `TeleportConfig` | `proxy`, optional `cluster` (leaf), `user`, `authConnector` | Optional per cluster, exclusive with an Azure tunnel or a jump host. `connection.host` is the Teleport node name and `connection.username` the login. No secrets: `tsh` keeps its own certificates. |
| `ConnectionProfile` | `host`, `port`, `username`, `authMethod` (`password`\|`private-key`\|`agent`), optional `jumpHost` | One SSH identity per cluster; a jump host chains a second SSH hop via `forwardOut`. |
| `GrafanaProfile` | `baseUrl`, `dashboardUids`, per-dashboard `panelSelections`/`panelOrientation`/`panelEmbedHeight`/`panelWidths` | A service-account API token is stored alongside but never returned to the renderer. |
| `JiraProfile` | `baseUrl`, `authMode` (`cloud`\|`datacenter`), `projectKey`/`jql` | Cloud = email + API token (Basic auth); Data Center = Personal Access Token. |
| `ClusterReachability` | `clusterId`, `status` (`online`\|`offline`\|`checking`), `checkedAt` | Derived, not stored — recomputed by the background monitor. |
| `SchedulerConfig` | `kind` (`slurm`), `scope` (`mine`\|`partitions`), `partitions`, `intervalSec`, `autoRefresh` | Optional per cluster; `null` means no scheduler integration. No secrets: commands run as the SSH user on the already-authenticated session. See §3.10. |
| `StorageConfig` | `paths` | Optional per cluster: paths whose usage and quota the Status widget checks on request. See §3.10. |
| `ClusterNotification` | `clusterId`, `kind` (`reachability`\|`jira`\|`ssh`), `severity`, `message`, `read` | Cross-cluster feed, persisted so unread state survives a restart. |

Secrets (SSH password/passphrase, Grafana token, Jira token) are encrypted at rest via
`electron.safeStorage` and are write-only from the renderer's perspective: a cluster read back
from the store only ever reports `hasConnectionSecret`/`hasGrafanaToken`/`hasJiraToken` booleans,
never the plaintext or ciphertext.

## 3. Functional requirements

### 3.1 Cluster & profile management
- Create, edit, and remove a cluster; each belongs to the profile active at creation time.
- Register any number of clusters, each fully self-contained (its own SSH/Grafana/Jira config) —
  nothing about one cluster's setup constrains another's.
- Create, rename, delete, and switch between profiles; switching profiles clears the current
  selection (a cluster from the old profile can't stay "selected" under the new one) and closes
  every open cluster (§3.6) — a profile is a separate context, often with separate credentials.
- Background monitors (reachability, Jira polling) watch every cluster in every profile
  regardless of which is active — only the sidebar/dashboard *view* is scoped to the active
  profile.

### 3.2 Reachability monitoring
- Every registered cluster's SSH port is probed on a fixed interval (not just a bare TCP connect —
  the probe confirms an actual SSH banner), independent of whether the cluster is selected,
  open, or in standby (§3.6).
- A per-cluster LED (online/offline/checking) is shown in the sidebar and the overview dashboard,
  updated in real time as probes complete.
- Regaining window focus triggers an immediate re-check (throttled to avoid extra probing if
  focus events fire in quick succession), so the LED catches up quickly after e.g. a VPN
  reconnect without waiting for the next scheduled sweep.
- An online→offline or offline→online transition raises a notification (§3.7).

### 3.3 SSH terminal
- Open an interactive shell to a cluster's login node (or through a configured jump host) from
  inside the app — no external terminal required.
- Auth methods: password, private key (with optional passphrase), or the local SSH agent.
- Host keys are pinned trust-on-first-use (the same model as OpenSSH's `known_hosts`); a key that
  changes after being trusted blocks the connection and raises a notification rather than
  silently proceeding.
- SSH-level keepalive detects a silently-dropped connection (e.g. through a NAT/firewall that
  drops idle connections without a clean close) instead of leaving the session sitting in a
  falsely "connected" state.
- A dropped or failed session retries automatically with bounded, backed-off attempts (a small
  fixed number of tries within a rolling time window, exponential backoff with jitter between
  them), then pauses rather than retrying indefinitely — a persistently unreachable cluster must
  never be hammered with repeated connection attempts. A paused session re-checks the cluster's
  reachability reading on every update and retries as soon as it reads online, in addition to
  offering a manual "Reconnect" action.
- While a session isn't connected (initial connect, a retry in progress, or paused), the terminal
  view makes that state unmistakable — a stale output buffer must never be mistakable for a live,
  responsive prompt.

### 3.3.1 Azure tunnel pre-flight
- A cluster may require an Azure tunnel. Before its SSH session connects, the app signs in with
  the Azure CLI (a device-code prompt if needed), selects the configured subscription, and opens
  the tunnel. Each step shows in the terminal view.
- The tunnel outlives individual SSH sessions: reconnecting reuses it, and reopens it if it died.
  A connect failure through the tunnel replaces it, since a hung tunnel can keep listening.
  Retries follow the same bounded backoff as §3.3.
- The tunnel is closed on quit, on edit/removal of the cluster, and in standby (§3.6).
- A tunneled cluster's reachability (§3.2) reflects the tunnel's health.

### 3.3.2 Teleport-protected clusters
- A cluster may sit behind a Teleport proxy. Its terminal session is `tsh ssh` on a local
  pseudo-terminal, behind the same terminal behavior as §3.3: resize, the connection-state
  shade, and bounded reconnects.
- Before `tsh ssh`, the app checks for a valid Teleport session for that proxy. A terminal never
  starts a login by itself: a session that is missing or about to expire shows *Teleport login
  needed*, and nothing retries until the user logs in. This applies to background
  clusters too.
- Logging in is an explicit user action in its own dialog (password/OTP prompts, or SSO in the
  browser). The app never answers a prompt on the user's behalf. One login serves every cluster
  behind the same proxy and Teleport user, and their terminals reconnect. A `tsh login` done
  outside the app counts too.
- 15 minutes before a session expires, the user is notified once and can renew it from the
  terminal without interrupting open sessions.
- Session tracking is event-driven: no polling, and no `tsh` process at all when there are no
  Teleport clusters.
- A failed session check (proxy unreachable, login failed or timed out, `tsh` missing) is shown
  as the terminal's error and raises a notification.
- A Teleport cluster's reachability (§3.2) reflects its proxy.

### 3.4 Grafana status
- Per cluster, list configured dashboards and show a health check (reachable + version, or the
  failure reason).
- Per dashboard, let the user pick which panels to embed live (not just a static snapshot), lay
  them out stacked or side by side, resize the embedded height, and — when side by side — resize
  each panel's width relative to its neighbors independently.
- Status refreshes automatically on a fixed interval and whenever the cluster's reachability
  reading changes, with backoff on repeated failures, rather than only ever fetching once per
  view.

### 3.5 Jira integration
- Per cluster with a Jira profile configured: list issues matching a saved JQL/project filter, and
  file a new issue against that project directly from the cluster's view.
- Works against both Jira Cloud and Jira Data Center/Server, without the user needing to know
  which auth scheme that entails.

### 3.6 Connection lifecycle: open, background and standby
- **Open**: selecting a cluster opens it. Switching away never ends its sessions — every
  terminal tab and split stays connected in the background until the user closes the cluster
  explicitly (or it goes into standby, is removed, or the profile is switched; §3.1). Closing a
  cluster with connected sessions asks for a second click on the same control, not a dialog.
- **Background**: an open cluster that isn't selected stays quiet — its terminals keep
  receiving output but stop resizing, and no Grafana/Jira polling or live panel embeds run. A
  session that drops there pauses instead of retrying and reconnects when the cluster is
  selected again, so many open clusters can't all be retrying against their login nodes at once.
  Reconnect-on-failure (§3.3) otherwise applies as usual once the cluster is selected.
- **Standby** (`activeMonitoring: false`): a master per-cluster switch — no SSH session, no
  Grafana polling, and no reconnect/backoff loop exist for that cluster at all, even if it's
  currently selected. Selecting a standby cluster shows a placeholder
  (with a one-click way to resume) instead of silently connecting. Turning monitoring back on
  behaves exactly like a fresh selection — same connect flow, same backoff policy, no fast path
  that bypasses rate-limiting. The lightweight reachability probe (§3.2) is unaffected by standby;
  it is cheap enough to always run for every cluster.

### 3.7 Cross-cluster notifications
- A single feed collects reachability transitions, Jira ticket activity, unexpected SSH
  disconnects, and (opt-in) Slurm job and node changes from every cluster, so the user doesn't have to check each cluster individually to
  notice something changed.
- Unread count is visible at a glance; clicking a notification jumps straight to the relevant
  cluster and the specific widget (Terminal or Status) it concerns.
- Notifications persist across restarts until marked read.

### 3.8 Panel layout
- A cluster's Terminal and Status widgets render side by side (or stacked) rather than behind
  tabs, so both are visible at once.
- The user can toggle either widget on/off, swap their pane order, switch orientation, and
  drag-resize the split between them; the layout choice persists across restarts.

### 3.9 Overview dashboard
- The default view (nothing selected) is a grid of every cluster in the active profile, showing
  reachability, tags, which integrations (Grafana/Jira) are configured, and unread notification
  count — never a blank "pick something" screen.

### 3.10 HPC orchestration (planned)
The job queue and node health are built; the rest isn't yet (see docs/STATUS.md). The design is
in [docs/HPC_ORCHESTRATION.md](docs/HPC_ORCHESTRATION.md).
- **Job queue and node health (Slurm).** For a cluster with a `SchedulerConfig`, show the user's
  own jobs, or every user's jobs in named partitions (never the whole queue). Each job shows its
  state, elapsed/limit, nodes, and expected start or pending reason, and job arrays stay
  collapsed until expanded. Also show per-partition node counts by state and drain reasons.
- **Scheduler commands never open a connection.** They run only on a session the user already has
  open: an extra `ssh2` channel on the terminal's connection, or, for Teleport, a non-interactive
  `tsh ssh` while the Teleport session is valid. With no live session, nothing runs, and a
  scheduler query never triggers a login or MFA prompt.
- **Fixed commands only.** The renderer asks for a cluster's snapshot, never for a command, and
  any user-supplied argument (partition names) is validated before it reaches a shell. Each run
  has a timeout and an output cap, and a cluster never has more than one scheduler command in
  flight.
- **Scheduler polling is scoped to what the user is looking at.** It polls only while the cluster
  is selected, not in standby, and a scheduler widget is visible, with a floor on the interval,
  the same failure backoff as §3.4, and a slower cadence while the window is unfocused.
  Background clusters (§3.6) don't poll, with one opt-in exception: notifications (below). On
  Teleport clusters, where each run is an audited session, refresh is manual unless the user opts
  in per cluster.
- **Scheduler notifications (opt-in per cluster).** Notify when the user's own jobs finish (with
  their final state and exit code) or start, and when nodes go down or are drained. Bursts become
  one summary. While the cluster is open in the background, it's checked at most every 5 minutes,
  on its terminal's existing SSH connection only, with backoff, and never on Teleport clusters. A
  closed or standby cluster runs nothing.
- **Storage quota.** For configured paths, show the whole filesystem's usage and the user's own
  quota where the filesystem has one (Lustre, GPFS), flagging usage over the soft limit. Checked
  on request only, over the existing session.
- **GPU telemetry.** Per-GPU utilization, memory and temperature for the nodes of the user's
  running jobs. It comes from the cluster's Grafana/Prometheus (DCGM exporter) through the
  existing Grafana token where available. Otherwise it is an on-demand `nvidia-smi` sample inside
  one of the user's own jobs (`srun --overlap`), never polled and never over direct SSH to compute
  nodes.
- **File transfer.** Browse, upload and download over SFTP on the existing connection.
- **Job submission helper.** A local library of batch script templates. Submitting shows the full
  rendered script and the exact command, and runs `sbatch` only after an explicit confirmation.
  Cancelling a job has the same confirmation and applies only to the user's own jobs.

## 4. Non-functional requirements

- **Secrets never leave the main process in plaintext or ciphertext** — see §2; enforced by
  `ClusterSummary` never carrying the underlying token/password fields.
- **No connection-attempt storms** — every reconnect/re-poll path (Terminal, Grafana) is bounded
  and backed off (§3.3, §3.4); a target that's genuinely down must degrade to a slow, capped retry
  cadence, not sustained pressure. This matters specifically because the "clusters" on the other
  end are real HPC login nodes and shared infrastructure, not disposable test endpoints.
- **Linux-first** — actively developed and verified on Linux; Windows/macOS packaging targets
  exist in `electron-builder` config but are unverified (see `docs/STATUS.md`).
- **No telemetry** — Gate-H does not phone home; the only network calls it makes are to the
  Grafana/Jira/SSH endpoints the user explicitly configured per cluster.

## 5. Out of scope

- Cluster **provisioning** or lifecycle management (that's Bright/Base Command Manager's job, not
  Gate-H's) — Gate-H only connects to clusters that already exist.
- A **multi-tenant, server-hosted** portal (that's Open OnDemand's niche) — Gate-H is a
  single-user desktop app; there is no server component and no concept of other users.
- **Becoming a scheduler client or admin tool.** Gate-H won't talk to `slurmrestd`, won't
  perform admin actions (drain/resume nodes, change partitions, manage accounts), and won't
  submit or cancel anything without an explicit per-action confirmation. The planned
  job-queue, node-health, GPU and submission features (§3.10) run ordinary user-level scheduler
  commands over the session the user already has open.
- **PBS/LSF** for now. `SchedulerConfig.kind` leaves room for them, but only Slurm is designed.
