import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import {
  MAX_SLURM_JOBS,
  type ClusterSummary,
  type SchedulerSnapshot,
  type SlurmJob
} from '../../../../shared/types'
import SlurmHistory from './SlurmHistory'
import { shortTime, stateClass } from './slurmState'

interface SlurmSectionProps {
  cluster: ClusterSummary
  /** The Status widget is showing. Hidden, nothing is watched, so nothing polls. */
  active: boolean
}

type ArrayTasks = SlurmJob[] | 'loading' | { error: string }

function age(fetchedAt: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 1000))
  if (seconds < 20) return 'just now'
  if (seconds < 90) return `${seconds} s ago`
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

/** `123_[8-500]` - squeue's default, collapsed view of an array's pending tasks. */
function isCollapsedArray(id: string): boolean {
  return /^\d+_\[/.test(id)
}

function JobRow({
  job,
  showUser,
  expander
}: {
  job: SlurmJob
  showUser: boolean
  expander?: React.ReactNode
}): React.JSX.Element {
  const pending = job.state === 'PENDING'
  return (
    <tr>
      <td className="slurm-mono">
        {expander}
        {job.id}
      </td>
      <td>{job.partition}</td>
      {showUser && <td>{job.user}</td>}
      <td>
        <span className={`issue-status ${stateClass(job.state)}`}>{job.state.toLowerCase()}</span>
      </td>
      <td className="slurm-mono">
        {job.elapsed} / {job.timeLimit}
      </td>
      <td>{job.nodes}</td>
      <td className="slurm-mono slurm-wrap">
        {job.reason}
        {pending && job.start && (
          <span className="slurm-dim slurm-block">est. start {shortTime(job.start)}</span>
        )}
      </td>
      <td className="slurm-name" title={job.name}>
        {job.name}
      </td>
    </tr>
  )
}

export default function SlurmSection({ cluster, active }: SlurmSectionProps): React.JSX.Element {
  const scheduler = cluster.scheduler
  const [snapshot, setSnapshot] = useState<SchedulerSnapshot | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [arrays, setArrays] = useState<Record<string, ArrayTasks>>({})
  const watching = active && scheduler !== null
  // Re-watch after the settings change, so the next snapshot reflects them.
  const configKey = scheduler ? JSON.stringify(scheduler) : null

  useEffect(() => {
    if (!watching) return
    const off = window.api.scheduler.onSnapshot((next) => {
      if (next.clusterId === cluster.id) setSnapshot(next)
    })
    window.api.scheduler.watch(cluster.id)
    return () => {
      off()
      window.api.scheduler.unwatch(cluster.id)
    }
  }, [cluster.id, watching, configKey])

  useEffect(() => {
    if (!watching) return
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [watching])

  async function toggleArray(job: SlurmJob): Promise<void> {
    if (arrays[job.id]) {
      setArrays((prev) => {
        const next = { ...prev }
        delete next[job.id]
        return next
      })
      return
    }
    setArrays((prev) => ({ ...prev, [job.id]: 'loading' }))
    try {
      const tasks = await window.api.scheduler.arrayTasks(cluster.id, job.id.split('_')[0])
      setArrays((prev) => ({ ...prev, [job.id]: tasks }))
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to load the array tasks.'
      setArrays((prev) => ({ ...prev, [job.id]: { error } }))
    }
  }

  if (!scheduler) {
    return (
      <p className="hint">
        No scheduler configured for this cluster. Edit the cluster to turn on Slurm.
      </p>
    )
  }
  if (!snapshot) return <p className="hint">Loading Slurm queue...</p>

  const showUser = scheduler.scope === 'partitions'
  const columns = showUser ? 8 : 7
  const counts = new Map<string, number>()
  for (const job of snapshot.jobs) counts.set(job.state, (counts.get(job.state) ?? 0) + 1)

  return (
    <div className="status-section">
      <div className="slurm-toolbar">
        <div className="slurm-counts">
          {[...counts].map(([state, count]) => (
            <span key={state} className={`issue-status ${stateClass(state)}`}>
              {count} {state.toLowerCase()}
            </span>
          ))}
        </div>
        <span className="slurm-dim">
          {snapshot.fetchedAt && `Updated ${age(snapshot.fetchedAt, now)}`}
          {!scheduler.autoRefresh && ' · auto-refresh off'}
        </span>
        <button
          className="btn-icon"
          title="Refresh now"
          disabled={snapshot.refreshing}
          onClick={() => window.api.scheduler.refresh(cluster.id)}
        >
          <RefreshCw
            size={14}
            strokeWidth={2}
            className={snapshot.refreshing ? 'slurm-spin' : ''}
          />
        </button>
      </div>

      {snapshot.status === 'waiting' && <p className="hint">{snapshot.message}</p>}
      {snapshot.status !== 'ok' && snapshot.status !== 'waiting' && (
        <div className="error-banner">
          {snapshot.message}
          {snapshot.fetchedAt && ' Showing the last successful refresh.'}
        </div>
      )}

      {snapshot.fetchedAt && (
        <>
          {snapshot.jobs.length === 0 ? (
            <p className="hint">
              {showUser ? 'No jobs in these partitions.' : 'You have no jobs in the queue.'}
            </p>
          ) : (
            <div className="slurm-table-wrap">
              <table className="slurm-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Partition</th>
                    {showUser && <th>User</th>}
                    <th>State</th>
                    <th>Time / limit</th>
                    <th>Nodes</th>
                    <th>Nodes or reason</th>
                    <th>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.jobs.map((job) => {
                    const tasks = arrays[job.id]
                    const expander = isCollapsedArray(job.id) ? (
                      <button
                        className="slurm-expander"
                        title={tasks ? 'Collapse array' : 'Show array tasks'}
                        onClick={() => void toggleArray(job)}
                      >
                        {tasks ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    ) : undefined
                    return [
                      <JobRow key={job.id} job={job} showUser={showUser} expander={expander} />,
                      tasks === 'loading' && (
                        <tr key={`${job.id}-loading`} className="slurm-subrow">
                          <td colSpan={columns} className="slurm-dim">
                            Loading tasks...
                          </td>
                        </tr>
                      ),
                      tasks && !Array.isArray(tasks) && tasks !== 'loading' && (
                        <tr key={`${job.id}-error`} className="slurm-subrow">
                          <td colSpan={columns} className="slurm-error">
                            {tasks.error}
                          </td>
                        </tr>
                      ),
                      Array.isArray(tasks) &&
                        tasks.map((task) => (
                          <JobRow
                            key={`${job.id}-${task.id}`}
                            job={task}
                            showUser={showUser}
                            expander={<span className="slurm-indent" />}
                          />
                        ))
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )}
          {snapshot.truncated && (
            <p className="hint">
              Showing the first {MAX_SLURM_JOBS.toLocaleString()} jobs. Narrow the partitions in the
              cluster settings to see the rest.
            </p>
          )}

          <h3 className="slurm-subheading">Nodes</h3>
          {snapshot.partitions.length === 0 ? (
            <p className="hint">sinfo reported no partitions.</p>
          ) : (
            <div className="slurm-table-wrap">
              <table className="slurm-table">
                <thead>
                  <tr>
                    <th>Partition</th>
                    <th>Available</th>
                    <th>Nodes</th>
                    <th>By state</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.partitions.map((partition) => (
                    <tr key={partition.name}>
                      <td>{partition.name}</td>
                      <td>{partition.available}</td>
                      <td>{partition.totalNodes}</td>
                      <td>
                        {Object.entries(partition.nodesByState)
                          .map(([state, count]) => `${count} ${state}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {snapshot.nodeIssues.length > 0 && (
            <div className="issue-list">
              {snapshot.nodeIssues.map((issue) => (
                <div className="issue-row" key={`${issue.nodes}-${issue.state}`}>
                  <div>
                    <span className="slurm-mono">{issue.nodes}</span> {issue.reason}
                  </div>
                  <span className="issue-status slurm-state-failed">{issue.state}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <SlurmHistory clusterId={cluster.id} />
    </div>
  )
}
