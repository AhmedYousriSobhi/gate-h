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
}

export type JiraAuthMode = 'cloud' | 'datacenter'

export interface JiraProfile {
  baseUrl: string
  authMode: JiraAuthMode
  /** Required for authMode "cloud" (Basic auth = email + API token). */
  email?: string
  projectKey?: string
  jql?: string
}

export interface Cluster {
  id: string
  name: string
  description: string
  tags: string[]
  connection: ConnectionProfile
  grafana: GrafanaProfile | null
  jira: JiraProfile | null
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
}

export interface SshErrorEvent {
  sessionId: string
  message: string
}

export interface GrafanaHealth {
  ok: boolean
  version?: string
  message?: string
}

export interface GrafanaDashboardStatus {
  uid: string
  title: string
  url: string
  panelCount: number
  snapshotDataUrl: string | null
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
  }
  grafana: {
    getStatus(clusterId: string): Promise<GrafanaStatusResult>
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
