// Types shared between the main process and the renderer (over the preload bridge).
// Any field named *Secret carries a plaintext value only in-transit from a form submission;
// it is encrypted with `safeStorage` before it touches disk and is never round-tripped back
// to the renderer once saved (see src/main/secrets.ts).

export type SshAuthMethod = 'password' | 'private-key' | 'agent'

export interface JumpHostConfig {
  host: string
  port: number
  username: string
  authMethod: SshAuthMethod
  privateKeyPath?: string
}

export interface ConnectionProfile {
  host: string
  port: number
  username: string
  authMethod: SshAuthMethod
  privateKeyPath?: string
  jumpHost?: JumpHostConfig
}

export interface GrafanaProfile {
  baseUrl: string
  /** Dashboard UIDs to surface on this cluster's status screen. */
  dashboardUids: string[]
  /** Which panel IDs to snapshot per dashboard UID - keyed by uid, absent/empty means "default to
   *  the dashboard's first panel" (see getDashboardStatus in src/main/grafana/client.ts). Picked
   *  interactively from the status panel, not the cluster edit form. */
  panelSelections?: Record<string, number[]>
  /** Layout of a dashboard's selected panels within its card - keyed by uid, defaults to
   *  'vertical' (stacked) when unset. See PanelOrientation below - same concept as the
   *  Terminal/Status split, reused here for consistency. */
  panelOrientation?: Record<string, PanelOrientation>
  /** Height in px of a dashboard's embedded panels - keyed by uid, defaults to 240 when unset.
   *  Applies to every selected panel in that dashboard uniformly, in either orientation. */
  panelEmbedHeight?: Record<string, number>
  /** Relative width share of a dashboard's selected panels when shown side by side - keyed by
   *  uid, then by panel ID, fractions summing to 1 across the current selection. Ignored in
   *  'vertical' orientation. Missing or stale entries (a panel added/removed since last saved)
   *  fall back to an equal split - see normalizePanelWidths in src/main/grafana/client.ts. */
  panelWidths?: Record<string, Record<number, number>>
  /** UID of the Prometheus datasource holding NVIDIA DCGM exporter metrics, for the Slurm
   *  section's GPU usage. Unset: GPU usage is only available by sampling a job with nvidia-smi. */
  gpuDatasourceUid?: string
  /** The metric label naming the node, as Slurm names it. DCGM exporter's default is `Hostname`. */
  gpuHostLabel?: string
}

/** A Prometheus label name - it goes into a PromQL selector. */
export const PROMETHEUS_LABEL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export const DEFAULT_PANEL_EMBED_HEIGHT = 240
export const MIN_PANEL_EMBED_HEIGHT = 120
export const MAX_PANEL_EMBED_HEIGHT = 640
/** Floor on a side-by-side panel's width share (of 1) so dragging its neighbor never squeezes it
 *  into illegibility. */
export const MIN_PANEL_WIDTH_FRACTION = 0.12

export type JiraAuthMode = 'cloud' | 'datacenter'

export interface JiraProfile {
  baseUrl: string
  authMode: JiraAuthMode
  /** Required for authMode "cloud" (Basic auth = email + API token). */
  email?: string
  projectKey?: string
  jql?: string
}

export type AzureTunnelMode = 'bastion' | 'az-ssh'

/** An Azure tunnel opened (via resources/azure-tunnel.sh) before this cluster's SSH session
 *  connects. SSH then dials 127.0.0.1:`localPort` instead of `connection.host`, while
 *  `connection.host`/`port` stay the tunnel's far end - the Bastion target VM, or (az-ssh) the
 *  login node as seen from the VM - and the identity its host key is pinned under. No secrets:
 *  the Azure CLI keeps its own token cache. */
export interface AzureTunnelConfig {
  mode: AzureTunnelMode
  /** Required - the app runs the script non-interactively, so it can't show the picker. */
  subscription: string
  tenant?: string
  resourceGroup: string
  localPort: number
  /** mode "bastion" */
  bastionName?: string
  targetResourceId?: string
  /** mode "az-ssh" */
  vmName?: string
  localUser?: string
}

export type AzureTunnelPhase =
  'auth' | 'subscription' | 'tunnel' | 'active' | 'degraded' | 'down' | 'error'

export interface AzureTunnelStatusEvent {
  clusterId: string
  phase: AzureTunnelPhase
  message: string
}

export interface AzureSubscription {
  id: string
  name: string
  isDefault: boolean
}

/** A cluster reached through a Teleport proxy. Gate-H runs resources/teleport.sh in a PTY, so
 *  the session check and any login (password/OTP prompts, or SSO in the browser) happen in the
 *  terminal before `tsh ssh` takes over. `connection.host` is the Teleport node name and
 *  `connection.username` the login; port, auth method and jump host don't apply. No secrets:
 *  tsh keeps its own certificates in ~/.tsh. */
export interface TeleportConfig {
  /** host[:port] of the Teleport proxy, e.g. teleport.example.com:443 */
  proxy: string
  /** Leaf cluster to route through, if the node isn't in the proxy's root cluster. */
  cluster?: string
  /** Teleport user, if it differs from the local OS user. */
  user?: string
  /** Auth connector name (e.g. an SSO connector), if not the cluster's default. */
  authConnector?: string
}

export type SchedulerScope = 'mine' | 'partitions'

/** Slurm integration for a cluster's Status widget - see docs/HPC_ORCHESTRATION.md. Commands run
 *  as the SSH user on a session that's already open, so there are no secrets here. `kind` is the
 *  only scheduler supported; PBS/LSF would add their own kinds. */
export interface SchedulerConfig {
  kind: 'slurm'
  /** 'mine': the SSH user's own jobs. 'partitions': every user's jobs, but only in `partitions` -
   *  never the whole queue, which can run to tens of thousands of rows on a large site. */
  scope: SchedulerScope
  /** Required (non-empty) for scope 'partitions'; an optional filter for 'mine'. */
  partitions: string[]
  intervalSec: number
  /** Off means refresh only on request. Defaults off for Teleport clusters, where every run is a
   *  new, audited Teleport session. */
  autoRefresh: boolean
  /** Notify when the user's jobs finish or start and when nodes go down or are drained. While
   *  the cluster is open in the background, this keeps a check every 5 minutes on its existing
   *  SSH connection (never on Teleport). Absent in configs saved before it existed = off. */
  notify?: boolean
}

export const MIN_SCHEDULER_INTERVAL_SEC = 30
export const DEFAULT_SCHEDULER_INTERVAL_SEC = 60
/** Partition names are passed to squeue/sinfo on the remote shell, so only these are accepted. */
export const SLURM_PARTITION_PATTERN = /^[A-Za-z0-9_.-]+$/

/** Paths whose usage and quota the Status widget can check, e.g. `~` or `/scratch/$USER`. */
export interface StorageConfig {
  paths: string[]
}

/** Characters allowed in a storage path, after removing `$USER`/`$HOME` - paths are passed to the
 *  remote shell, so nothing that could end the quoting or start a command. */
export const STORAGE_PATH_PATTERN = /^[A-Za-z0-9_./~-]+$/

export interface Cluster {
  id: string
  name: string
  description: string
  tags: string[]
  connection: ConnectionProfile
  grafana: GrafanaProfile | null
  jira: JiraProfile | null
  azureTunnel: AzureTunnelConfig | null
  teleport: TeleportConfig | null
  scheduler: SchedulerConfig | null
  storage: StorageConfig | null
  /** Master on/off switch for this cluster's Terminal/Grafana connections, independent of
   *  whether it's open or selected. False ("standby") means no SSH session and no Grafana
   *  polling exist for this cluster at all, even if it's selected. Defaults to true so existing
   *  clusters keep behaving exactly as before this field existed. */
  activeMonitoring: boolean
  createdAt: string
  updatedAt: string
}

/** Shape submitted from the "add/edit cluster" form. Secret fields are plaintext here only. */
export interface ClusterInput {
  name: string
  description: string
  tags: string[]
  connection: ConnectionProfile
  connectionSecret?: string // SSH password or private-key passphrase
  grafana: GrafanaProfile | null
  grafanaApiToken?: string
  jira: JiraProfile | null
  jiraApiToken?: string
  azureTunnel: AzureTunnelConfig | null
  teleport: TeleportConfig | null
  scheduler: SchedulerConfig | null
  storage: StorageConfig | null
}

/** What the renderer receives when listing/reading clusters - secrets are never sent back. */
export type ClusterSummary = Cluster & {
  hasConnectionSecret: boolean
  hasGrafanaToken: boolean
  hasJiraToken: boolean
}

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

export type ReachabilityStatus = 'online' | 'offline' | 'checking'

export interface ClusterReachability {
  clusterId: string
  status: ReachabilityStatus
  checkedAt: string
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

// The widgets a cluster's main panel can show side by side (see
// src/renderer/src/features/shell/panelLayout.ts for the renderer-side helpers built on this).
// Shared rather than renderer-only because the main process persists and validates it too.
export type WidgetType = 'terminal' | 'status'
export const ALL_WIDGET_TYPES: WidgetType[] = ['terminal', 'status']

export type PanelOrientation = 'horizontal' | 'vertical'

export interface PanelLayout {
  visible: WidgetType[]
  orientation: PanelOrientation
  /** Fraction (0.15-0.85) of the split's main-axis space given to the first visible pane (in
   *  `visible` order, i.e. after any swap). Optional so layouts saved before this field existed
   *  still parse - readers default to 0.5 when absent. */
  splitRatio?: number
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  visible: ['terminal', 'status'],
  orientation: 'horizontal',
  splitRatio: 0.5
}

export interface GateHApi {
  clusters: {
    /** Only the active profile's clusters - see `profiles` below. */
    list(): Promise<ClusterSummary[]>
    get(id: string): Promise<ClusterSummary | null>
    create(input: ClusterInput): Promise<ClusterSummary>
    update(id: string, input: ClusterInput): Promise<ClusterSummary>
    remove(id: string): Promise<void>
    /** Toggles this cluster's master Active/Standby switch - see Cluster.activeMonitoring. */
    setActiveMonitoring(id: string, active: boolean): Promise<ClusterSummary>
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
    list(clusterId: string): Promise<JiraIssueSummary[]>
    create(clusterId: string, input: CreateJiraIssueInput): Promise<JiraIssueSummary>
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
    history(clusterId: string, days: number): Promise<SlurmHistoryJob[]>
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
  storage: {
    /** Usage and quota for the cluster's configured paths, run once on request. */
    usage(clusterId: string): Promise<StorageUsage[]>
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
    /** Progress of a cluster's tunnel pre-flight (auth, subscription, tunnel up/down). */
    onStatus(callback: (event: AzureTunnelStatusEvent) => void): () => void
  }
  reachability: {
    getAll(): Promise<Record<string, ClusterReachability>>
    onUpdate(callback: (event: ClusterReachability) => void): () => void
  }
  notifications: {
    list(): Promise<ClusterNotification[]>
    markRead(id: string): void
    markAllRead(): void
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
}
