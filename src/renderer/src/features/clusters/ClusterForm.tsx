import { useState } from 'react'
import type {
  ClusterInput,
  ClusterSummary,
  JiraAuthMode,
  SshAuthMethod
} from '../../../../shared/types'

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
    jiraApiToken: ''
  }
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

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      setError('Name, host, and username are required.')
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
      grafanaApiToken: form.grafanaApiToken || undefined,
      jira: form.useJira
        ? {
            baseUrl: form.jiraBaseUrl.trim(),
            authMode: form.jiraAuthMode,
            email: form.jiraAuthMode === 'cloud' ? form.jiraEmail.trim() : undefined,
            projectKey: form.jiraProjectKey.trim() || undefined,
            jql: form.jiraJql.trim() || undefined
          }
        : null,
      jiraApiToken: form.jiraApiToken || undefined
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
            <h4>SSH connection</h4>
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
                checked={form.useGrafana}
                onChange={(e) => set('useGrafana', e.target.checked)}
              />
              <h4 style={{ margin: 0 }}>Grafana status</h4>
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
              <h4 style={{ margin: 0 }}>Jira</h4>
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
                    />
                  </div>
                </div>
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
