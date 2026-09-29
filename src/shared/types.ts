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
}

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

export type ReachabilityStatus = 'online' | 'offline' | 'checking'

export interface ClusterReachability {
  clusterId: string
  status: ReachabilityStatus
  checkedAt: string
}

export type NotificationKind = 'reachability' | 'jira' | 'ssh'
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
