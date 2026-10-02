// Types shared between the main process and the renderer (over the preload bridge).
// Any field named *Secret carries a plaintext value only in-transit from a form submission;
// it is encrypted with `safeStorage` before it touches disk and is never round-tripped back
// to the renderer once saved (see src/main/secrets.ts).

export type SshAuthMethod = 'password' | 'private-key' | 'agent'

/** An optional hop dialed before the cluster's base connection method (Direct or an Azure tunnel)
 *  reaches its own target. Composable with either one: the base method connects to this host
 *  first, then an ssh2 `forwardOut` reaches `ConnectionProfile.host`/`port`, whose meaning as the
 *  final interactive target never changes. Not usable with Teleport (see TeleportConfig) - every
 *  node Teleport can route to presents a certificate-format host key, which the `ssh2` package
 *  this app uses cannot verify. Its own secret is `ClusterInput.jumpHostSecret`/
 *  `ClusterSummary.hasJumpHostSecret`; when unset, falls back to reusing the connection's own
 *  secret if `authMethod` matches (legacy behavior). */
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
 *  connects. SSH then dials 127.0.0.1:`localPort` instead of dialing a host directly. Without a
 *  jump host, the tunnel's far end is `connection.host`/`port` - the Bastion target VM, or
 *  (az-ssh) the login node as seen from the VM - and the identity its host key is pinned under.
 *  With `connection.jumpHost` set, the tunnel's far end is the jump host instead, and a normal
 *  ssh2 hop from there reaches `connection.host`/`port`. No secrets: the Azure CLI keeps its own
 *  token cache. */
export interface AzureTunnelConfig {
  mode: AzureTunnelMode
  /** Required - the app runs the script non-interactively, so it can't show the picker. */
  subscription: string
  tenant?: string
  resourceGroup: string
  localPort: number
  /** The port the tunnel targets on the far side (`--resource-port`/`--remote-port`). Defaults to
   *  the jump host's port, or `connection.port` without one, when unset - but it's independently
   *  settable because it isn't always the same number: Azure Bastion's IP-based connect
   *  (`targetIpAddress`) only ever allows 22 or 3389 here regardless of what the real sshd port
   *  is, so this can't be inferred from the connection profile alone. */
  remotePort?: number
  /** mode "bastion" */
  bastionName?: string
  /** mode "bastion": full ARM resource id of the target VM. If absent, `vmName` is resolved to
   *  one via `az vm show` when the tunnel opens. */
  targetResourceId?: string
  /** mode "az-ssh": VM name (required). mode "bastion": alternative to `targetResourceId`. */
  vmName?: string
  /** mode "bastion": IP address of the target, needing no VM resource id at all - for a target in
   *  a different resource group (or subscription/tenant) than the Bastion host, or one that isn't
   *  an Azure VM resource. Needs "IP-based connection" enabled on the Bastion host. Alternative to
   *  `targetResourceId`/`vmName`. */
  targetIpAddress?: string
  localUser?: string
}

export type AzureTunnelPhase =
  'auth' | 'subscription' | 'tunnel' | 'active' | 'degraded' | 'down' | 'error'

export interface AzureTunnelStatusEvent {
  clusterId: string
  phase: AzureTunnelPhase
  message: string
}

/** Result of an on-demand "verify this tunnel" check: opens/reuses the cluster's real tunnel (the
 *  same one a connect would use, not a separate test-only one), then checks whether a live sshd
 *  banner actually arrives through it - independent of SSH auth/host-key concerns, since a known
 *  az CLI bug can leave a tunnel's local port listening after its underlying session has silently
 *  died (azure-cli#28367), which looks identical to a healthy tunnel until something tries to use
 *  it. */
export interface AzureTunnelVerifyResult {
  tunnelOpened: boolean
  /** Set when `tunnelOpened` is false - the real `az` CLI failure reason. */
  tunnelError?: string
  /** Whether an SSH banner arrived through the tunnel within the check's timeout. Only meaningful
   *  when `tunnelOpened` is true. */
  bannerReceived: boolean
  latencyMs?: number
}

export type AzureAuthStatus = 'valid' | 'expired' | 'signed-out' | 'cli-missing'

/** The local Azure CLI's cached sign-in state, independent of any one cluster's subscription -
 *  checked before a tunnel connect attempt instead of letting it fail and only then explaining
 *  why (see `GateHApi.azure.checkAuth`). */
export interface AzureAuthState {
  status: AzureAuthStatus
  /** The cached account's sign-in name. Present even when `status` is 'expired' - `az account
   *  show` reads only the local cache and succeeds even with an expired refresh token - but
   *  absent when signed out or when the CLI itself is missing. */
  account?: string
}

export interface AzureSubscription {
  id: string
  name: string
  isDefault: boolean
}

/** One VM found by `findVm`, naming which subscription/resource group it actually lives in. */
export interface AzureVmMatch {
  subscriptionId: string
  subscriptionName: string
  resourceGroup: string
  /** Full ARM resource id - usable directly as a Bastion tunnel's target resource ID. */
  id: string
}

/** A cluster reached through a Teleport proxy. Gate-H runs resources/teleport.sh in a PTY, so
 *  the session check and any login (password/OTP prompts, or SSO in the browser) happen in the
 *  terminal before `tsh ssh` takes over. `connection.host` is the Teleport node name and
 *  `connection.username` the login; port, auth method and jump host don't apply - every node
 *  Teleport can route to presents a certificate-format host key that the `ssh2` package this app
 *  uses for jump-host chaining cannot verify, so a jump host can't be layered on top (see
 *  JumpHostConfig). No secrets: tsh keeps its own certificates in ~/.tsh. */
export interface TeleportConfig {
  /** host[:port] of the Teleport proxy, e.g. teleport.example.com:443 */
  proxy: string
  /** Leaf cluster to route through, if the node isn't in the proxy's root cluster. */
  cluster?: string
  /** Teleport user, if it differs from the local OS user. */
  user?: string
  /** Auth connector name (e.g. an SSO connector), if not the cluster's default. */
  authConnector?: string
  /** Skips verifying the proxy's TLS certificate (tsh's own --insecure) - only for a self-signed
   *  or lab proxy with no real CA to point SSL_CERT_FILE at instead. Off by default: this is a
   *  real reduction in protection against a machine-in-the-middle, not a default anyone should
   *  opt into without knowing that's the trade. */
  insecure?: boolean
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
  /** Run Slurm commands against this internal node instead of the terminal's primary target -
   *  for a bastion/login node that doesn't host Slurm itself. Reached with one more ssh2
   *  `forwardOut` hop from the cluster's existing connection (which already covers any jump host
   *  or Azure tunnel), or `tsh ssh --no-login` to this host for a Teleport cluster. `port`
   *  defaults to `connection.port`. Same identity/credentials as `connection` - no secrets here. */
  execTarget?: { host: string; port?: number } | null
}

export const MIN_SCHEDULER_INTERVAL_SEC = 30
export const DEFAULT_SCHEDULER_INTERVAL_SEC = 60
/** Partition names are passed to squeue/sinfo on the remote shell, so only these are accepted. */
export const SLURM_PARTITION_PATTERN = /^[A-Za-z0-9_.-]+$/

/** Paths whose usage and quota the Status widget can check, e.g. `~` or `/scratch/$USER`. */
export interface StorageConfig {
  paths: string[]
  /** Off (the default) means checked only on request. Mirrors SchedulerConfig.autoRefresh, but
   *  optional rather than required - absent in configs saved before this existed = off, the same
   *  convention as SchedulerConfig.notify. */
  autoRefresh?: boolean
  /** Only meaningful when autoRefresh is on. Absent = DEFAULT_STORAGE_INTERVAL_SEC. */
  intervalSec?: number
}

// Longer than Slurm's floor/default: a quota check hits the filesystem's metadata servers, and
// usage doesn't change minute to minute the way a job queue does.
export const MIN_STORAGE_INTERVAL_SEC = 60
export const DEFAULT_STORAGE_INTERVAL_SEC = 300

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
  jumpHostSecret?: string // jump host's own password or private-key passphrase
  grafana: GrafanaProfile | null
  grafanaApiToken?: string
  jira: JiraProfile | null
  jiraApiToken?: string
  azureTunnel: AzureTunnelConfig | null
  teleport: TeleportConfig | null
  scheduler: SchedulerConfig | null
  storage: StorageConfig | null
}

/** One `Host` block read from ~/.ssh/config, ready to become a cluster's SSH connection - no
 *  secret ever comes from here (a password isn't in ssh_config at all, and a private key's path
 *  is not its contents). `hasProxy` flags a ProxyJump/ProxyCommand directive that isn't imported,
 *  so the picker can say a jump host still needs configuring by hand instead of silently
 *  dropping it. */
export interface SshConfigCandidate {
  name: string
  host: string
  port: number
  username?: string
  privateKeyPath?: string
  hasProxy: boolean
}

/** What the renderer receives when listing/reading clusters - secrets are never sent back. */
export type ClusterSummary = Cluster & {
  hasConnectionSecret: boolean
  hasJumpHostSecret: boolean
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

/** The Overview dashboard's layout: a card per cluster (the default), or a dense table row per
 *  cluster for a fleet too large for cards to stay useful. Persisted like PanelLayout above. */
export type OverviewViewMode = 'cards' | 'table'
export const DEFAULT_OVERVIEW_VIEW_MODE: OverviewViewMode = 'cards'

// Which sections the Status widget itself shows - independent of whether Status as a whole is
// visible in PanelLayout above. Same shape and persistence pattern as PanelLayout, one layer down.
export type StatusWidgetType = 'grafana' | 'slurm' | 'storage' | 'jira'
export const ALL_STATUS_WIDGET_TYPES: StatusWidgetType[] = ['grafana', 'slurm', 'storage', 'jira']

export interface StatusLayout {
  visible: StatusWidgetType[]
}

export const DEFAULT_STATUS_LAYOUT: StatusLayout = {
  visible: ALL_STATUS_WIDGET_TYPES
}

// The cluster sidebar's drag-resizable width in px - persisted like PanelLayout above, one shared
// preference for the whole app rather than per-cluster state.
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
export const DEFAULT_SIDEBAR_WIDTH = 272

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
  snippets: {
    /** The active profile's saved shell commands. */
    list(): Promise<Snippet[]>
    save(input: SnippetInput): Promise<Snippet>
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
     *  a generic connection error. `clusterId` only picks which cluster's tunnel config to read
     *  (e.g. its tenant); the result isn't scoped to that cluster's subscription. */
    checkAuth(clusterId: string): Promise<AzureAuthState>
    /** Runs `az login` (device-code on a headless Linux box, the system browser otherwise),
     *  broadcasting progress through `onStatus` the same way a tunnel pre-flight does. Resolves
     *  once signed in; never attempted automatically, only from an explicit "Authenticate" click. */
    login(clusterId: string): Promise<void>
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
}
