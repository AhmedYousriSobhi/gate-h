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

export interface HGateApi {
  clusters: {
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
}
