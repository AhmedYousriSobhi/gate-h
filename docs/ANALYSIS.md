# H-Gate — Analysis & Architecture

## 1. Problem statement

Teams operating HPC (High Performance Computing) workloads typically juggle several disconnected
tools to do their job day to day:

- A terminal (or several) with saved SSH configs for each cluster they access.
- A browser tab open to each cluster's Grafana instance to check node health, queue depth, and
  utilization.
- A browser tab open to Jira to track incidents, job-support requests, or maintenance tickets.

H-Gate's goal is to fold all three into one **standalone desktop application** (not a browser
tab) that is generic enough to manage any number of clusters, each with its own SSH connection
profile, Grafana instance, and Jira project.

## 2. Prior art / competitive landscape

| Tool | Type | Open source | What it does | What H-Gate takes from it |
|---|---|---|---|---|
| **Open OnDemand** (OSC) | Web portal (server-hosted) | Yes (BSD-3) | Browser-based file management, job submit/monitor, interactive apps (Jupyter/RStudio), in-browser SSH shell | The "one pane of glass per cluster" idea — but H-Gate stays a local desktop app instead of requiring a server deployment per site. |
| **ColdFront** + **Open XDMoD** | Web apps (Django) | Yes | Allocation/project management (ColdFront) and utilization/usage reporting (XDMoD), integrated via plugin | The separation of concerns: access/allocation vs. utilization reporting vs. interactive portal. H-Gate's Grafana view plays XDMoD's role but scoped to live ops status, not accounting. |
| **Bright Cluster Manager / NVIDIA Base Command Manager** | Commercial, admin-facing | No | Bare-metal cluster provisioning, lifecycle, monitoring | Out of scope for H-Gate — H-Gate never provisions clusters, only connects to ones that already exist. |
| **Slurm-web** (rackslab) | Web dashboard (needs server) | Yes (GPLv3) | Job queue/node/rack topology views over `slurmrestd`, multi-cluster, RBAC | Closest direct prior art for the "cluster status" screen — worth mirroring its multi-cluster queue/node visualization, but delivered as an embedded desktop view backed by Grafana instead of a hosted web app. |
| **Ganglia** | Monitoring agent + web UI | Yes | Older push-model HPC monitoring, mostly superseded by Prometheus+Grafana | Confirms Prometheus+Grafana as the modern default — this is exactly what H-Gate integrates with instead of building its own metrics pipeline. |
| **Termius / MobaXterm / Remmina** | Desktop SSH session managers | Termius/MobaXterm: no, Remmina: yes | Save/organize SSH hosts and keys, tabbed sessions | Closest UX analog for H-Gate's cluster/connection manager — but none of them are HPC-aware (no job queue, no Grafana/Jira). This is the specific gap H-Gate fills: SSH manager + HPC dashboards + ticketing in one app. |

**Positioning**: H-Gate is not trying to replace Open OnDemand/Slurm-web (server-hosted, multi-tenant
HPC center portals) or Bright/Base Command Manager (infra provisioning). It occupies the niche of
a **personal/team desktop console**: no server to stand up, works against clusters you already
have SSH + Grafana + Jira access to, and requires zero admin buy-in from the HPC center to install.

## 3. Chosen architecture

### 3.1 Shell & stack

- **Electron** — standalone desktop app, Linux-first (packaged as AppImage/.deb via
  `electron-builder`), no browser dependency for the end user.
- **React + TypeScript**, bundled with **Vite** via `electron-vite` — fast dev loop, strong typing
  across main/preload/renderer processes.
- Process split (standard Electron three-process model):
  - **Main process** (`src/main`): owns SSH connections, the local SQLite store, OS-keychain
    secret access, and all outbound HTTP calls to Grafana/Jira (keeps API tokens out of the
    renderer/DOM entirely).
  - **Preload** (`src/preload`): a narrow, explicit `contextBridge` API exposed to the renderer —
    no direct Node/Electron access from UI code.
  - **Renderer** (`src/renderer`): the React UI — cluster list, connection screen, embedded
    terminal, Grafana status widgets, Jira panel.

### 3.2 Cluster model (the "generic multi-cluster" requirement)

Each cluster is a record with:

- Identity: name, description, tags.
- **Connection profile**: host, port, username, auth method (`password` | `private-key` |
  `agent`), optional private key path/passphrase, optional jump/bastion host (chained
  `ssh2` connection using `forwardOut`).
- **Grafana profile** (optional): base URL, service-account API token, list of dashboard/panel
  IDs to surface on the cluster's status screen.
- **Jira profile** (optional): base URL, auth mode (`cloud` = email + API token, or
  `datacenter` = Personal Access Token), default project key/JQL filter for that cluster.

This keeps every cluster fully self-contained and lets a user mix e.g. a Cloud Jira instance for
one cluster with a self-hosted Jira Data Center for another.

### 3.3 SSH & terminal

- **`ssh2`** for the SSH/SFTP client (key/password/agent auth; jump-host support by chaining a
  second `ssh2` connection through the first one's forwarded stream).
- **`xterm.js`** (renderer) + **`node-pty`**-driven shell channel over Electron IPC (main) for the
  embedded terminal, following the same pattern used by VS Code's integrated terminal and by
  Electerm (an existing Electron SSH client built on this exact stack).

### 3.4 Secrets & local storage

- **`electron.safeStorage`** (built-in, OS-keychain backed: libsecret on Linux) to encrypt SSH
  passphrases and Grafana/Jira API tokens at rest. `keytar` was deliberately **not** chosen — it
  is deprecated/archived; `safeStorage` is the current Electron-recommended replacement (VS Code
  itself migrated from keytar to `safeStorage`).
- **`better-sqlite3`** for structured local data (cluster records, connection history, cached
  Jira/Grafana query results). Encrypted secret blobs are stored as opaque columns, never as
  plaintext.

### 3.5 Grafana integration

REST API pull, per the confirmed decision:

- Auth via a **Grafana service account token** (Bearer token), configured per cluster.
- H-Gate calls Grafana's HTTP API to fetch dashboard/panel definitions and query results and
  renders its own lightweight status widgets (node up/down counts, queue depth, utilization)
  natively in the app — no iframe, so the app has no runtime dependency on a browser engine
  feature set beyond what Electron already ships, and no dependency on the target Grafana's
  `allow_embedding`/CSP settings.

### 3.6 Jira integration

REST API, per the confirmed decision:

- **Jira Cloud**: Basic Auth with account email + API token (scoped tokens preferred).
- **Jira Data Center/Server**: Personal Access Token via `Authorization: Bearer`.
- Endpoints used: JQL search (`/rest/api/3/search`), issue create (`POST /rest/api/3/issue`),
  issue get/update (`/rest/api/3/issue/{key}`), issue linking (`/rest/api/3/issueLink`) — enough
  to view, file, and cross-link tickets against a cluster from its dashboard.

## 4. Build plan (branch per feature, merged to `main` once verified)

1. `feature/app-scaffold` — Electron + React + TS scaffold, build/lint/typecheck green. *(this
   branch)*
2. `feature/cluster-store` — local SQLite-backed cluster CRUD (add/edit/remove/list clusters) +
   `safeStorage`-encrypted secrets, with a settings/cluster-list UI.
3. `feature/ssh-terminal` — SSH connect flow (incl. jump host) + embedded `xterm.js` terminal per
   cluster.
4. `feature/grafana-integration` — Grafana service-account config UI + status widgets on each
   cluster's dashboard.
5. `feature/jira-integration` — Jira account config UI + issue list/create/link panel per cluster.
6. `feature/dashboard-shell` — the main app shell tying cluster list + terminal + Grafana status +
   Jira panel together into one navigable UI.

Each step is logged in [`CHANGELOG.md`](../CHANGELOG.md) as it lands.
