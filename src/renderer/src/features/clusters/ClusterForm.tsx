import { useState } from 'react'
import { BarChart3, Cloud, KeyRound, Ticket } from 'lucide-react'
import type {
  AzureSubscription,
  AzureTunnelMode,
  ClusterInput,
  ClusterSummary,
  JiraAuthMode,
  SshAuthMethod
} from '../../../../shared/types'
import { toClusterSlug } from '../../../../shared/clusterSlug'
import './clusters.css'

interface ClusterFormProps {
  initial?: ClusterSummary
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
  useJumpHost: boolean
  jumpHost: string
  jumpPort: string
  jumpUsername: string
  jumpAuthMethod: SshAuthMethod
  jumpPrivateKeyPath: string
  useGrafana: boolean
  grafanaBaseUrl: string
  grafanaDashboardUids: string
  grafanaApiToken: string
  useJira: boolean
  jiraBaseUrl: string
  jiraAuthMode: JiraAuthMode
  jiraEmail: string
  jiraProjectKey: string
  jiraJql: string
  jiraApiToken: string
  useAzureTunnel: boolean
  azureMode: AzureTunnelMode
  azureSubscription: string
  azureTenant: string
  azureResourceGroup: string
  azureLocalPort: string
  azureBastionName: string
  azureTargetResourceId: string
  azureVmName: string
  azureLocalUser: string
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
    useJumpHost: Boolean(c?.connection.jumpHost),
    jumpHost: c?.connection.jumpHost?.host ?? '',
    jumpPort: String(c?.connection.jumpHost?.port ?? 22),
    jumpUsername: c?.connection.jumpHost?.username ?? '',
    jumpAuthMethod: c?.connection.jumpHost?.authMethod ?? 'private-key',
    jumpPrivateKeyPath: c?.connection.jumpHost?.privateKeyPath ?? '',
    useGrafana: Boolean(c?.grafana),
    grafanaBaseUrl: c?.grafana?.baseUrl ?? '',
    grafanaDashboardUids: c?.grafana?.dashboardUids.join(', ') ?? '',
    grafanaApiToken: '',
    useJira: Boolean(c?.jira),
    jiraBaseUrl: c?.jira?.baseUrl ?? '',
    jiraAuthMode: c?.jira?.authMode ?? 'cloud',
    jiraEmail: c?.jira?.email ?? '',
    jiraProjectKey: c?.jira?.projectKey ?? '',
    jiraJql: c?.jira?.jql ?? '',
    jiraApiToken: '',
    useAzureTunnel: Boolean(c?.azureTunnel),
    azureMode: c?.azureTunnel?.mode ?? 'bastion',
    azureSubscription: c?.azureTunnel?.subscription ?? '',
    azureTenant: c?.azureTunnel?.tenant ?? '',
    azureResourceGroup: c?.azureTunnel?.resourceGroup ?? '',
    azureLocalPort: c?.azureTunnel ? String(c.azureTunnel.localPort) : '',
    azureBastionName: c?.azureTunnel?.bastionName ?? '',
    azureTargetResourceId: c?.azureTunnel?.targetResourceId ?? '',
    azureVmName: c?.azureTunnel?.vmName ?? '',
    azureLocalUser: c?.azureTunnel?.localUser ?? ''
  }
}

/** Returns why the Azure tunnel settings can't be saved, or null if they can. */
function azureTunnelError(form: FormState): string | null {
  if (!form.useAzureTunnel) return null
  if (form.useJumpHost) return 'Use either a jump host or an Azure tunnel, not both.'
  if (!form.azureSubscription.trim() || !form.azureResourceGroup.trim()) {
    return 'Azure tunnel needs a subscription and a resource group.'
  }
  const port = Number(form.azureLocalPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Azure tunnel local port must be a number between 1 and 65535.'
  }
  if (
    form.azureMode === 'bastion' &&
    (!form.azureBastionName.trim() || !form.azureTargetResourceId.trim())
  ) {
    return 'Azure Bastion needs the bastion name and the target VM resource ID.'
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

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function loadSubscriptions(): Promise<void> {
    setSubscriptionsError(null)
    setLoadingSubscriptions(true)
    try {
      const list = await window.api.azure.listSubscriptions()
      setSubscriptions(list)
      if (!form.azureSubscription) {
        const preferred = list.find((s) => s.isDefault) ?? list[0]
        set('azureSubscription', preferred.id)
      }
    } catch (err) {
      setSubscriptionsError(err instanceof Error ? err.message : 'Failed to list subscriptions.')
    } finally {
      setLoadingSubscriptions(false)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      setError('Name, host, and username are required.')
      return
    }
    const tunnelError = azureTunnelError(form)
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
        jumpHost: form.useJumpHost
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
            dashboardUids: splitList(form.grafanaDashboardUids)
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
            bastionName: form.azureMode === 'bastion' ? form.azureBastionName.trim() : undefined,
            targetResourceId:
              form.azureMode === 'bastion' ? form.azureTargetResourceId.trim() : undefined,
            vmName: form.azureMode === 'az-ssh' ? form.azureVmName.trim() : undefined,
            localUser:
              form.azureMode === 'az-ssh' ? form.azureLocalUser.trim() || undefined : undefined
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
                <label htmlFor="host">Host</label>
                <input id="host" value={form.host} onChange={(e) => set('host', e.target.value)} />
              </div>
              <div className="form-field">
                <label htmlFor="port">Port</label>
                <input id="port" value={form.port} onChange={(e) => set('port', e.target.value)} />
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
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.useJumpHost}
                onChange={(e) => set('useJumpHost', e.target.checked)}
              />
              Connect through a jump/bastion host
            </label>
            {form.useJumpHost && (
              <>
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
              </>
            )}
          </div>

          <div className="form-section">
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.useAzureTunnel}
                onChange={(e) => set('useAzureTunnel', e.target.checked)}
              />
              <h4 style={{ margin: 0 }}>
                <Cloud size={13} strokeWidth={2} />
                Azure tunnel
              </h4>
            </label>
            {form.useAzureTunnel && (
              <>
                <p className="hint">
                  Before connecting, Gate-H signs in with the Azure CLI (az), selects this
                  subscription, and opens a tunnel. SSH then connects to 127.0.0.1 on the local
                  port, and Host/Port above are the tunnel&apos;s far end: the target VM (Bastion),
                  or the login node as the VM reaches it (az ssh vm). Needs az on PATH. See the
                  README section on clusters reachable only through Azure.
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
                      list="azureSubscriptionOptions"
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
                  <datalist id="azureSubscriptionOptions">
                    {subscriptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </datalist>
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
                      <label htmlFor="azureTargetResourceId">Target VM resource ID</label>
                      <input
                        id="azureTargetResourceId"
                        placeholder="/subscriptions/.../resourceGroups/.../providers/Microsoft.Compute/virtualMachines/..."
                        value={form.azureTargetResourceId}
                        onChange={(e) => set('azureTargetResourceId', e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="azureVmName">VM name</label>
                      <input
                        id="azureVmName"
                        value={form.azureVmName}
                        onChange={(e) => set('azureVmName', e.target.value)}
                      />
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
              </>
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
