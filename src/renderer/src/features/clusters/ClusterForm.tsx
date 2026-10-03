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
  AzureTunnelVerifyResult,
  AzureVmMatch,
  ClusterInput,
  ClusterSummary
} from '../../../../shared/types'
import {
  MIN_SCHEDULER_INTERVAL_SEC,
  MIN_STORAGE_INTERVAL_SEC,
  PROMETHEUS_LABEL_PATTERN,
  SLURM_PARTITION_PATTERN,
  STORAGE_PATH_PATTERN
} from '../../../../shared/types'
import { type FormState, type SetFormField, toFormState } from './formState'
import BasicsSection from './sections/BasicsSection'
import SshSection from './sections/SshSection'
import JumpHostSection from './sections/JumpHostSection'
import AzureTunnelSection from './sections/AzureTunnelSection'
import TeleportSection from './sections/TeleportSection'
import GrafanaSection from './sections/GrafanaSection'
import SchedulerConfigSection from './sections/SchedulerConfigSection'
import StorageConfigSection from './sections/StorageConfigSection'
import JiraConfigSection from './sections/JiraConfigSection'
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

  const set: SetFormField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

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
        <p className="hint">
          <span className="required-mark" aria-hidden="true">
            *
          </span>{' '}
          Required
        </p>
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
              {activeSection === 'basics' && <BasicsSection form={form} set={set} />}
              {activeSection === 'ssh' && <SshSection form={form} set={set} initial={initial} />}
              {activeSection === 'jumpHost' && (
                <JumpHostSection form={form} set={set} initial={initial} />
              )}
              {activeSection === 'azure' && (
                <AzureTunnelSection
                  form={form}
                  set={set}
                  setForm={setForm}
                  initial={initial}
                  subscriptions={subscriptions}
                  subscriptionsError={subscriptionsError}
                  loadingSubscriptions={loadingSubscriptions}
                  loadSubscriptions={loadSubscriptions}
                  vmMatches={vmMatches}
                  vmLookupError={vmLookupError}
                  vmFoundMessage={vmFoundMessage}
                  findingVm={findingVm}
                  handleFindVm={handleFindVm}
                  applyVmMatch={applyVmMatch}
                  verifyingTunnel={verifyingTunnel}
                  verifyProgress={verifyProgress}
                  verifyCommand={verifyCommand}
                  verifyResult={verifyResult}
                  verifyFailure={verifyFailure}
                  handleVerifyTunnel={handleVerifyTunnel}
                />
              )}
              {activeSection === 'teleport' && (
                <TeleportSection form={form} set={set} setForm={setForm} />
              )}
              {activeSection === 'grafana' && (
                <GrafanaSection form={form} set={set} initial={initial} />
              )}
              {activeSection === 'scheduler' && (
                <SchedulerConfigSection form={form} set={set} setForm={setForm} />
              )}
              {activeSection === 'storage' && <StorageConfigSection form={form} set={set} />}
              {activeSection === 'jira' && (
                <JiraConfigSection form={form} set={set} initial={initial} />
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
