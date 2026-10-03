import { useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import type {
  ClusterSummary,
  JiraAssignKind,
  JiraIssueSummary,
  JiraListFilter
} from '../../../../shared/types'

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

const NEEDS_VALUE: Array<JiraAssignKind | 'any'> = ['team', 'group', 'user']

function loadAssigned(clusterId: string): { kind: JiraAssignKind | 'any'; value: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(`gateh.jira.assigned.${clusterId}`) ?? 'null') as {
      kind?: string
      value?: string
    } | null
    if (raw && ['me', 'unassigned', 'user', 'group', 'team'].includes(raw.kind ?? '')) {
      return { kind: raw.kind as JiraAssignKind, value: raw.value ?? '' }
    }
  } catch {
    // No saved choice.
  }
  return { kind: 'any', value: '' }
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
  const [assignKind, setAssignKind] = useState<JiraAssignKind | 'any'>(
    () => loadAssigned(cluster.id).kind
  )
  const [assignValue, setAssignValue] = useState(() => loadAssigned(cluster.id).value)
  const [filter, setFilter] = useState<JiraListFilter>(() => {
    const saved = loadAssigned(cluster.id)
    return saved.kind === 'any' ? {} : { assigned: { kind: saved.kind, value: saved.value } }
  })

  function applyFilter(next: {
    text?: string
    openOnly?: boolean
    kind?: JiraAssignKind | 'any'
    value?: string
  }): void {
    const kind = next.kind ?? assignKind
    const value = next.value ?? assignValue
    try {
      localStorage.setItem(`gateh.jira.assigned.${cluster.id}`, JSON.stringify({ kind, value }))
    } catch {
      // Applies for this session only.
    }
    setFilter({
      text: (next.text ?? text).trim(),
      openOnly: next.openOnly ?? openOnly,
      assigned: kind === 'any' ? undefined : { kind, value }
    })
  }
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
  }, [autoRefresh, cluster.id, cluster.jira, filter])

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
      {!cluster.jira.projectKey && !cluster.jira.jql?.trim() && cluster.tags.length === 0 && (
        <p className="hint">
          This cluster has no Jira project key, JQL filter or tags, so this lists every ticket you
          can see (last 90 days). Add a tag or a project key to the cluster to scope it.
        </p>
      )}
      <form
        className="slurm-toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          applyFilter({})
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
              applyFilter({ openOnly: e.target.checked })
            }}
          />
          Unresolved only
        </label>
        <select
          className="slurm-user-filter"
          value={assignKind}
          onChange={(e) => {
            const kind = e.target.value as JiraAssignKind | 'any'
            setAssignKind(kind)
            // Kinds with a name wait for it; the rest apply straight away.
            if (!NEEDS_VALUE.includes(kind)) applyFilter({ kind })
          }}
          aria-label="Filter by assignee"
        >
          <option value="any">Assigned to anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          <option value="team">Assigned to team...</option>
          <option value="group">Assigned to group...</option>
          <option value="user">Assigned to user...</option>
        </select>
        {NEEDS_VALUE.includes(assignKind) && (
          <input
            className="slurm-user-filter"
            type="text"
            placeholder={assignKind === 'user' ? 'Name or account' : `${assignKind} name`}
            value={assignValue}
            onChange={(e) => setAssignValue(e.target.value)}
            aria-label="Assignee, team or group name"
          />
        )}
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
