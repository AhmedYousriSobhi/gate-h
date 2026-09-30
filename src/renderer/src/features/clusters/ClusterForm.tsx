import { useState } from 'react'
import {
  BarChart3,
  Cloud,
  HardDrive,
  KeyRound,
  ListChecks,
  ShieldCheck,
  Ticket,
  Waypoints
} from 'lucide-react'
import type {
  AzureSubscription,
  AzureTunnelMode,
  AzureVmMatch,
  ClusterInput,
  ClusterSummary,
  JiraAuthMode,
  SchedulerScope,
  SshAuthMethod
} from '../../../../shared/types'
import {
  DEFAULT_SCHEDULER_INTERVAL_SEC,
  MIN_SCHEDULER_INTERVAL_SEC,
  PROMETHEUS_LABEL_PATTERN,
  SLURM_PARTITION_PATTERN,
  STORAGE_PATH_PATTERN
} from '../../../../shared/types'
import { toClusterSlug } from '../../../../shared/clusterSlug'
import './clusters.css'

interface ClusterFormProps {
  initial?: ClusterSummary
  onCancel: () => void
  onSubmit: (input: ClusterInput) => Promise<void>
}

/** How the target's own SSH identity below (Host/Port/Username/...) actually gets reached - the
 *  four are mutually exclusive, so the form picks one rather than toggling three booleans. */
type ConnectionMode = 'direct' | 'jump-host' | 'azure' | 'teleport'

interface FormState {
  name: string
  description: string
  tags: string
  host: string
  port: string
  username: string
  authMethod: SshAuthMethod
  privateKeyPath: string
  connectionSecret: string
  connectionMode: ConnectionMode
  jumpHost: string
  jumpPort: string
  jumpUsername: string
  jumpAuthMethod: SshAuthMethod
  jumpPrivateKeyPath: string
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
  azureBastionName: string
  azureTargetResourceId: string
  azureVmName: string
  azureTargetIpAddress: string
  azureLocalUser: string
  teleportProxy: string
  teleportCluster: string
  teleportUser: string
  teleportAuthConnector: string
  useScheduler: boolean
  schedulerScope: SchedulerScope
  schedulerPartitions: string
  schedulerInterval: string
  schedulerAutoRefresh: boolean
  schedulerNotify: boolean
  useStorage: boolean
  storagePaths: string
}

function toFormState(c?: ClusterSummary): FormState {
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
    connectionMode: c?.teleport
      ? 'teleport'
      : c?.azureTunnel
        ? 'azure'
        : c?.connection.jumpHost
          ? 'jump-host'
          : 'direct',
    jumpHost: c?.connection.jumpHost?.host ?? '',
    jumpPort: String(c?.connection.jumpHost?.port ?? 22),
    jumpUsername: c?.connection.jumpHost?.username ?? '',
    jumpAuthMethod: c?.connection.jumpHost?.authMethod ?? 'private-key',
    jumpPrivateKeyPath: c?.connection.jumpHost?.privateKeyPath ?? '',
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
    azureBastionName: c?.azureTunnel?.bastionName ?? '',
    azureTargetResourceId: c?.azureTunnel?.targetResourceId ?? '',
    azureVmName: c?.azureTunnel?.vmName ?? '',
    azureTargetIpAddress: c?.azureTunnel?.targetIpAddress ?? '',
    azureLocalUser: c?.azureTunnel?.localUser ?? '',
    teleportProxy: c?.teleport?.proxy ?? '',
    teleportCluster: c?.teleport?.cluster ?? '',
    teleportUser: c?.teleport?.user ?? '',
    teleportAuthConnector: c?.teleport?.authConnector ?? '',
    useScheduler: Boolean(c?.scheduler),
    schedulerScope: c?.scheduler?.scope ?? 'mine',
    schedulerPartitions: c?.scheduler?.partitions.join(', ') ?? '',
    schedulerInterval: String(c?.scheduler?.intervalSec ?? DEFAULT_SCHEDULER_INTERVAL_SEC),
    schedulerAutoRefresh: c?.scheduler?.autoRefresh ?? !c?.teleport,
    schedulerNotify: c?.scheduler?.notify ?? false,
    useStorage: Boolean(c?.storage),
    storagePaths: c?.storage?.paths.join(', ') ?? '~'
  }
}

/** Returns why the GPU metrics settings can't be saved, or null if they can. */
function gpuError(form: FormState): string | null {
  const label = form.grafanaGpuHostLabel.trim()
  if (!form.useGrafana || !label || PROMETHEUS_LABEL_PATTERN.test(label)) return null
  return `GPU host label must be a Prometheus label name ("${label}").`
}

/** Returns why the storage paths can't be saved, or null if they can. */
function storageError(form: FormState): string | null {
  if (!form.useStorage) return null
  const paths = splitList(form.storagePaths)
  if (paths.length === 0) return 'Storage quota needs at least one path.'
  const bad = paths.find((path) => !STORAGE_PATH_PATTERN.test(path.replace(/\$(USER|HOME)/g, '')))
  if (bad)
    return `Storage paths may only use letters, digits, _ . / ~ - and $USER/$HOME ("${bad}").`
  return null
}

/** Returns why the Slurm settings can't be saved, or null if they can. */
function schedulerError(form: FormState): string | null {
  if (!form.useScheduler) return null
  const partitions = splitList(form.schedulerPartitions)
  const bad = partitions.find((name) => !SLURM_PARTITION_PATTERN.test(name))
  if (bad) return `Partition names may only use letters, digits, _ . and - ("${bad}").`
  if (form.schedulerScope === 'partitions' && partitions.length === 0) {
    return "Showing everyone's jobs needs at least one partition."
  }
  const interval = Number(form.schedulerInterval)
  if (!Number.isInteger(interval) || interval < MIN_SCHEDULER_INTERVAL_SEC) {
    return `Slurm refresh interval must be a whole number of seconds, at least ${MIN_SCHEDULER_INTERVAL_SEC}.`
  }
  return null
}

/** Returns why the Teleport settings can't be saved, or null if they can. */
function teleportError(form: FormState): string | null {
  if (form.connectionMode !== 'teleport') return null
  if (!form.teleportProxy.trim()) return 'Teleport needs the proxy address.'
  if (/\s/.test(form.teleportProxy.trim())) return 'Teleport proxy address must not contain spaces.'
  return null
}

/** Returns why the Azure tunnel settings can't be saved, or null if they can. */
function azureTunnelError(form: FormState): string | null {
  if (form.connectionMode !== 'azure') return null
  if (['localhost', '127.0.0.1', '::1'].includes(form.host.trim().toLowerCase())) {
    return (
      "Host must be the target machine's real hostname or IP, not localhost - SSH always dials " +
      "the tunnel's local port regardless of this field, which instead identifies the machine " +
      "for host-key trust (so it can't be shared across clusters or tunnels)."
    )
  }
  if (!form.azureSubscription.trim() || !form.azureResourceGroup.trim()) {
    return 'Azure tunnel needs a subscription and a resource group.'
  }
  const port = Number(form.azureLocalPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Azure tunnel local port must be a number between 1 and 65535.'
  }
  if (form.azureMode === 'bastion') {
    if (!form.azureBastionName.trim()) return 'Azure Bastion needs the bastion name.'
    if (
      !form.azureTargetResourceId.trim() &&
      !form.azureVmName.trim() &&
      !form.azureTargetIpAddress.trim()
    ) {
      return 'Azure Bastion needs the target VM resource ID, its VM name, or its IP address.'
    }
  }
  if (form.azureMode === 'az-ssh' && !form.azureVmName.trim()) {
    return 'az ssh vm needs the VM name.'
  }
  return null
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

const CONNECTION_MODES: { value: ConnectionMode; label: string; icon: typeof KeyRound }[] = [
  { value: 'direct', label: 'Direct', icon: KeyRound },
  { value: 'jump-host', label: 'Jump Host', icon: Waypoints },
  { value: 'azure', label: 'Azure', icon: Cloud },
  { value: 'teleport', label: 'Teleport', icon: ShieldCheck }
]

/** Segmented-control tab bar for picking how this cluster's SSH connection is reached. Standard
 *  ARIA tablist keyboard behavior: arrow keys move both selection and focus between tabs, so
 *  there's only ever one stop in the natural Tab order (the active tab). */
function ConnectionModeTabs({
  value,
  onChange
}: {
  value: ConnectionMode
  onChange: (mode: ConnectionMode) => void
}): React.JSX.Element {
  function selectAndFocus(index: number): void {
    const mode = CONNECTION_MODES[index]
    onChange(mode.value)
    document.getElementById(`connection-tab-${mode.value}`)?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number): void {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const dir = e.key === 'ArrowRight' ? 1 : -1
      selectAndFocus((index + dir + CONNECTION_MODES.length) % CONNECTION_MODES.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      selectAndFocus(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      selectAndFocus(CONNECTION_MODES.length - 1)
    }
  }

  return (
    <div className="connection-tabs" role="tablist" aria-label="How this cluster connects">
      {CONNECTION_MODES.map((mode, index) => {
        const Icon = mode.icon
        const active = mode.value === value
        return (
          <button
            key={mode.value}
            id={`connection-tab-${mode.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`connection-panel-${mode.value}`}
            tabIndex={active ? 0 : -1}
            className={`connection-tab${active ? ' active' : ''}`}
            onClick={() => onChange(mode.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            <Icon size={13} strokeWidth={2} />
            {mode.label}
          </button>
        )
      })}
    </div>
  )
}

export default function ClusterForm({
  initial,
  onCancel,
  onSubmit
}: ClusterFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [subscriptions, setSubscriptions] = useState<AzureSubscription[]>([])
  const [subscriptionsError, setSubscriptionsError] = useState<string | null>(null)
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false)
  const [vmMatches, setVmMatches] = useState<AzureVmMatch[]>([])
  const [vmLookupError, setVmLookupError] = useState<string | null>(null)
  const [vmFoundMessage, setVmFoundMessage] = useState<string | null>(null)
  const [findingVm, setFindingVm] = useState(false)

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function loadSubscriptions(): Promise<void> {
    setSubscriptionsError(null)
    setLoadingSubscriptions(true)
    try {
      const list = await window.api.azure.listSubscriptions()
      setSubscriptions(list)
    } catch (err) {
      setSubscriptionsError(err instanceof Error ? err.message : 'Failed to list subscriptions.')
    } finally {
      setLoadingSubscriptions(false)
    }
  }

  /** Fills Subscription/Resource group (and, for Bastion, the target resource ID) from a VM
   *  search match, so the exact id `findVm` already found doesn't need re-resolving at connect
   *  time. */
  function applyVmMatch(match: AzureVmMatch): void {
    setForm((prev) => ({
      ...prev,
      azureSubscription: match.subscriptionId,
      azureResourceGroup: match.resourceGroup,
      azureTargetResourceId: prev.azureMode === 'bastion' ? match.id : prev.azureTargetResourceId
    }))
    setVmMatches([])
    setVmLookupError(null)
    setVmFoundMessage(
      `Found it in "${match.subscriptionName}" / ${match.resourceGroup} - filled in above.`
    )
  }

  async function handleFindVm(): Promise<void> {
    const name = form.azureVmName.trim()
    if (!name) {
      setVmLookupError('Enter a VM name first.')
      return
    }
    setVmLookupError(null)
    setVmFoundMessage(null)
    setVmMatches([])
    setFindingVm(true)
    try {
      const matches = await window.api.azure.findVm(name)
      if (matches.length === 0) {
        setVmLookupError(`No VM named "${name}" found in any subscription you can see.`)
      } else if (matches.length === 1) {
        applyVmMatch(matches[0])
      } else {
        setVmMatches(matches)
      }
    } catch (err) {
      setVmLookupError(err instanceof Error ? err.message : 'Could not search for the VM.')
    } finally {
      setFindingVm(false)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      setError('Name, host, and username are required.')
      return
    }
    const tunnelError =
      teleportError(form) ??
      azureTunnelError(form) ??
      schedulerError(form) ??
      storageError(form) ??
      gpuError(form)
    if (tunnelError) {
      setError(tunnelError)
      return
    }

    const input: ClusterInput = {
      name: form.name.trim(),
      description: form.description.trim(),
      tags: splitList(form.tags),
      connection: {
        host: form.host.trim(),
        port: Number(form.port) || 22,
        username: form.username.trim(),
        authMethod: form.authMethod,
        privateKeyPath: form.authMethod === 'private-key' ? form.privateKeyPath.trim() : undefined,
        // Teleport routes through its proxy, never a jump host (see TeleportConfig).
        jumpHost:
          form.connectionMode === 'jump-host'
            ? {
                host: form.jumpHost.trim(),
                port: Number(form.jumpPort) || 22,
                username: form.jumpUsername.trim(),
                authMethod: form.jumpAuthMethod,
                privateKeyPath:
                  form.jumpAuthMethod === 'private-key' ? form.jumpPrivateKeyPath.trim() : undefined
              }
            : undefined
      },
      connectionSecret: form.connectionSecret || undefined,
      grafana: form.useGrafana
        ? {
            baseUrl: form.grafanaBaseUrl.trim(),
            dashboardUids: splitList(form.grafanaDashboardUids),
            gpuDatasourceUid: form.grafanaGpuDatasourceUid.trim() || undefined,
            gpuHostLabel: form.grafanaGpuHostLabel.trim() || undefined
          }
        : null,
      grafanaApiToken: form.grafanaApiToken.trim() || undefined,
      jira: form.useJira
        ? {
            baseUrl: form.jiraBaseUrl.trim(),
            authMode: form.jiraAuthMode,
            email: form.jiraAuthMode === 'cloud' ? form.jiraEmail.trim() : undefined,
            projectKey: form.jiraProjectKey.trim() || undefined,
            jql: form.jiraJql.trim() || undefined
          }
        : null,
      jiraApiToken: form.jiraApiToken.trim() || undefined,
      azureTunnel:
        form.connectionMode === 'azure'
          ? {
              mode: form.azureMode,
              subscription: form.azureSubscription.trim(),
              tenant: form.azureTenant.trim() || undefined,
              resourceGroup: form.azureResourceGroup.trim(),
              localPort: Number(form.azureLocalPort),
              bastionName: form.azureMode === 'bastion' ? form.azureBastionName.trim() : undefined,
              targetResourceId:
                form.azureMode === 'bastion'
                  ? form.azureTargetResourceId.trim() || undefined
                  : undefined,
              vmName:
                form.azureMode === 'az-ssh' || form.azureMode === 'bastion'
                  ? form.azureVmName.trim() || undefined
                  : undefined,
              targetIpAddress:
                form.azureMode === 'bastion'
                  ? form.azureTargetIpAddress.trim() || undefined
                  : undefined,
              localUser:
                form.azureMode === 'az-ssh' ? form.azureLocalUser.trim() || undefined : undefined
            }
          : null,
      teleport:
        form.connectionMode === 'teleport'
          ? {
              proxy: form.teleportProxy.trim(),
              cluster: form.teleportCluster.trim() || undefined,
              user: form.teleportUser.trim() || undefined,
              authConnector: form.teleportAuthConnector.trim() || undefined
            }
          : null,
      scheduler: form.useScheduler
        ? {
            kind: 'slurm',
            scope: form.schedulerScope,
            partitions: splitList(form.schedulerPartitions),
            intervalSec: Number(form.schedulerInterval),
            autoRefresh: form.schedulerAutoRefresh,
            notify: form.schedulerNotify && form.connectionMode !== 'teleport'
          }
        : null,
      storage: form.useStorage ? { paths: splitList(form.storagePaths) } : null
    }

    setSaving(true)
    try {
      await onSubmit(input)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cluster.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{initial ? `Edit ${initial.name}` : 'Add cluster'}</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="tags">Tags (comma separated)</label>
            <input id="tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          </div>

          <div className="form-section">
            <h4>
              <KeyRound size={13} strokeWidth={2} />
              SSH connection
            </h4>
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="host">
                  {form.connectionMode === 'teleport' ? 'Teleport node name' : 'Host'}
                </label>
                <input
                  id="host"
                  placeholder={
                    form.connectionMode === 'teleport' ? 'slogin1 (as listed by tsh ls)' : undefined
                  }
                  value={form.host}
                  onChange={(e) => set('host', e.target.value)}
                />
              </div>
              {form.connectionMode !== 'teleport' && (
                <div className="form-field">
                  <label htmlFor="port">Port</label>
                  <input
                    id="port"
                    value={form.port}
                    onChange={(e) => set('port', e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="username">
                  {form.connectionMode === 'teleport' ? 'Login' : 'Username'}
                </label>
                <input
                  id="username"
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                />
              </div>
              {form.connectionMode !== 'teleport' && (
                <div className="form-field">
                  <label htmlFor="authMethod">Auth method</label>
                  <select
                    id="authMethod"
                    value={form.authMethod}
                    onChange={(e) => set('authMethod', e.target.value as SshAuthMethod)}
                  >
                    <option value="private-key">Private key</option>
                    <option value="password">Password</option>
                    <option value="agent">SSH agent</option>
                  </select>
                </div>
              )}
            </div>
            {form.connectionMode !== 'teleport' && form.authMethod === 'private-key' && (
              <div className="form-field">
                <label htmlFor="privateKeyPath">Private key path</label>
                <input
                  id="privateKeyPath"
                  placeholder="~/.ssh/id_ed25519"
                  value={form.privateKeyPath}
                  onChange={(e) => set('privateKeyPath', e.target.value)}
                />
              </div>
            )}
            {form.connectionMode !== 'teleport' && form.authMethod !== 'agent' && (
              <div className="form-field">
                <label htmlFor="connectionSecret">
                  {form.authMethod === 'password' ? 'Password' : 'Key passphrase (if any)'}
                </label>
                <input
                  id="connectionSecret"
                  type="password"
                  value={form.connectionSecret}
                  onChange={(e) => set('connectionSecret', e.target.value)}
                  placeholder={
                    initial?.hasConnectionSecret ? 'Unchanged - leave blank to keep' : ''
                  }
                />
              </div>
            )}
          </div>

          <div className="form-section">
            <h4>How does Gate-H reach it?</h4>
            <ConnectionModeTabs
              value={form.connectionMode}
              onChange={(mode) => set('connectionMode', mode)}
            />

            {form.connectionMode === 'direct' && (
              <p
                className="hint connection-panel"
                id="connection-panel-direct"
                role="tabpanel"
                aria-labelledby="connection-tab-direct"
              >
                Connects straight to the host above over SSH. Nothing else to configure.
              </p>
            )}

            {form.connectionMode === 'jump-host' && (
              <div
                className="connection-panel"
                id="connection-panel-jump-host"
                role="tabpanel"
                aria-labelledby="connection-tab-jump-host"
              >
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="jumpHost">Jump host</label>
                    <input
                      id="jumpHost"
                      value={form.jumpHost}
                      onChange={(e) => set('jumpHost', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="jumpPort">Jump port</label>
                    <input
                      id="jumpPort"
                      value={form.jumpPort}
                      onChange={(e) => set('jumpPort', e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="jumpUsername">Jump username</label>
                    <input
                      id="jumpUsername"
                      value={form.jumpUsername}
                      onChange={(e) => set('jumpUsername', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="jumpAuthMethod">Jump auth method</label>
                    <select
                      id="jumpAuthMethod"
                      value={form.jumpAuthMethod}
                      onChange={(e) => set('jumpAuthMethod', e.target.value as SshAuthMethod)}
                    >
                      <option value="private-key">Private key</option>
                      <option value="password">Password</option>
                      <option value="agent">SSH agent</option>
                    </select>
                  </div>
                </div>
                {form.jumpAuthMethod === 'private-key' && (
                  <div className="form-field">
                    <label htmlFor="jumpPrivateKeyPath">Jump host private key path</label>
                    <input
                      id="jumpPrivateKeyPath"
                      value={form.jumpPrivateKeyPath}
                      onChange={(e) => set('jumpPrivateKeyPath', e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {form.connectionMode === 'teleport' && (
              <div
                className="connection-panel"
                id="connection-panel-teleport"
                role="tabpanel"
                aria-labelledby="connection-tab-teleport"
              >
                <p className="hint">
                  The terminal runs tsh ssh through this proxy. If there&apos;s no valid tsh
                  session, you log in right in the terminal: password and OTP prompts appear there,
                  or your browser opens for SSO. Needs tsh on PATH. See docs/TELEPORT.md.
                </p>
                <div className="form-field">
                  <label htmlFor="teleportProxy">Proxy address</label>
                  <input
                    id="teleportProxy"
                    placeholder="teleport.example.com:443"
                    value={form.teleportProxy}
                    onChange={(e) => set('teleportProxy', e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="teleportCluster">Leaf cluster (optional)</label>
                    <input
                      id="teleportCluster"
                      value={form.teleportCluster}
                      onChange={(e) => set('teleportCluster', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="teleportUser">Teleport user (optional)</label>
                    <input
                      id="teleportUser"
                      placeholder="Blank = your OS user"
                      value={form.teleportUser}
                      onChange={(e) => set('teleportUser', e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="teleportAuthConnector">Auth connector (optional)</label>
                  <input
                    id="teleportAuthConnector"
                    placeholder="Blank = the cluster's default"
                    value={form.teleportAuthConnector}
                    onChange={(e) => set('teleportAuthConnector', e.target.value)}
                  />
                </div>
              </div>
            )}

            {form.connectionMode === 'azure' && (
              <div
                className="connection-panel"
                id="connection-panel-azure"
                role="tabpanel"
                aria-labelledby="connection-tab-azure"
              >
                <p className="hint">
                  Before connecting, Gate-H signs in with the Azure CLI (az), selects this
                  subscription, and opens a tunnel. SSH then connects to 127.0.0.1 on the local
                  port, and Host/Port above are the tunnel&apos;s far end: the target VM&apos;s real
                  hostname or IP (Bastion), or the login node as the VM reaches it (az ssh vm) -
                  never localhost, since that field is what host-key trust is pinned to, not the
                  actual tunnel address. Needs az on PATH. See the README section on clusters
                  reachable only through Azure.
                </p>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="azureMode">Tunnel through</label>
                    <select
                      id="azureMode"
                      value={form.azureMode}
                      onChange={(e) => set('azureMode', e.target.value as AzureTunnelMode)}
                    >
                      <option value="bastion">Azure Bastion</option>
                      <option value="az-ssh">VM via az ssh vm</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="azureLocalPort">Local port</label>
                    <input
                      id="azureLocalPort"
                      placeholder="2222"
                      value={form.azureLocalPort}
                      onChange={(e) => set('azureLocalPort', e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="azureSubscription">Subscription (ID or name)</label>
                  <div className="form-inline">
                    <input
                      id="azureSubscription"
                      placeholder="Subscription ID or name"
                      value={form.azureSubscription}
                      onChange={(e) => set('azureSubscription', e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={loadSubscriptions}
                      disabled={loadingSubscriptions}
                    >
                      {loadingSubscriptions ? 'Loading...' : 'Load from az'}
                    </button>
                  </div>
                  {subscriptions.length > 0 && (
                    <select
                      aria-label="Pick a subscription fetched from az"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) set('azureSubscription', e.target.value)
                      }}
                    >
                      <option value="">
                        {subscriptions.length} subscription{subscriptions.length === 1 ? '' : 's'}{' '}
                        found - pick one...
                      </option>
                      {subscriptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.id}){s.isDefault ? ' - az default' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {subscriptionsError && <p className="hint">{subscriptionsError}</p>}
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="azureResourceGroup">Resource group</label>
                    <input
                      id="azureResourceGroup"
                      value={form.azureResourceGroup}
                      onChange={(e) => set('azureResourceGroup', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="azureTenant">Tenant ID (optional)</label>
                    <input
                      id="azureTenant"
                      value={form.azureTenant}
                      onChange={(e) => set('azureTenant', e.target.value)}
                    />
                  </div>
                </div>
                {form.azureMode === 'bastion' ? (
                  <>
                    <div className="form-field">
                      <label htmlFor="azureBastionName">Bastion name</label>
                      <input
                        id="azureBastionName"
                        value={form.azureBastionName}
                        onChange={(e) => set('azureBastionName', e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="azureTargetResourceId">
                        Target VM resource ID (optional)
                      </label>
                      <input
                        id="azureTargetResourceId"
                        placeholder="/subscriptions/.../resourceGroups/.../providers/Microsoft.Compute/virtualMachines/..."
                        value={form.azureTargetResourceId}
                        onChange={(e) => set('azureTargetResourceId', e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="azureVmName">or VM name</label>
                      <div className="form-inline">
                        <input
                          id="azureVmName"
                          placeholder="Resolved to a resource ID via `az vm show` when opened"
                          value={form.azureVmName}
                          onChange={(e) => set('azureVmName', e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={handleFindVm}
                          disabled={findingVm || !form.azureVmName.trim()}
                        >
                          {findingVm ? 'Searching...' : 'Find subscription'}
                        </button>
                      </div>
                    </div>
                    <div className="form-field">
                      <label htmlFor="azureTargetIpAddress">or IP address</label>
                      <input
                        id="azureTargetIpAddress"
                        placeholder="No VM resource id needed - e.g. a different resource group"
                        value={form.azureTargetIpAddress}
                        onChange={(e) => set('azureTargetIpAddress', e.target.value)}
                      />
                      <p className="hint">
                        Needs &quot;IP-based connection&quot; enabled on this Bastion host. Use this
                        when the target isn&apos;t in this Bastion&apos;s resource group (or
                        subscription/tenant), or isn&apos;t an Azure VM resource at all.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="azureVmName">VM name</label>
                      <div className="form-inline">
                        <input
                          id="azureVmName"
                          value={form.azureVmName}
                          onChange={(e) => set('azureVmName', e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={handleFindVm}
                          disabled={findingVm || !form.azureVmName.trim()}
                        >
                          {findingVm ? 'Searching...' : 'Find subscription'}
                        </button>
                      </div>
                    </div>
                    <div className="form-field">
                      <label htmlFor="azureLocalUser">Local VM user (optional)</label>
                      <input
                        id="azureLocalUser"
                        placeholder="Blank = Entra ID login"
                        value={form.azureLocalUser}
                        onChange={(e) => set('azureLocalUser', e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {vmLookupError && <p className="hint">{vmLookupError}</p>}
                {vmFoundMessage && <p className="hint">{vmFoundMessage}</p>}
                {vmMatches.length > 0 && (
                  <div className="form-field">
                    <label htmlFor="azureVmMatches">
                      {vmMatches.length} matches found across your subscriptions - pick one
                    </label>
                    <select
                      id="azureVmMatches"
                      value=""
                      onChange={(e) => {
                        const match = vmMatches.find((m) => m.id === e.target.value)
                        if (match) applyVmMatch(match)
                      }}
                    >
                      <option value="" disabled>
                        Choose the subscription / resource group...
                      </option>
                      {vmMatches.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.subscriptionName} / {m.resourceGroup}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="form-section">
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.useGrafana}
                onChange={(e) => set('useGrafana', e.target.checked)}
              />
              <h4 style={{ margin: 0 }}>
                <BarChart3 size={13} strokeWidth={2} />
                Grafana status
              </h4>
            </label>
            {form.useGrafana && (
              <>
                <div className="form-field">
                  <label htmlFor="grafanaBaseUrl">Grafana base URL</label>
                  <input
                    id="grafanaBaseUrl"
                    placeholder="https://grafana.example.org"
                    value={form.grafanaBaseUrl}
                    onChange={(e) => set('grafanaBaseUrl', e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="grafanaDashboardUids">Dashboard UIDs (comma separated)</label>
                  <input
                    id="grafanaDashboardUids"
                    value={form.grafanaDashboardUids}
                    onChange={(e) => set('grafanaDashboardUids', e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="grafanaApiToken">Service account API token</label>
                  <input
                    id="grafanaApiToken"
                    type="password"
                    value={form.grafanaApiToken}
                    onChange={(e) => set('grafanaApiToken', e.target.value)}
                    placeholder={initial?.hasGrafanaToken ? 'Unchanged - leave blank to keep' : ''}
                  />
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="grafanaGpuDatasourceUid">
                      GPU metrics datasource UID (optional)
                    </label>
                    <input
                      id="grafanaGpuDatasourceUid"
                      placeholder="Prometheus datasource with DCGM metrics"
                      value={form.grafanaGpuDatasourceUid}
                      onChange={(e) => set('grafanaGpuDatasourceUid', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="grafanaGpuHostLabel">Node label</label>
                    <input
                      id="grafanaGpuHostLabel"
                      placeholder="Hostname"
                      value={form.grafanaGpuHostLabel}
                      onChange={(e) => set('grafanaGpuHostLabel', e.target.value)}
                    />
                  </div>
                </div>
                <p className="hint">
                  With a datasource set, the Slurm section shows GPU utilization, memory and
                  temperature for your running jobs&apos; nodes from NVIDIA&apos;s DCGM exporter
                  metrics. The node label must hold the node name as Slurm prints it.
                </p>
              </>
            )}
          </div>

          <div className="form-section">
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.useScheduler}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    useScheduler: e.target.checked,
                    // Each run on a Teleport cluster is an audited session - opt in explicitly.
                    schedulerAutoRefresh: e.target.checked
                      ? prev.connectionMode !== 'teleport'
                      : prev.schedulerAutoRefresh
                  }))
                }
              />
              <h4 style={{ margin: 0 }}>
                <ListChecks size={13} strokeWidth={2} />
                Slurm jobs and nodes
              </h4>
            </label>
            {form.useScheduler && (
              <>
                <p className="hint">
                  Runs squeue and sinfo on the terminal&apos;s open session - never a new login -
                  and only while this cluster&apos;s Status is showing. See
                  docs/HPC_ORCHESTRATION.md.
                </p>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="schedulerScope">Show</label>
                    <select
                      id="schedulerScope"
                      value={form.schedulerScope}
                      onChange={(e) => set('schedulerScope', e.target.value as SchedulerScope)}
                    >
                      <option value="mine">My jobs</option>
                      <option value="partitions">Everyone&apos;s jobs in these partitions</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="schedulerPartitions">
                      Partitions{form.schedulerScope === 'mine' ? ' (optional)' : ''}
                    </label>
                    <input
                      id="schedulerPartitions"
                      placeholder="gpu, cpu"
                      value={form.schedulerPartitions}
                      onChange={(e) => set('schedulerPartitions', e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="schedulerInterval">Refresh every (seconds)</label>
                    <input
                      id="schedulerInterval"
                      type="number"
                      min={MIN_SCHEDULER_INTERVAL_SEC}
                      value={form.schedulerInterval}
                      onChange={(e) => set('schedulerInterval', e.target.value)}
                    />
                  </div>
                  <label className="form-field-checkbox">
                    <input
                      type="checkbox"
                      checked={form.schedulerAutoRefresh}
                      onChange={(e) => set('schedulerAutoRefresh', e.target.checked)}
                    />
                    Refresh automatically
                  </label>
                </div>
                {form.connectionMode !== 'teleport' && (
                  <label className="form-field-checkbox">
                    <input
                      type="checkbox"
                      checked={form.schedulerNotify}
                      onChange={(e) => set('schedulerNotify', e.target.checked)}
                    />
                    Notify me when my jobs finish or start, and when nodes go down
                  </label>
                )}
                {form.connectionMode !== 'teleport' && form.schedulerNotify && (
                  <p className="hint">
                    While this cluster is open in the background, Gate-H keeps checking every 5
                    minutes on its terminal&apos;s connection. Closed or in standby, nothing runs.
                  </p>
                )}
                {form.connectionMode === 'teleport' && form.schedulerAutoRefresh && (
                  <p className="hint">
                    Every refresh is a new Teleport session in your site&apos;s audit log.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="form-section">
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.useStorage}
                onChange={(e) => set('useStorage', e.target.checked)}
              />
              <h4 style={{ margin: 0 }}>
                <HardDrive size={13} strokeWidth={2} />
                Storage quota
              </h4>
            </label>
            {form.useStorage && (
              <>
                <div className="form-field">
                  <label htmlFor="storagePaths">Paths (comma separated)</label>
                  <input
                    id="storagePaths"
                    placeholder="~, /scratch/$USER"
                    value={form.storagePaths}
                    onChange={(e) => set('storagePaths', e.target.value)}
                  />
                </div>
                <p className="hint">
                  Checked on request from the cluster&apos;s Status, on the terminal&apos;s open
                  session: df for each filesystem, plus your quota on Lustre (lfs quota) and GPFS
                  (mmlsquota).
                </p>
              </>
            )}
          </div>

          <div className="form-section">
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.useJira}
                onChange={(e) => set('useJira', e.target.checked)}
              />
              <h4 style={{ margin: 0 }}>
                <Ticket size={13} strokeWidth={2} />
                Jira
              </h4>
            </label>
            {form.useJira && (
              <>
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="jiraBaseUrl">Jira base URL</label>
                    <input
                      id="jiraBaseUrl"
                      placeholder="https://yourorg.atlassian.net"
                      value={form.jiraBaseUrl}
                      onChange={(e) => set('jiraBaseUrl', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="jiraAuthMode">Auth mode</label>
                    <select
                      id="jiraAuthMode"
                      value={form.jiraAuthMode}
                      onChange={(e) => set('jiraAuthMode', e.target.value as JiraAuthMode)}
                    >
                      <option value="cloud">Jira Cloud (email + API token)</option>
                      <option value="datacenter">Jira Data Center (PAT)</option>
                    </select>
                  </div>
                </div>
                {form.jiraAuthMode === 'cloud' && (
                  <div className="form-field">
                    <label htmlFor="jiraEmail">Account email</label>
                    <input
                      id="jiraEmail"
                      value={form.jiraEmail}
                      onChange={(e) => set('jiraEmail', e.target.value)}
                    />
                  </div>
                )}
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="jiraProjectKey">Default project key</label>
                    <input
                      id="jiraProjectKey"
                      value={form.jiraProjectKey}
                      onChange={(e) => set('jiraProjectKey', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="jiraJql">Default JQL filter</label>
                    <input
                      id="jiraJql"
                      value={form.jiraJql}
                      onChange={(e) => set('jiraJql', e.target.value)}
                      placeholder={`project = ${form.jiraProjectKey || 'HPC'} AND labels = "${toClusterSlug(form.name)}"`}
                    />
                  </div>
                </div>
                <p className="hint">
                  Multiple clusters sharing one Jira project will show identical tickets unless you
                  scope this JQL by something unique to the cluster (a label or component) - login,
                  compute, and controller hostnames differ per cluster and aren&apos;t a useful Jira
                  key. See docs/JIRA_GUIDE.md for the recommended pattern.
                </p>
                <div className="form-field">
                  <label htmlFor="jiraApiToken">
                    {form.jiraAuthMode === 'cloud' ? 'API token' : 'Personal access token'}
                  </label>
                  <input
                    id="jiraApiToken"
                    type="password"
                    value={form.jiraApiToken}
                    onChange={(e) => set('jiraApiToken', e.target.value)}
                    placeholder={initial?.hasJiraToken ? 'Unchanged - leave blank to keep' : ''}
                  />
                </div>
              </>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save cluster'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
