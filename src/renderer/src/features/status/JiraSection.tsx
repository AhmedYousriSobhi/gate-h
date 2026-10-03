import { useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import type { ClusterSummary, JiraIssueSummary, JiraListFilter } from '../../../../shared/types'

function issueStatusClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized.includes('done') || normalized.includes('closed')) return 'issue-status-done'
  if (normalized.includes('progress')) return 'issue-status-active'
  return 'issue-status-todo'
}

const AUTO_REFRESH_MS = 60_000
const AUTO_REFRESH_KEY = 'gateh.jira.autoRefresh'

function loadAutoRefresh(): boolean {
  try {
    return localStorage.getItem(AUTO_REFRESH_KEY) === '1'
  } catch {
    return false
  }
}

interface JiraSectionProps {
  cluster: ClusterSummary
}

export default function JiraSection({ cluster }: JiraSectionProps): React.JSX.Element {
  const [issues, setIssues] = useState<JiraIssueSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [newSummary, setNewSummary] = useState('')
  const [creating, setCreating] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [text, setText] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [filter, setFilter] = useState<JiraListFilter>({})
  const [autoRefresh, setAutoRefresh] = useState(loadAutoRefresh)

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      setIssues(await window.api.jira.list(cluster.id, filter))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Jira issues.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  function toggleAutoRefresh(on: boolean): void {
    setAutoRefresh(on)
    try {
      localStorage.setItem(AUTO_REFRESH_KEY, on ? '1' : '0')
    } catch {
      // Not persisted; the toggle still works for this session.
    }
  }

  useEffect(() => {
    let cancelled = false
    window.api.jira
      .list(cluster.id, filter)
      .then((result) => {
        if (!cancelled) setIssues(result)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cluster.id, filter])

  useEffect(() => {
    if (!autoRefresh || !cluster.jira) return
    const timer = setInterval(() => void refresh(), AUTO_REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, cluster.id, cluster.jira])

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!newSummary.trim()) return
    setCreating(true)
    try {
      await window.api.jira.create(cluster.id, { summary: newSummary.trim() })
      setNewSummary('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Jira issue.')
    } finally {
      setCreating(false)
    }
  }

  if (!cluster.jira) {
    return <p className="hint">No Jira project configured for this cluster.</p>
  }

  if (loading) return <p className="hint">Loading Jira issues...</p>

  return (
    <div className="status-section">
      {!cluster.jira.projectKey && !cluster.jira.jql?.trim() && (
        <p className="hint">
          This cluster has no Jira project key or JQL filter, so this lists every ticket you can see
          (last 90 days). Edit the cluster and set one to scope it to this cluster.
        </p>
      )}
      <form
        className="slurm-toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          setFilter({ text: text.trim(), openOnly })
        }}
      >
        <input
          className="slurm-user-filter"
          type="text"
          placeholder="Search these tickets..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search Jira tickets"
        />
        <label className="form-field-checkbox">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => {
              setOpenOnly(e.target.checked)
              setFilter({ text: text.trim(), openOnly: e.target.checked })
            }}
          />
          Unresolved only
        </label>
        <button type="submit" className="btn btn-sm">
          Search
        </button>
      </form>
      <div className="slurm-toolbar">
        <label className="form-field-checkbox">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => toggleAutoRefresh(e.target.checked)}
          />
          Auto-refresh (every minute)
        </label>
        <button
          className="btn-icon"
          title="Refresh now"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} strokeWidth={2} className={refreshing ? 'slurm-spin' : ''} />
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {issues.length === 0 && !error && <p className="hint">No matching issues.</p>}
      <div className="issue-list">
        {issues.map((issue) => (
          <div className="issue-row" key={issue.key}>
            <div>
              <a href={issue.url} target="_blank" rel="noreferrer">
                {issue.key}
              </a>{' '}
              {issue.summary}
            </div>
            <span className={`issue-status ${issueStatusClass(issue.status)}`}>{issue.status}</span>
          </div>
        ))}
      </div>
      {cluster.jira.projectKey && (
        <form className="issue-form" onSubmit={handleCreate}>
          <input
            placeholder={`New ${cluster.jira.projectKey} ticket summary`}
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={creating}>
            <Plus size={14} strokeWidth={2.5} />
            {creating ? 'Creating...' : 'Create ticket'}
          </button>
        </form>
      )}
    </div>
  )
}
