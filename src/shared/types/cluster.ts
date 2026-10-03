// Per-cluster configuration: connection, Grafana/Jira/Azure/Teleport/scheduler/storage
// settings, and the Cluster/ClusterInput/ClusterSummary shapes built from them. Split out of
// the single types.ts this file used to be part of, to keep cluster *configuration* separate
// from the UI-preference types in ./ui.ts (see GateHApi in ./index for how both come together).
import type { PanelOrientation } from './ui'

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
  /** True only once a live SSH banner actually arrived through the tunnel - `ensureTunnel` itself
   *  waits for one, so this already rules out azure-cli#28367's stale-listening-port case, not
   *  just that `az` reported the tunnel open. */
  tunnelOpened: boolean
  /** Set when `tunnelOpened` is false - the real failure reason (an `az` CLI error, or no banner
   *  within the wait). */
  tunnelError?: string
  latencyMs?: number
}

export type AzureAuthStatus = 'valid' | 'expired' | 'signed-out' | 'cli-missing'

/** The local Azure CLI's cached sign-in state, scoped to the checked cluster's tenant when it has
 *  one configured - checked before a tunnel connect attempt instead of letting it fail and only
 *  then explaining why (see `GateHApi.azure.checkAuth`). */
export interface AzureAuthState {
  status: AzureAuthStatus
  /** The cached account's sign-in name. Present even when `status` is 'expired' - reading the
   *  local cache succeeds even with an expired refresh token - but absent when signed out or when
   *  the CLI itself is missing. */
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
  /** 'mine': the SSH user's own jobs. 'partitions': every user's jobs (the name is kept for saved
   *  configs); the parsed list is capped at MAX_SLURM_JOBS on a large site. */
  scope: SchedulerScope
  /** Optional: limits the squeue query itself. The Status panel filters by partition client-side. */
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
