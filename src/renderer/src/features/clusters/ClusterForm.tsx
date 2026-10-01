import { useEffect, useState } from 'react'
import {
  BarChart3,
  Cloud,
  HardDrive,
  Info,
  KeyRound,
  ListChecks,
  ShieldCheck,
  Ticket,
  Waypoints
} from 'lucide-react'
import type {
  AzureSubscription,
  AzureTunnelMode,
  AzureTunnelVerifyResult,
  AzureVmMatch,
  ClusterInput,
  ClusterSummary,
  JiraAuthMode,
  SchedulerScope,
  SshAuthMethod
} from '../../../../shared/types'
import {
  DEFAULT_SCHEDULER_INTERVAL_SEC,
  DEFAULT_STORAGE_INTERVAL_SEC,
  MIN_SCHEDULER_INTERVAL_SEC,
  MIN_STORAGE_INTERVAL_SEC,
  PROMETHEUS_LABEL_PATTERN,
  SLURM_PARTITION_PATTERN,
  STORAGE_PATH_PATTERN
} from '../../../../shared/types'
import { toClusterSlug } from '../../../../shared/clusterSlug'
import './clusters.css'

interface ClusterFormProps {
  initial?: ClusterSummary
  /** Every other cluster, used only to warn about an Azure tunnel local port already claimed by
   *  one of them - two tunnels silently sharing a port is a real, confusing failure mode (see the
   *  "both mapped to the same localhost port" bug this was added for). */
  existingClusters?: ClusterSummary[]
  onCancel: () => void
  onSubmit: (input: ClusterInput) => Promise<void>
}

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
  const interval = Number(form.storageInterval)
  if (!Number.isInteger(interval) || interval < MIN_STORAGE_INTERVAL_SEC) {
    return `Storage refresh interval must be a whole number of seconds, at least ${MIN_STORAGE_INTERVAL_SEC}.`
  }
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

/** Returns why the jump host settings can't be saved, or null if they can. */
function jumpHostError(form: FormState): string | null {
  if (!form.jumpHostEnabled) return null
  if (form.useTeleport) {
    return (
      "A jump host can't be combined with Teleport - every Teleport-routed node presents a " +
      "certificate host key this app's SSH library can't verify."
    )
  }
  if (!form.jumpHost.trim() || !form.jumpUsername.trim()) {
    return 'A jump host needs a host and a username.'
  }
  const port = Number(form.jumpPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Jump host port must be a number between 1 and 65535.'
  }
  if (form.jumpAuthMethod === 'private-key' && !form.jumpPrivateKeyPath.trim()) {
    return 'Jump host needs a private key path.'
  }
  return null
}

/** Returns why the Teleport settings can't be saved, or null if they can. */
function teleportError(form: FormState): string | null {
  if (!form.useTeleport) return null
  if (!form.teleportProxy.trim()) return 'Teleport needs the proxy address.'
  if (/\s/.test(form.teleportProxy.trim())) return 'Teleport proxy address must not contain spaces.'
  return null
}

/** Returns why the Azure tunnel settings can't be saved, or null if they can. */
function azureTunnelError(form: FormState): string | null {
  if (!form.useAzureTunnel) return null
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
  if (form.azureRemotePort.trim()) {
    const remotePort = Number(form.azureRemotePort)
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      return 'Azure tunnel remote port must be a number between 1 and 65535.'
    }
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
    // IP-based connect (no VM resource id/name at all) is a separate Bastion feature from
    // resource-id-based tunneling, and Azure rejects any other remote port for it outright - this
    // isn't a Gate-H restriction, so catching it here beats a buried `az` CLI failure.
    const isIpConnect =
      !form.azureTargetResourceId.trim() &&
      !form.azureVmName.trim() &&
      Boolean(form.azureTargetIpAddress.trim())
    if (isIpConnect) {
      const effectiveRemotePort = form.azureRemotePort.trim()
        ? Number(form.azureRemotePort)
        : Number(form.jumpHostEnabled && !form.useTeleport ? form.jumpPort : form.port)
      if (effectiveRemotePort !== 22 && effectiveRemotePort !== 3389) {
        return (
          "Azure Bastion's IP-based connect only allows remote port 22 or 3389 - set the Azure " +
          'tunnel remote port above to one of those, or use the target VM resource ID/name ' +
          'instead of its IP address to tunnel to any port.'
        )
      }
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

/** One pane of the settings-style form below - a left-hand nav lists these, and the matching
 *  content pane is the only one rendered at a time, so editing a cluster with many integrations
 *  configured doesn't mean scrolling past all of them to reach the one you want (or the Save
 *  button, which stays outside the scrolling area entirely). */
type SectionKey =
  | 'basics'
  | 'ssh'
  | 'jumpHost'
  | 'azure'
  | 'teleport'
  | 'grafana'
  | 'scheduler'
  | 'storage'
  | 'jira'

interface SectionMeta {
  key: SectionKey
  label: string
  icon: typeof KeyRound
  /** Whether this section's own feature is currently turned on - shown as a dot next to its nav
   *  entry, so what's configured is visible without opening every section. Omitted for Basics and
   *  SSH connection, which aren't optional. */
  enabled?: (form: FormState) => boolean
}

const SECTIONS: SectionMeta[] = [
  { key: 'basics', label: 'Basics', icon: Info },
  { key: 'ssh', label: 'SSH connection', icon: KeyRound },
  {
    key: 'jumpHost',
    label: 'Jump host',
    icon: Waypoints,
    enabled: (f) => f.jumpHostEnabled && !f.useTeleport
  },
  { key: 'azure', label: 'Azure tunnel', icon: Cloud, enabled: (f) => f.useAzureTunnel },
  { key: 'teleport', label: 'Teleport', icon: ShieldCheck, enabled: (f) => f.useTeleport },
  { key: 'grafana', label: 'Grafana status', icon: BarChart3, enabled: (f) => f.useGrafana },
  {
    key: 'scheduler',
    label: 'Slurm jobs and nodes',
    icon: ListChecks,
    enabled: (f) => f.useScheduler
  },
  { key: 'storage', label: 'Storage quota', icon: HardDrive, enabled: (f) => f.useStorage },
  { key: 'jira', label: 'Jira', icon: Ticket, enabled: (f) => f.useJira }
]

/** The first validation problem in the same order handleSubmit used to check them, paired with
 *  the section to switch to - so a save that fails always lands the user on the field that needs
 *  fixing, instead of leaving them on whichever section happened to be open. */
function firstFormError(form: FormState): { message: string; section: SectionKey } | null {
  if (!form.name.trim())
    return { message: 'Name, host, and username are required.', section: 'basics' }
  if (!form.host.trim() || !form.username.trim()) {
    return { message: 'Name, host, and username are required.', section: 'ssh' }
  }
  const jumpHost = jumpHostError(form)
  if (jumpHost) return { message: jumpHost, section: 'jumpHost' }
  const teleport = teleportError(form)
  if (teleport) return { message: teleport, section: 'teleport' }
  const azure = azureTunnelError(form)
  if (azure) return { message: azure, section: 'azure' }
  const scheduler = schedulerError(form)
  if (scheduler) return { message: scheduler, section: 'scheduler' }
  const storage = storageError(form)
  if (storage) return { message: storage, section: 'storage' }
  const gpu = gpuError(form)
  if (gpu) return { message: gpu, section: 'grafana' }
  return null
}

/** An optional section's heading: a toggle switch rather than a checkbox, since it turns a whole
 *  group of fields on or off below it, not one item among independent choices - see
 *  https://developer.apple.com/design/human-interface-guidelines/toggles ("use a switch to let
 *  people turn on or off a group of settings"). */
function SectionToggleHeader({
  icon: Icon,
  label,
  checked,
  disabled,
  onChange
}: {
  icon: typeof KeyRound
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="cluster-section-header">
      <h4>
        <Icon size={13} strokeWidth={2} />
        {label}
      </h4>
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
      </label>
    </div>
  )
}

/** What a toggled-off optional section shows instead of blank space below its header - a brief
 *  explanation of what turning it on does, not nothing. */
function SectionEmptyState({
  icon: Icon,
  children
}: {
  icon: typeof KeyRound
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="cluster-section-empty">
      <Icon size={28} strokeWidth={1.5} />
      <p>{children}</p>
    </div>
  )
}

export default function ClusterForm({
  initial,
  existingClusters = [],
  onCancel,
  onSubmit
}: ClusterFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [activeSection, setActiveSection] = useState<SectionKey>('basics')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Set to the port a same-port conflict was already warned about and saved through anyway;
  // changing the port (or turning the tunnel off) clears it, so a stale confirmation can't
  // silently cover a new conflict.
  const [portConflictConfirmedFor, setPortConflictConfirmedFor] = useState<string | null>(null)
  const [subscriptions, setSubscriptions] = useState<AzureSubscription[]>([])
  const [subscriptionsError, setSubscriptionsError] = useState<string | null>(null)
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false)
  const [vmMatches, setVmMatches] = useState<AzureVmMatch[]>([])
  const [vmLookupError, setVmLookupError] = useState<string | null>(null)
  const [vmFoundMessage, setVmFoundMessage] = useState<string | null>(null)
  const [findingVm, setFindingVm] = useState(false)
  const [verifyingTunnel, setVerifyingTunnel] = useState(false)
  const [verifyProgress, setVerifyProgress] = useState<string | null>(null)
  // The literal `az network bastion tunnel`/`az ssh vm` invocation, parsed out of the status
  // stream and kept separately from `verifyProgress` (which only ever shows the latest step) so it
  // survives to the end of the check for the user to copy and run by hand.
  const [verifyCommand, setVerifyCommand] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<AzureTunnelVerifyResult | null>(null)
  const [verifyFailure, setVerifyFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!initial) return
    return window.api.azure.onStatus((event) => {
      if (event.clusterId !== initial.id) return
      if (event.message.startsWith('Command: ')) {
        setVerifyCommand(event.message.slice('Command: '.length))
      } else {
        setVerifyProgress(event.message)
      }
    })
  }, [initial])

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

  /** Opens (or reuses) the saved cluster's real Azure tunnel and checks it actually carries
   *  traffic through to a live sshd - the same check a user would otherwise have to do by hand
   *  with their own `az`/`ssh` commands. Only available once the cluster is saved, since it needs
   *  a real `ClusterSummary` (and its id) to drive the tunnel the same way a connect would. */
  async function handleVerifyTunnel(): Promise<void> {
    if (!initial) return
    setVerifyingTunnel(true)
    setVerifyProgress(null)
    setVerifyCommand(null)
    setVerifyResult(null)
    setVerifyFailure(null)
    try {
      const result = await window.api.azure.verifyTunnel(initial.id)
      setVerifyResult(result)
    } catch (err) {
      setVerifyFailure(err instanceof Error ? err.message : 'Could not verify the tunnel.')
    } finally {
      setVerifyingTunnel(false)
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

  /** Always shows something for the last "Find subscription" click - searching, the error, the
   *  match found, or a picker for more than one - directly under the field it came from, so a
   *  search never looks like it did nothing. */
  function renderVmSearchStatus(): React.JSX.Element | null {
    if (findingVm) {
      return <p className="hint">Searching every subscription you can see...</p>
    }
    if (vmMatches.length > 0) {
      return (
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
      )
    }
    if (vmLookupError) return <p className="hint">{vmLookupError}</p>
    if (vmFoundMessage) return <p className="hint">{vmFoundMessage}</p>
    return null
  }

  /** Another cluster whose Azure tunnel already claims this one's local port - two tunnels
   *  silently sharing a port is a real, confusing failure mode (TCP connects, but whichever one
   *  didn't actually win the bind never gets real traffic - see the "both mapped to the same
   *  localhost port" bug this was added for), not something to block on outright since the user
   *  may know the two are never used at the same time. */
  function findPortConflict(): ClusterSummary | null {
    if (!form.useAzureTunnel) return null
    const port = Number(form.azureLocalPort)
    if (!Number.isInteger(port)) return null
    return (
      existingClusters.find(
        (c) => c.id !== initial?.id && c.azureTunnel && c.azureTunnel.localPort === port
      ) ?? null
    )
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    const validation = firstFormError(form)
    if (validation) {
      setError(validation.message)
      setActiveSection(validation.section)
      return
    }

    const conflict = findPortConflict()
    if (conflict && portConflictConfirmedFor !== form.azureLocalPort) {
      setPortConflictConfirmedFor(form.azureLocalPort)
      setActiveSection('azure')
      setError(
        `Local port ${form.azureLocalPort} is already used by "${conflict.name}"'s Azure tunnel - ` +
          'two tunnels sharing a port can silently interfere with each other. Click Save again to ' +
          'use it anyway, or pick a different port.'
      )
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
        // Not available for Teleport (see JumpHostConfig).
        jumpHost:
          form.jumpHostEnabled && !form.useTeleport
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
      jumpHostSecret:
        form.jumpHostEnabled && !form.useTeleport
          ? form.jumpHostSecret.trim() || undefined
          : undefined,
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
      azureTunnel: form.useAzureTunnel
        ? {
            mode: form.azureMode,
            subscription: form.azureSubscription.trim(),
            tenant: form.azureTenant.trim() || undefined,
            resourceGroup: form.azureResourceGroup.trim(),
            localPort: Number(form.azureLocalPort),
            remotePort: form.azureRemotePort.trim() ? Number(form.azureRemotePort) : undefined,
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
      teleport: form.useTeleport
        ? {
            proxy: form.teleportProxy.trim(),
            cluster: form.teleportCluster.trim() || undefined,
            user: form.teleportUser.trim() || undefined,
            authConnector: form.teleportAuthConnector.trim() || undefined,
            insecure: form.teleportInsecure || undefined
          }
        : null,
      scheduler: form.useScheduler
        ? {
            kind: 'slurm',
            scope: form.schedulerScope,
            partitions: splitList(form.schedulerPartitions),
            intervalSec: Number(form.schedulerInterval),
            autoRefresh: form.schedulerAutoRefresh,
            notify: form.schedulerNotify && !form.useTeleport,
            execTarget: form.schedulerExecHost.trim()
              ? {
                  host: form.schedulerExecHost.trim(),
                  port: form.schedulerExecPort.trim() ? Number(form.schedulerExecPort) : undefined
                }
              : null
          }
        : null,
      storage: form.useStorage
        ? {
            paths: splitList(form.storagePaths),
            autoRefresh: form.storageAutoRefresh,
            intervalSec: Number(form.storageInterval)
          }
        : null
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
      <div className="modal cluster-modal">
        <h2>{initial ? `Edit ${initial.name}` : 'Add cluster'}</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit} className="cluster-form-body">
          <div className="cluster-form-panes">
            <nav className="cluster-form-nav" aria-label="Cluster settings sections">
              {SECTIONS.map((s) => {
                const Icon = s.icon
                const on = s.enabled?.(form)
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`cluster-form-nav-item${activeSection === s.key ? ' active' : ''}`}
                    onClick={() => setActiveSection(s.key)}
                  >
                    <Icon size={14} strokeWidth={2} />
                    <span className="cluster-form-nav-label">{s.label}</span>
                    {on && <span className="cluster-form-nav-dot" aria-hidden="true" />}
                  </button>
                )
              })}
            </nav>
            <div className="cluster-form-content">
              {activeSection === 'basics' && (
                <>
                  <div className="form-field">
                    <label htmlFor="name">Name</label>
                    <input
                      id="name"
                      value={form.name}
                      onChange={(e) => set('name', e.target.value)}
                    />
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
                    <input
                      id="tags"
                      value={form.tags}
                      onChange={(e) => set('tags', e.target.value)}
                    />
                  </div>
                </>
              )}

              {activeSection === 'ssh' && (
                <div className="form-section">
                  <h4>
                    <KeyRound size={13} strokeWidth={2} />
                    SSH connection
                  </h4>
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="host">Host</label>
                      <input
                        id="host"
                        value={form.host}
                        onChange={(e) => set('host', e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="port">Port</label>
                      <input
                        id="port"
                        value={form.port}
                        onChange={(e) => set('port', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="username">Username</label>
                      <input
                        id="username"
                        value={form.username}
                        onChange={(e) => set('username', e.target.value)}
                      />
                    </div>
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
                  </div>
                  {form.authMethod === 'private-key' && (
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
                  {form.authMethod !== 'agent' && (
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
                  {form.useTeleport && (
                    <p className="hint">
                      Connecting through Teleport (below): Host above is the Teleport node name and
                      Username the login. Port, auth method, private key and password aren&apos;t
                      used for that hop.
                    </p>
                  )}
                </div>
              )}

              {activeSection === 'jumpHost' && (
                <div className="form-section">
                  <SectionToggleHeader
                    icon={Waypoints}
                    label="Route through a jump host / bastion hop"
                    checked={form.jumpHostEnabled && !form.useTeleport}
                    disabled={form.useTeleport}
                    onChange={(checked) => set('jumpHostEnabled', checked)}
                  />
                  {form.useTeleport ? (
                    <p className="hint">
                      Not available when connecting through Teleport (below) - every node it routes
                      to presents a certificate host key this app&apos;s SSH library can&apos;t
                      verify.
                    </p>
                  ) : !form.jumpHostEnabled ? (
                    <SectionEmptyState icon={Waypoints}>
                      Adds an intermediate SSH hop before reaching Host/Port above - for a bastion
                      or firewall between you and the login node.
                    </SectionEmptyState>
                  ) : (
                    <>
                      <p className="hint">
                        Reached first - directly, or through the Azure tunnel below if one&apos;s
                        configured (the tunnel then reaches this jump host, not the target directly)
                        - then a normal SSH hop from there reaches Host/Port above.
                      </p>
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
                      {form.jumpAuthMethod !== 'agent' && (
                        <div className="form-field">
                          <label htmlFor="jumpHostSecret">
                            {form.jumpAuthMethod === 'password'
                              ? 'Jump host password'
                              : 'Jump host key passphrase (if any)'}
                          </label>
                          <input
                            id="jumpHostSecret"
                            type="password"
                            value={form.jumpHostSecret}
                            onChange={(e) => set('jumpHostSecret', e.target.value)}
                            placeholder={
                              initial?.hasJumpHostSecret ? 'Unchanged - leave blank to keep' : ''
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeSection === 'azure' && (
                <div className="form-section">
                  <SectionToggleHeader
                    icon={Cloud}
                    label="Azure tunnel"
                    checked={form.useAzureTunnel}
                    onChange={(checked) =>
                      setForm((prev) => ({
                        ...prev,
                        useAzureTunnel: checked,
                        useTeleport: checked ? false : prev.useTeleport
                      }))
                    }
                  />
                  {!form.useAzureTunnel ? (
                    <SectionEmptyState icon={Cloud}>
                      Reach the target through an Azure Bastion or <code>az ssh vm</code> tunnel -
                      for a VM with no direct SSH access.
                    </SectionEmptyState>
                  ) : (
                    <>
                      <p className="hint">
                        Before connecting, Gate-H signs in with the Azure CLI (az), selects this
                        subscription, and opens a tunnel. SSH then connects to 127.0.0.1 on the
                        local port. Without a jump host above, Host/Port above are the tunnel&apos;s
                        far end - the target VM&apos;s real hostname or IP (Bastion), or the login
                        node as the VM reaches it (az ssh vm). With a jump host above, the tunnel
                        reaches the jump host instead, and Host/Port above stay the final target,
                        reached from there. Either way, never localhost - that field is what
                        host-key trust is pinned to, not the actual tunnel address. Needs az on
                        PATH. See the README section on clusters reachable only through Azure.
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
                        <label htmlFor="azureRemotePort">Remote port (optional)</label>
                        <input
                          id="azureRemotePort"
                          placeholder={`Defaults to ${form.jumpHostEnabled && !form.useTeleport ? 'jump host' : 'Host/Port above'}'s port`}
                          value={form.azureRemotePort}
                          onChange={(e) => set('azureRemotePort', e.target.value)}
                        />
                        <p className="hint">
                          The port the tunnel targets on the far side - usually the same as the SSH
                          port above, so you rarely need to set this. Set it independently when it
                          isn&apos;t: Bastion&apos;s IP-based connect (no resource ID/VM name) only
                          ever allows 22 or 3389 here, regardless of the real sshd port.
                        </p>
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
                              {subscriptions.length} subscription
                              {subscriptions.length === 1 ? '' : 's'} found - pick one...
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
                            {renderVmSearchStatus()}
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
                              Needs &quot;IP-based connection&quot; enabled on this Bastion host.
                              Use this when the target isn&apos;t in this Bastion&apos;s resource
                              group (or subscription/tenant), or isn&apos;t an Azure VM resource at
                              all.
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
                            {renderVmSearchStatus()}
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
                      {initial && (
                        <div className="form-field">
                          <div className="form-inline">
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={handleVerifyTunnel}
                              disabled={verifyingTunnel}
                            >
                              {verifyingTunnel ? 'Verifying...' : 'Verify tunnel'}
                            </button>
                          </div>
                          <p className="hint">
                            Opens (or reuses) this cluster&apos;s actual tunnel and waits for a live
                            SSH banner through it - confirms the tunnel really carries traffic, not
                            just that az reports it open. Uses the saved configuration, not unsaved
                            edits above.
                          </p>
                          {verifyingTunnel && verifyProgress && (
                            <p className="hint">{verifyProgress}</p>
                          )}
                          {verifyFailure && (
                            <p className="hint">Could not verify: {verifyFailure}</p>
                          )}
                          {verifyResult && !verifyResult.tunnelOpened && (
                            <p className="hint">
                              Tunnel failed to open: {verifyResult.tunnelError}
                            </p>
                          )}
                          {verifyResult &&
                            verifyResult.tunnelOpened &&
                            verifyResult.bannerReceived && (
                              <p className="hint">
                                Tunnel is open and an SSH banner arrived in {verifyResult.latencyMs}
                                ms - the path to sshd is working end to end.
                              </p>
                            )}
                          {verifyResult &&
                            verifyResult.tunnelOpened &&
                            !verifyResult.bannerReceived && (
                              <p className="hint">
                                Tunnel opened and az reports it listening, but no SSH banner arrived
                                within 10s - the session may have silently died while its local port
                                kept listening (a known az CLI issue, azure-cli#28367). Try closing
                                the cluster and reconnecting to force a fresh tunnel; if it keeps
                                happening, run the command below by hand and compare it against a
                                plain `ssh` to the same local port.
                              </p>
                            )}
                          {verifyCommand && (
                            <p className="hint">
                              <code>{verifyCommand}</code>
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeSection === 'teleport' && (
                <div className="form-section">
                  <SectionToggleHeader
                    icon={ShieldCheck}
                    label="Teleport"
                    checked={form.useTeleport}
                    onChange={(checked) =>
                      setForm((prev) => ({
                        ...prev,
                        useTeleport: checked,
                        useAzureTunnel: checked ? false : prev.useAzureTunnel,
                        // A jump host can't be combined with Teleport (see JumpHostConfig).
                        jumpHostEnabled: checked ? false : prev.jumpHostEnabled
                      }))
                    }
                  />
                  {!form.useTeleport ? (
                    <SectionEmptyState icon={ShieldCheck}>
                      Reach the target through a Teleport proxy instead of connecting directly - for
                      a cluster behind Teleport&apos;s access gateway.
                    </SectionEmptyState>
                  ) : (
                    <>
                      <p className="hint">
                        The terminal runs tsh ssh through this proxy. If there&apos;s no valid tsh
                        session, you log in right in the terminal: password and OTP prompts appear
                        there, or your browser opens for SSO. Needs tsh on PATH. See
                        docs/TELEPORT.md.
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
                      <label className="form-field-checkbox">
                        <input
                          type="checkbox"
                          checked={form.teleportInsecure}
                          onChange={(e) => set('teleportInsecure', e.target.checked)}
                        />
                        Skip certificate verification (self-signed/lab proxy, no real CA)
                      </label>
                      {form.teleportInsecure && (
                        <p className="hint">
                          tsh won&apos;t verify this proxy&apos;s TLS certificate at all - only use
                          this for a proxy you know is self-signed (a lab/test cluster), never on a
                          network you don&apos;t trust. For a real organisation CA, use{' '}
                          <code>SSL_CERT_FILE</code> instead and leave this off.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeSection === 'grafana' && (
                <div className="form-section">
                  <SectionToggleHeader
                    icon={BarChart3}
                    label="Grafana status"
                    checked={form.useGrafana}
                    onChange={(checked) => set('useGrafana', checked)}
                  />
                  {!form.useGrafana ? (
                    <SectionEmptyState icon={BarChart3}>
                      Show this cluster&apos;s dashboards and a health check from a Grafana
                      instance.
                    </SectionEmptyState>
                  ) : (
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
                        <label htmlFor="grafanaDashboardUids">
                          Dashboard UIDs (comma separated)
                        </label>
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
                          placeholder={
                            initial?.hasGrafanaToken ? 'Unchanged - leave blank to keep' : ''
                          }
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
                        temperature for your running jobs&apos; nodes from NVIDIA&apos;s DCGM
                        exporter metrics. The node label must hold the node name as Slurm prints it.
                      </p>
                    </>
                  )}
                </div>
              )}

              {activeSection === 'scheduler' && (
                <div className="form-section">
                  <SectionToggleHeader
                    icon={ListChecks}
                    label="Slurm jobs and nodes"
                    checked={form.useScheduler}
                    onChange={(checked) =>
                      setForm((prev) => ({
                        ...prev,
                        useScheduler: checked,
                        // Each run on a Teleport cluster is an audited session - opt in explicitly.
                        schedulerAutoRefresh: checked
                          ? !prev.useTeleport
                          : prev.schedulerAutoRefresh
                      }))
                    }
                  />
                  {!form.useScheduler ? (
                    <SectionEmptyState icon={ListChecks}>
                      Show the user&apos;s Slurm jobs and node health from this cluster&apos;s
                      terminal session.
                    </SectionEmptyState>
                  ) : (
                    <>
                      <p className="hint">
                        Runs squeue and sinfo on the terminal&apos;s open session - never a new
                        login - and only while this cluster&apos;s Status is showing. See
                        docs/HPC_ORCHESTRATION.md.
                      </p>
                      <div className="form-row">
                        <div className="form-field">
                          <label htmlFor="schedulerScope">Show</label>
                          <select
                            id="schedulerScope"
                            value={form.schedulerScope}
                            onChange={(e) =>
                              set('schedulerScope', e.target.value as SchedulerScope)
                            }
                          >
                            <option value="mine">My jobs</option>
                            <option value="partitions">
                              Everyone&apos;s jobs in these partitions
                            </option>
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
                      {!form.useTeleport && (
                        <label className="form-field-checkbox">
                          <input
                            type="checkbox"
                            checked={form.schedulerNotify}
                            onChange={(e) => set('schedulerNotify', e.target.checked)}
                          />
                          Notify me when my jobs finish or start, and when nodes go down
                        </label>
                      )}
                      {!form.useTeleport && form.schedulerNotify && (
                        <p className="hint">
                          While this cluster is open in the background, Gate-H keeps checking every
                          5 minutes on its terminal&apos;s connection. Closed or in standby, nothing
                          runs.
                        </p>
                      )}
                      {form.useTeleport && form.schedulerAutoRefresh && (
                        <p className="hint">
                          Every refresh is a new Teleport session in your site&apos;s audit log.
                        </p>
                      )}
                      <div className="form-row">
                        <div className="form-field">
                          <label htmlFor="schedulerExecHost">
                            Run Slurm commands on a different node (optional)
                          </label>
                          <input
                            id="schedulerExecHost"
                            placeholder="Blank = the terminal's own node"
                            value={form.schedulerExecHost}
                            onChange={(e) => set('schedulerExecHost', e.target.value)}
                          />
                        </div>
                        {form.schedulerExecHost.trim() && (
                          <div className="form-field">
                            <label htmlFor="schedulerExecPort">Port (optional)</label>
                            <input
                              id="schedulerExecPort"
                              placeholder={form.port || '22'}
                              value={form.schedulerExecPort}
                              onChange={(e) => set('schedulerExecPort', e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <p className="hint">
                        A hostname, not a command - leave this blank unless squeue/sinfo need to run
                        on a different node than the terminal&apos;s own (e.g. a bastion/login node
                        that doesn&apos;t host Slurm itself). Gate-H already runs sinfo/squeue
                        automatically above once Slurm is enabled; this field doesn&apos;t change
                        what runs, only which node it runs on. The name is resolved by the
                        already-connected node reached through whatever jump host or tunnel is
                        configured above, not by your own machine - it must be resolvable from
                        there.
                      </p>
                    </>
                  )}
                </div>
              )}

              {activeSection === 'storage' && (
                <div className="form-section">
                  <SectionToggleHeader
                    icon={HardDrive}
                    label="Storage quota"
                    checked={form.useStorage}
                    onChange={(checked) => set('useStorage', checked)}
                  />
                  {!form.useStorage ? (
                    <SectionEmptyState icon={HardDrive}>
                      Check filesystem usage and quota for specific paths on this cluster.
                    </SectionEmptyState>
                  ) : (
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
                        Always available on request from the cluster&apos;s Status, on the
                        terminal&apos;s open session: df for each filesystem, plus your quota on
                        Lustre (lfs quota) and GPFS (mmlsquota).
                      </p>
                      <div className="form-row">
                        <div className="form-field">
                          <label htmlFor="storageInterval">Refresh every (seconds)</label>
                          <input
                            id="storageInterval"
                            type="number"
                            min={MIN_STORAGE_INTERVAL_SEC}
                            value={form.storageInterval}
                            onChange={(e) => set('storageInterval', e.target.value)}
                          />
                        </div>
                        <label className="form-field-checkbox">
                          <input
                            type="checkbox"
                            checked={form.storageAutoRefresh}
                            onChange={(e) => set('storageAutoRefresh', e.target.checked)}
                          />
                          Refresh automatically
                        </label>
                      </div>
                      {form.useTeleport && form.storageAutoRefresh && (
                        <p className="hint">
                          Every refresh is a new Teleport session in your site&apos;s audit log.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeSection === 'jira' && (
                <div className="form-section">
                  <SectionToggleHeader
                    icon={Ticket}
                    label="Jira"
                    checked={form.useJira}
                    onChange={(checked) => set('useJira', checked)}
                  />
                  {!form.useJira ? (
                    <SectionEmptyState icon={Ticket}>
                      List and file Jira tickets scoped to this cluster.
                    </SectionEmptyState>
                  ) : (
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
                        Multiple clusters sharing one Jira project will show identical tickets
                        unless you scope this JQL by something unique to the cluster (a label or
                        component) - login, compute, and controller hostnames differ per cluster and
                        aren&apos;t a useful Jira key. See docs/JIRA_GUIDE.md for the recommended
                        pattern.
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
                          placeholder={
                            initial?.hasJiraToken ? 'Unchanged - leave blank to keep' : ''
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
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
