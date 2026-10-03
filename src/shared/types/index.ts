// Types shared between the main process and the renderer (over the preload bridge).
// Any field named *Secret carries a plaintext value only in-transit from a form submission;
// it is encrypted with `safeStorage` before it touches disk and is never round-tripped back
// to the renderer once saved (see src/main/secrets.ts).

export * from './cluster'
export * from './ui'

import type {
  AzureSubscription,
  AzureTunnelStatusEvent,
  AzureTunnelVerifyResult,
  AzureAuthState,
  AzureVmMatch,
  ClusterInput,
  ClusterSummary,
  SshConfigCandidate
} from './cluster'
import type {
  ClusterOrder,
  OverviewViewMode,
  PanelLayout,
  PanelOrientation,
  StatusLayout
} from './ui'

export interface SshDataEvent {
  sessionId: string
  chunk: string
}

export interface SshClosedEvent {
  sessionId: string
  /** Set for PTY sessions (Teleport terminals and login dialogs): the process's exit code. */
  exitCode?: number
  /** A Teleport terminal ended because there's no usable tsh session for its proxy. Terminal
   *  sessions never log in by themselves (see TeleportConfig), so this needs the user to log
   *  in, and retrying automatically would only fail again. */
  authRequired?: boolean
}

/** What Gate-H knows about the tsh session a Teleport cluster would use, read from `tsh status`
 *  (local only - no network). Clusters sharing a proxy and Teleport user share one session. */
export interface TeleportSessionInfo {
  clusterId: string
  /** ISO time the certificate expires, or null when there's no session for this proxy/user. */
  validUntil: string | null
}

export interface SshErrorEvent {
  sessionId: string
  message: string
}

/** Electron session partition a <webview> must use to embed a cluster's Grafana panels live - see
 *  src/main/grafana/embed.ts, which arms this exact partition's Authorization/frame headers. */
export const GRAFANA_EMBED_PARTITION = 'persist:grafana-embed'

export interface GrafanaHealth {
  ok: boolean
  version?: string
  message?: string
}

export interface GrafanaPanelInfo {
  id: number
  title: string
}

export interface GrafanaDashboardStatus {
  uid: string
  title: string
  url: string
  /** Every panel on the dashboard, for the picker - not just the selected ones. */
  panels: GrafanaPanelInfo[]
  selectedPanelIds: number[]
  /** Layout of the selected panels within this dashboard's card - see
   *  GrafanaProfile.panelOrientation. */
  orientation: PanelOrientation
  /** Height in px applied to every selected panel's embed - see GrafanaProfile.panelEmbedHeight. */
  embedHeight: number
  /** Normalized width share (0-1, sums to 1) of each selected panel when shown side by side -
   *  always present and covers exactly `selectedPanelIds`, even if nothing was saved yet or the
   *  selection changed since - see GrafanaProfile.panelWidths. */
  panelWidths: Record<number, number>
  error?: string
}

export interface GrafanaStatusResult {
  health: GrafanaHealth
  dashboards: GrafanaDashboardStatus[]
}

/** Extra, per-view narrowing applied on top of the cluster's own Jira scope. */
export type JiraAssignKind = 'me' | 'unassigned' | 'user' | 'group' | 'team'

export interface JiraListFilter {
  text?: string
  openOnly?: boolean
  /** Who the ticket is currently assigned to. `value` is the user, group or team name. */
  assigned?: { kind: JiraAssignKind; value?: string }
}

export interface JiraIssueSummary {
  key: string
  summary: string
  status: string
  issueType: string
  updated: string
  url: string
}

export interface CreateJiraIssueInput {
  summary: string
  description?: string
}

export interface SlurmJob {
  /** As squeue prints it: `123`, an array task `123_7`, or a collapsed array `123_[8-500]`. */
  id: string
  partition: string
  /** Only for scope 'partitions' - with 'mine' every job is the SSH user's. */
  user?: string
  state: string
  elapsed: string
  timeLimit: string
  nodes: number
  /** Start time for a running job, expected start for a pending one; null when Slurm has none. */
  start: string | null
  /** Pending reason, e.g. `(Resources)`, or the node list of a running job. */
  reason: string
  name: string
}

/** A finished (or still running) allocation of the SSH user's, from `sacct`. */
export interface SlurmHistoryJob {
  id: string
  user: string
  partition: string
  /** e.g. `COMPLETED`, `FAILED`, `TIMEOUT`, `CANCELLED by 1234`. */
  state: string
  /** `exit:signal`, e.g. `0:0` or `1:0`. */
  exitCode: string
  elapsed: string
  start: string | null
  /** Null while the job is still running. */
  end: string | null
  name: string
  /** CPU time actually used (sacct's TotalCPU) as a percentage of what was reserved (AllocCPUS x
   *  Elapsed) - the same figure `seff` reports. Null when Slurm didn't report enough to compute
   *  it (e.g. the job never started, or AllocCPUS/TotalCPU came back empty). */
  cpuEfficiencyPct: number | null
}

export interface SlurmPartition {
  name: string
  available: string
  totalNodes: number
  /** Node count per state (`idle`, `mixed`, `allocated`, `drained`, ...). */
  nodesByState: Record<string, number>
}

/** A down, drained or failing set of nodes, from `sinfo --list-reasons`. */
export interface SlurmNodeIssue {
  nodes: string
  state: string
  reason: string
}

/** One GPU generic-resource entry from a node's Slurm GRES config (`sinfo %G`), e.g. `gpu:a100:4`
 *  parses to `{ type: 'a100', count: 4 }`. This is static capacity Slurm was configured with, not
 *  a live utilization reading - see GpuSample for that (scoped to one job's nodes, from DCGM or
 *  an on-demand nvidia-smi sample). */
export interface SlurmGres {
  type: string
  count: number
}

/** The cluster's full compute-node inventory, from `sinfo -N` - distinct from SlurmNodeIssue
 *  (problem nodes only) and from GpuSample (one job's nodes only). A node in several partitions
 *  appears once, with every partition it belongs to. */
export interface SlurmNode {
  name: string
  partitions: string[]
  /** State flags (`down*`, `idle~`, ...) dropped, same as SlurmPartition.nodesByState. */
  state: string
  /** From `sinfo %C` (`alloc/idle/other/total`). Null if the field didn't parse. */
  cpusAllocated: number | null
  cpusTotal: number | null
  /** From `sinfo %m`, in MiB. Null if the field didn't parse. */
  memTotalMiB: number | null
  /** Empty when the node has no GRES configured (`sinfo %G` prints `(null)`), or a non-GPU-only
   *  GRES string this parser doesn't recognize. */
  gpus: SlurmGres[]
  /** From `sinfo %E` - why a down/drained node is out. Empty for healthy nodes. */
  reason: string
}

/** 'waiting': no live session to run on yet (nothing ran). 'no-slurm': squeue isn't on the login
 *  node's PATH. 'busy': slurmctld timed out or rate-limited the query. */
export type SchedulerStatus = 'ok' | 'waiting' | 'no-slurm' | 'busy' | 'error'

export interface SchedulerSnapshot {
  clusterId: string
  status: SchedulerStatus
  message?: string
  /** When the data below was fetched. A failed refresh keeps the last good data, so this can be
   *  older than the status. Null until the first successful fetch. */
  fetchedAt: string | null
  refreshing: boolean
  jobs: SlurmJob[]
  /** More jobs matched than Gate-H parses per refresh (see MAX_SLURM_JOBS). */
  truncated: boolean
  partitions: SlurmPartition[]
  nodeIssues: SlurmNodeIssue[]
  /** The cluster's full node inventory (see SlurmNode) - every node Slurm knows about, not just
   *  the problem ones in nodeIssues. */
  nodes: SlurmNode[]
  /** Null when refresh is manual, or nothing is scheduled. */
  nextRefreshAt: string | null
}

export const MAX_SLURM_JOBS = 2000

export interface GpuSample {
  host: string
  /** The GPU's index on its node. */
  gpu: string
  model: string
  utilizationPct: number | null
  memoryUsedMiB: number | null
  memoryTotalMiB: number | null
  temperatureC: number | null
}

/** The user's quota on a path's filesystem, in KiB. Limits are null when there's no limit. */
export interface StorageQuota {
  source: 'lfs' | 'mmlsquota'
  usedKiB: number
  softKiB: number | null
  hardKiB: number | null
  files: number | null
  filesHard: number | null
}

export interface StorageUsage {
  path: string
  /** As `stat -f -c %T` reports it: `lustre`, `gpfs`, `nfs`, `xfs`, ... */
  fsType: string
  /** The whole filesystem, from df - shared with everyone else on it. */
  filesystem?: { sizeKiB: number; usedKiB: number }
  quota?: StorageQuota
  error?: string
}

export interface RemoteEntry {
  name: string
  type: 'dir' | 'file' | 'link'
  size: number
  modifiedAt: string
}

export interface RemoteDirectory {
  /** Absolute, as the server resolved it. */
  path: string
  entries: RemoteEntry[]
}

/** Progress of one download or upload - sent when it starts, periodically, and once when done. */
export interface FileTransferEvent {
  id: string
  clusterId: string
  direction: 'download' | 'upload'
  name: string
  transferred: number
  total: number
  done: boolean
  error?: string
}

export interface JobTemplate {
  id: string
  name: string
  /** A batch script with `{{name}}`/`{{name:default}}` placeholders - see shared/templates.ts. */
  body: string
  createdAt: string
  updatedAt: string
}

export interface JobTemplateInput {
  id?: string
  name: string
  body: string
}

/** A saved shell command (or short block of them), inserted into a terminal's active session on
 *  click - stored per profile, like job templates, but plain text: no {{placeholder}} handling,
 *  no confirmation step, since it's typed into an interactive shell rather than submitted as a
 *  job. */
export interface Snippet {
  id: string
  name: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface SnippetInput {
  id?: string
  name: string
  body: string
}

export type ReachabilityStatus = 'online' | 'offline' | 'checking'

export interface ClusterReachability {
  clusterId: string
  status: ReachabilityStatus
  checkedAt: string
  /** How long the reachability probe itself took to get an answer, in milliseconds - only
   *  meaningful (and only set) when `status` is `'online'`; a slow-but-up login node reads
   *  differently from a fast one, which a bare online/offline light can't distinguish. */
  latencyMs?: number
}

export type NotificationKind = 'reachability' | 'jira' | 'ssh' | 'scheduler'
export type NotificationSeverity = 'info' | 'warning'

export interface ClusterNotification {
  id: string
  clusterId: string
  clusterName: string
  kind: NotificationKind
  severity: NotificationSeverity
  message: string
  createdAt: string
  read: boolean
}

/** A profile groups a set of clusters (and, by extension, their overview dashboard) under one
 *  name - e.g. separate "Work" and "Research" profiles with entirely different clusters. */
export interface Profile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface GateHApi {
  /** `process.platform` of the main process - 'darwin', 'linux' or 'win32'. */
  platform: string
  clusters: {
    /** Only the active profile's clusters - see `profiles` below. */
    list(): Promise<ClusterSummary[]>
    get(id: string): Promise<ClusterSummary | null>
    create(input: ClusterInput): Promise<ClusterSummary>
    update(id: string, input: ClusterInput): Promise<ClusterSummary>
    remove(id: string): Promise<void>
    /** Toggles this cluster's master Active/Standby switch - see Cluster.activeMonitoring. */
    setActiveMonitoring(id: string, active: boolean): Promise<ClusterSummary>
    /** Reads ~/.ssh/config (following Include directives) for candidate clusters - read-only,
     *  nothing is imported until the picker calls `create` per selected entry. */
    importFromSshConfig(): Promise<SshConfigCandidate[]>
  }
  grafana: {
    getStatus(clusterId: string): Promise<GrafanaStatusResult>
    setPanelSelection(
      clusterId: string,
      dashboardUid: string,
      panelIds: number[]
    ): Promise<ClusterSummary>
    setDashboardOrientation(
      clusterId: string,
      dashboardUid: string,
      orientation: PanelOrientation
    ): Promise<ClusterSummary>
    setPanelEmbedHeight(
      clusterId: string,
      dashboardUid: string,
      height: number
    ): Promise<ClusterSummary>
    setPanelWidths(
      clusterId: string,
      dashboardUid: string,
      widths: Record<number, number>
    ): Promise<ClusterSummary>
    /** Arms the embed session (Authorization header + frame-blocking header stripping) for this
     *  cluster's Grafana origin - call and await before pointing a <webview> at it. */
    prepareEmbed(clusterId: string): Promise<void>
    /** DCGM GPU metrics for the nodes in these Slurm node lists (`gpu[07-08]`), from the
     *  cluster's GPU datasource - see GrafanaProfile.gpuDatasourceUid. */
    gpuUsage(clusterId: string, nodelists: string[]): Promise<GpuSample[]>
  }
  jira: {
    list(clusterId: string, filter?: JiraListFilter): Promise<JiraIssueSummary[]>
    /** Unresolved tickets in the cluster's Jira scope. */
    openCount(clusterId: string): Promise<number>
    create(clusterId: string, input: CreateJiraIssueInput): Promise<JiraIssueSummary>
    /** Tickets mentioning this node name, scoped by the cluster's own Jira project/JQL filter -
     *  see docs/JIRA_GUIDE.md section 4. */
    searchNode(clusterId: string, nodeName: string): Promise<JiraIssueSummary[]>
  }
  ssh: {
    connect(clusterId: string): Promise<{ sessionId: string }>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    disconnect(sessionId: string): void
    onData(callback: (event: SshDataEvent) => void): () => void
    onClosed(callback: (event: SshClosedEvent) => void): () => void
    onError(callback: (event: SshErrorEvent) => void): () => void
  }
  teleport: {
    /** Current session state for every Teleport cluster, keyed by cluster id. */
    sessions(): Promise<Record<string, TeleportSessionInfo>>
    /** Pushed whenever a cluster's session changes: a login or logout (in Gate-H or in any
     *  terminal), the 15-minute warning, and expiry. */
    onSessions(callback: (sessions: Record<string, TeleportSessionInfo>) => void): () => void
    /** Runs the interactive login for this cluster's proxy on a PTY. Its output, input, resize
     *  and close use the ssh.* session calls and events. `renew` signs out first, so a still-valid
     *  session is replaced instead of reused. */
    login(clusterId: string, options: { renew: boolean }): Promise<{ sessionId: string }>
  }
  scheduler: {
    /** Every cluster's last-known snapshot (keyed by cluster id), for the Overview dashboard -
     *  which shows every cluster at once but never opens a connection itself, so a cluster that's
     *  never been connected simply has no entry. */
    getCached(): Promise<Record<string, SchedulerSnapshot>>
    /** Starts pushing this cluster's snapshots over onSnapshot (the cached one straight away) and
     *  polls while at least one watcher remains - call unwatch when the section is hidden. */
    watch(clusterId: string): void
    unwatch(clusterId: string): void
    /** Refreshes now; ignored within 10s of the last run. */
    refresh(clusterId: string): void
    onSnapshot(callback: (snapshot: SchedulerSnapshot) => void): () => void
    /** The tasks of a collapsed job array, run once on request. */
    arrayTasks(clusterId: string, arrayJobId: string): Promise<SlurmJob[]>
    /** The SSH user's jobs over the last `days` (1 or 7) days, newest first, run once on request. */
    history(clusterId: string, days: number, allUsers?: boolean): Promise<SlurmHistoryJob[]>
    /** Submits a rendered batch script with `sbatch` - after the main process asks the user to
     *  confirm in a native dialog. Resolves with the job id, or null if the user declined. */
    submit(clusterId: string, script: string, label: string): Promise<string | null>
    /** Cancels one of the user's own queued or running jobs with `scancel`, after a native
     *  confirmation. Resolves false if the user declined. */
    cancel(clusterId: string, jobId: string): Promise<boolean>
    /** One nvidia-smi on each node of one of the user's own running jobs, run once on request. */
    sampleGpus(clusterId: string, jobId: string, nodes: number): Promise<GpuSample[]>
  }
  templates: {
    /** The active profile's batch script templates. */
    list(): Promise<JobTemplate[]>
    save(input: JobTemplateInput): Promise<JobTemplate>
    remove(id: string): Promise<void>
  }
  snippets: {
    /** The active profile's saved shell commands. */
    list(): Promise<Snippet[]>
    save(input: SnippetInput): Promise<Snippet>
    remove(id: string): Promise<void>
  }
  storage: {
    /** Usage and quota for the cluster's configured paths, run once on request. */
    usage(clusterId: string, extraPaths?: string[]): Promise<StorageUsage[]>
  }
  files: {
    /** A remote directory over SFTP on the terminal's connection; defaults to the home directory. */
    list(clusterId: string, path?: string): Promise<RemoteDirectory>
    /** Asks where to save (a native dialog), then downloads. Resolves false if cancelled. */
    download(clusterId: string, remotePath: string): Promise<boolean>
    /** Asks which local files to upload (a native dialog) into `remoteDir`, confirming before
     *  overwriting. Resolves with how many were uploaded. */
    upload(clusterId: string, remoteDir: string): Promise<number>
    onTransfer(callback: (event: FileTransferEvent) => void): () => void
  }
  azure: {
    /** Subscriptions cached by the local Azure CLI - rejects if it isn't installed or logged in. */
    listSubscriptions(): Promise<AzureSubscription[]>
    /** Searches every enabled subscription for a VM by name - there's no single `az` command for
     *  "which subscription is this VM in". */
    findVm(vmName: string): Promise<AzureVmMatch[]>
    /** Opens (or reuses) the cluster's tunnel and checks it actually passes traffic through to a
     *  live sshd - see `AzureTunnelVerifyResult`. Progress streams through `onStatus` meanwhile,
     *  same as a real connect. */
    verifyTunnel(clusterId: string): Promise<AzureTunnelVerifyResult>
    /** Progress of a cluster's tunnel pre-flight (auth, subscription, tunnel up/down). */
    onStatus(callback: (event: AzureTunnelStatusEvent) => void): () => void
    /** The local Azure CLI's cached sign-in state - checked before a connect attempt (and again
     *  on a connect failure) so the Terminal can show "Azure authentication required" instead of
     *  a generic connection error. `clusterId` picks which cluster's tunnel config to read its
     *  tenant from, so two clusters in different tenants (same account) are checked
     *  independently - a valid sign-in for one tenant doesn't read as valid for the other. */
    checkAuth(clusterId: string): Promise<AzureAuthState>
    /** Runs `az login` (device-code on a headless Linux box, the system browser otherwise),
     *  broadcasting progress through `onStatus` the same way a tunnel pre-flight does. Resolves
     *  once signed in; never attempted automatically, only from an explicit "Authenticate" click. */
    login(clusterId: string, deviceCode?: boolean): Promise<void>
    /** Signs the cluster's tenant out by deleting its app-owned Azure CLI profile (other tenants'
     *  sessions are untouched); a cluster with no tenant runs `az account clear` on the CLI's
     *  default profile instead. Never attempted automatically, only from an explicit "Clear cached
     *  sign-in" click. */
    clearAuth(clusterId: string): Promise<void>
  }
  reachability: {
    getAll(): Promise<Record<string, ClusterReachability>>
    onUpdate(callback: (event: ClusterReachability) => void): () => void
  }
  notifications: {
    list(): Promise<ClusterNotification[]>
    markRead(id: string): void
    markAllRead(): void
    delete(id: string): void
    clearAll(): void
    onCreated(callback: (notification: ClusterNotification) => void): () => void
  }
  windowControls: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChange(callback: (maximized: boolean) => void): () => void
  }
  profiles: {
    list(): Promise<Profile[]>
    getActiveId(): Promise<string>
    setActiveId(id: string): void
    create(name: string): Promise<Profile>
    rename(id: string, name: string): Promise<Profile>
    /** Rejects if this would delete the last remaining profile. */
    remove(id: string): Promise<void>
    countClusters(id: string): Promise<number>
  }
  layout: {
    /** Always resolves to a valid layout - falls back to DEFAULT_PANEL_LAYOUT if nothing was
     *  saved yet or the saved value doesn't parse. */
    get(): Promise<PanelLayout>
    set(layout: PanelLayout): void
  }
  overview: {
    /** Always resolves to a valid mode - falls back to DEFAULT_OVERVIEW_VIEW_MODE if nothing was
     *  saved yet or the saved value doesn't parse. */
    getViewMode(): Promise<OverviewViewMode>
    setViewMode(mode: OverviewViewMode): void
  }
  statusLayout: {
    /** Always resolves to a valid layout - falls back to DEFAULT_STATUS_LAYOUT if nothing was
     *  saved yet or the saved value doesn't parse. */
    get(): Promise<StatusLayout>
    set(layout: StatusLayout): void
  }
  sidebarWidth: {
    /** Always resolves to a valid width - falls back to DEFAULT_SIDEBAR_WIDTH if nothing was
     *  saved yet or the saved value is out of range/doesn't parse. */
    get(): Promise<number>
    set(width: number): void
  }
  clusterOrder: {
    /** Always resolves to a valid order - falls back to DEFAULT_CLUSTER_ORDER (empty, meaning
     *  "use incoming order") if nothing was saved yet or the saved value doesn't parse. */
    get(): Promise<ClusterOrder>
    set(order: ClusterOrder): void
  }
}
