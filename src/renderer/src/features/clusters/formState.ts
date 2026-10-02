import type {
  AzureTunnelMode,
  ClusterSummary,
  JiraAuthMode,
  SchedulerScope,
  SshAuthMethod
} from '../../../../shared/types'
import {
  DEFAULT_SCHEDULER_INTERVAL_SEC,
  DEFAULT_STORAGE_INTERVAL_SEC
} from '../../../../shared/types'

export interface FormState {
  name: string
  description: string
  tags: string
  host: string
  port: string
  username: string
  authMethod: SshAuthMethod
  privateKeyPath: string
  connectionSecret: string
  /** Mutually exclusive with each other; neither on means a direct connection - there's no
   *  separate "Direct" choice to make. */
  useAzureTunnel: boolean
  useTeleport: boolean
  jumpHostEnabled: boolean
  jumpHost: string
  jumpPort: string
  jumpUsername: string
  jumpAuthMethod: SshAuthMethod
  jumpPrivateKeyPath: string
  jumpHostSecret: string
  useGrafana: boolean
  grafanaBaseUrl: string
  grafanaDashboardUids: string
  grafanaApiToken: string
  grafanaGpuDatasourceUid: string
  grafanaGpuHostLabel: string
  useJira: boolean
  jiraBaseUrl: string
  jiraAuthMode: JiraAuthMode
  jiraEmail: string
  jiraProjectKey: string
  jiraJql: string
  jiraApiToken: string
  azureMode: AzureTunnelMode
  azureSubscription: string
  azureTenant: string
  azureResourceGroup: string
  azureLocalPort: string
  azureRemotePort: string
  azureBastionName: string
  azureTargetResourceId: string
  azureVmName: string
  azureTargetIpAddress: string
  azureLocalUser: string
  teleportProxy: string
  teleportCluster: string
  teleportUser: string
  teleportAuthConnector: string
  teleportInsecure: boolean
  useScheduler: boolean
  schedulerScope: SchedulerScope
  schedulerPartitions: string
  schedulerInterval: string
  schedulerAutoRefresh: boolean
  schedulerNotify: boolean
  schedulerExecHost: string
  schedulerExecPort: string
  useStorage: boolean
  storagePaths: string
  storageInterval: string
  storageAutoRefresh: boolean
}

/** Setter passed to every section component - same function, just typed once here rather than
 *  repeated per file. */
export type SetFormField = <K extends keyof FormState>(key: K, value: FormState[K]) => void

export function toFormState(c?: ClusterSummary): FormState {
  return {
    name: c?.name ?? '',
    description: c?.description ?? '',
    tags: c?.tags.join(', ') ?? '',
    host: c?.connection.host ?? '',
    port: String(c?.connection.port ?? 22),
    username: c?.connection.username ?? '',
    authMethod: c?.connection.authMethod ?? 'private-key',
    privateKeyPath: c?.connection.privateKeyPath ?? '',
    connectionSecret: '',
    useAzureTunnel: Boolean(c?.azureTunnel),
    useTeleport: Boolean(c?.teleport),
    jumpHostEnabled: Boolean(c?.connection.jumpHost),
    jumpHost: c?.connection.jumpHost?.host ?? '',
    jumpPort: String(c?.connection.jumpHost?.port ?? 22),
    jumpUsername: c?.connection.jumpHost?.username ?? '',
    jumpAuthMethod: c?.connection.jumpHost?.authMethod ?? 'private-key',
    jumpPrivateKeyPath: c?.connection.jumpHost?.privateKeyPath ?? '',
    jumpHostSecret: '',
    useGrafana: Boolean(c?.grafana),
    grafanaBaseUrl: c?.grafana?.baseUrl ?? '',
    grafanaDashboardUids: c?.grafana?.dashboardUids.join(', ') ?? '',
    grafanaApiToken: '',
    grafanaGpuDatasourceUid: c?.grafana?.gpuDatasourceUid ?? '',
    grafanaGpuHostLabel: c?.grafana?.gpuHostLabel ?? '',
    useJira: Boolean(c?.jira),
    jiraBaseUrl: c?.jira?.baseUrl ?? '',
    jiraAuthMode: c?.jira?.authMode ?? 'cloud',
    jiraEmail: c?.jira?.email ?? '',
    jiraProjectKey: c?.jira?.projectKey ?? '',
    jiraJql: c?.jira?.jql ?? '',
    jiraApiToken: '',
    azureMode: c?.azureTunnel?.mode ?? 'bastion',
    azureSubscription: c?.azureTunnel?.subscription ?? '',
    azureTenant: c?.azureTunnel?.tenant ?? '',
    azureResourceGroup: c?.azureTunnel?.resourceGroup ?? '',
    azureLocalPort: c?.azureTunnel ? String(c.azureTunnel.localPort) : '',
    azureRemotePort: c?.azureTunnel?.remotePort ? String(c.azureTunnel.remotePort) : '',
    azureBastionName: c?.azureTunnel?.bastionName ?? '',
    azureTargetResourceId: c?.azureTunnel?.targetResourceId ?? '',
    azureVmName: c?.azureTunnel?.vmName ?? '',
    azureTargetIpAddress: c?.azureTunnel?.targetIpAddress ?? '',
    azureLocalUser: c?.azureTunnel?.localUser ?? '',
    teleportProxy: c?.teleport?.proxy ?? '',
    teleportCluster: c?.teleport?.cluster ?? '',
    teleportUser: c?.teleport?.user ?? '',
    teleportAuthConnector: c?.teleport?.authConnector ?? '',
    teleportInsecure: Boolean(c?.teleport?.insecure),
    useScheduler: Boolean(c?.scheduler),
    schedulerScope: c?.scheduler?.scope ?? 'mine',
    schedulerPartitions: c?.scheduler?.partitions.join(', ') ?? '',
    schedulerInterval: String(c?.scheduler?.intervalSec ?? DEFAULT_SCHEDULER_INTERVAL_SEC),
    schedulerAutoRefresh: c?.scheduler?.autoRefresh ?? !c?.teleport,
    schedulerNotify: c?.scheduler?.notify ?? false,
    schedulerExecHost: c?.scheduler?.execTarget?.host ?? '',
    schedulerExecPort: c?.scheduler?.execTarget?.port ? String(c.scheduler.execTarget.port) : '',
    useStorage: Boolean(c?.storage),
    storagePaths: c?.storage?.paths.join(', ') ?? '~',
    storageInterval: String(c?.storage?.intervalSec ?? DEFAULT_STORAGE_INTERVAL_SEC),
    storageAutoRefresh: c?.storage?.autoRefresh ?? false
  }
}
