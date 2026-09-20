import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { ClusterSummary, JiraIssueSummary } from '../../../../shared/types'

function issueStatusClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized.includes('done') || normalized.includes('closed')) return 'issue-status-done'
  if (normalized.includes('progress')) return 'issue-status-active'
  return 'issue-status-todo'
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

  async function refresh(): Promise<void> {
    try {
      setIssues(await window.api.jira.list(cluster.id))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Jira issues.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    window.api.jira
      .list(cluster.id)
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
  }, [cluster.id])

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
