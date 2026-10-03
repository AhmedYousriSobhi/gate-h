import { useEffect, useState } from 'react'
import { hostlistContains } from '../../../../shared/hostlist'
import type {
  ClusterSummary,
  JiraIssueSummary,
  SlurmJob,
  SlurmNode
} from '../../../../shared/types'
import { nodeStateClass } from './slurmState'
// The shared modal styles (.modal-overlay, .modal, .modal-actions) live with the cluster form.
import '../clusters/clusters.css'

interface NodeDetailDialogProps {
  cluster: ClusterSummary
  node: SlurmNode
  /** The latest Slurm snapshot's jobs; the ones running on this node are listed. */
  jobs: SlurmJob[]
  /** False when the snapshot only holds the user's own jobs. */
  allUsers: boolean
  onClose: () => void
}

type Issues = JiraIssueSummary[] | 'loading' | { error: string }

function issueStatusClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized.includes('done') || normalized.includes('closed')) return 'issue-status-done'
  if (normalized.includes('progress')) return 'issue-status-active'
  return 'issue-status-todo'
}

/** Node state + related Jira tickets (see docs/JIRA_GUIDE.md section 4's "mentioning a specific
 *  compute node" recipe) with a one-click "Create incident" when nothing matches - the existing
 *  Jira create path (createJiraIssue), not a separate web-form deep link; see JIRA_GUIDE.md for
 *  why a URL-based create isn't used (unsupported/deprecated on current Jira). */
export default function NodeDetailDialog({
  cluster,
  node,
  jobs,
  allUsers,
  onClose
}: NodeDetailDialogProps): React.JSX.Element {
  const [issues, setIssues] = useState<Issues>('loading')
  const [created, setCreated] = useState<JiraIssueSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (!cluster.jira) return
    let cancelled = false
    window.api.jira
      .searchNode(cluster.id, node.name)
      .then((result) => {
        if (!cancelled) setIssues(result)
      })
      .catch((err: Error) => {
        if (!cancelled) setIssues({ error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [cluster.id, cluster.jira, node.name])

  async function createIncident(): Promise<void> {
    setCreating(true)
    setCreateError(null)
    try {
      const issue = await window.api.jira.create(cluster.id, {
        summary: `Node ${node.name} is ${node.state}`,
        description: `Reported from Gate-H: node ${node.name} (partitions: ${
          node.partitions.join(', ') || 'none'
        }) is in state "${node.state}".`
      })
      setCreated(issue)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create the Jira ticket.')
    } finally {
      setCreating(false)
    }
  }

  const nodeJobs = jobs.filter(
    (job) => job.state === 'RUNNING' && hostlistContains(job.reason, node.name)
  )
  const noMatches = Array.isArray(issues) && issues.length === 0 && !created

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Node {node.name}</h2>
        <p className="hint">
          State: <span className={`issue-status ${nodeStateClass(node.state)}`}>{node.state}</span>
          {node.partitions.length > 0 && ` · partitions: ${node.partitions.join(', ')}`}
        </p>

        <h3 className="slurm-subheading">Running jobs on this node</h3>
        {nodeJobs.length === 0 ? (
          <p className="hint">
            {allUsers ? 'No running jobs.' : 'None of your jobs. Only your own jobs are listed.'}
          </p>
        ) : (
          <div className="issue-list">
            {nodeJobs.map((job) => (
              <div className="issue-row" key={job.id}>
                <div>
                  <span className="slurm-mono">{job.id}</span> {job.name}
                  {job.user && <span className="slurm-dim"> · {job.user}</span>}
                </div>
                <span className="slurm-mono slurm-dim">
                  {job.elapsed} / {job.timeLimit}
                </span>
              </div>
            ))}
          </div>
        )}

        {!cluster.jira && <p className="hint">No Jira project configured for this cluster.</p>}

        {cluster.jira && issues === 'loading' && <p className="hint">Searching Jira...</p>}
        {cluster.jira && !Array.isArray(issues) && issues !== 'loading' && (
          <div className="error-banner">{issues.error}</div>
        )}
        {cluster.jira && Array.isArray(issues) && issues.length > 0 && (
          <div className="issue-list">
            {issues.map((issue) => (
              <div className="issue-row" key={issue.key}>
                <div>
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    {issue.key}
                  </a>{' '}
                  {issue.summary}
                </div>
                <span className={`issue-status ${issueStatusClass(issue.status)}`}>
                  {issue.status}
                </span>
              </div>
            ))}
          </div>
        )}
        {cluster.jira && noMatches && <p className="hint">No Jira tickets mention this node.</p>}

        {cluster.jira?.projectKey && noMatches && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={creating}
            onClick={() => void createIncident()}
          >
            {creating ? 'Creating...' : 'Create incident'}
          </button>
        )}
        {createError && <div className="error-banner">{createError}</div>}
        {created && (
          <p className="hint">
            Created{' '}
            <a href={created.url} target="_blank" rel="noreferrer">
              {created.key}
            </a>
            .
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
