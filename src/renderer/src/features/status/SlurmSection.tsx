import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react'
import {
  MAX_SLURM_JOBS,
  type ClusterSummary,
  type SchedulerSnapshot,
  type SlurmJob,
  type SlurmNode
} from '../../../../shared/types'
import GpuUsage from './GpuUsage'
import NodeDetailDialog from './NodeDetailDialog'
import SlurmHistory from './SlurmHistory'
import NodeList from './NodeList'
import { shortTime, stateClass } from './slurmState'

interface SlurmSectionProps {
  cluster: ClusterSummary
  /** The Status widget is showing. Hidden, nothing is watched, so nothing polls. */
  active: boolean
}

type ArrayTasks = SlurmJob[] | 'loading' | { error: string }

type SlurmSubsection = 'jobs' | 'nodes' | 'gpu'
const ALL_SUBSECTIONS: SlurmSubsection[] = ['jobs', 'nodes', 'gpu']
const SUBSECTION_LABELS: Record<SlurmSubsection, string> = {
  jobs: 'Jobs',
  nodes: 'Nodes',
  gpu: 'GPUs'
}

function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

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
  expander,
  onCancel
}: {
  job: SlurmJob
  showUser: boolean
  expander?: React.ReactNode
  /** Only for the user's own jobs; the main process asks for confirmation before scancel. */
  onCancel?: () => void
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
      <td className="slurm-action">
        {onCancel && (
          <button className="btn-icon" title={`Cancel job ${job.id}...`} onClick={onCancel}>
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </td>
    </tr>
  )
}

export default function SlurmSection({ cluster, active }: SlurmSectionProps): React.JSX.Element {
  const scheduler = cluster.scheduler
  const [snapshot, setSnapshot] = useState<SchedulerSnapshot | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [arrays, setArrays] = useState<Record<string, ArrayTasks>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<SlurmNode | null>(null)
  const [visibleSections, setVisibleSections] = useState<Set<SlurmSubsection>>(
    () => new Set(ALL_SUBSECTIONS)
  )
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set())
  const [textFilter, setTextFilter] = useState('')
  const [partitionFilter, setPartitionFilter] = useState('')
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

  // Collapsed array rows aren't cancellable as a whole; their tasks are, once expanded.
  function cancellable(job: SlurmJob): boolean {
    return (
      !isCollapsedArray(job.id) &&
      (job.user === undefined || job.user === cluster.connection.username) &&
      !['COMPLETED', 'COMPLETING', 'CANCELLED'].includes(job.state)
    )
  }

  async function cancel(jobId: string): Promise<void> {
    try {
      await window.api.scheduler.cancel(cluster.id, jobId)
      setActionError(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to cancel job ${jobId}.`)
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
  const columns = showUser ? 9 : 8
  const counts = new Map<string, number>()
  for (const job of snapshot.jobs) counts.set(job.state, (counts.get(job.state) ?? 0) + 1)
  const needle = textFilter.trim().toLowerCase()
  const filtersActive = stateFilter.size > 0 || needle.length > 0 || partitionFilter !== ''
  const jobPartitions = [...new Set(snapshot.jobs.map((job) => job.partition))].sort()
  // Counts/pills above the table always reflect every job, even while filtered, so there's
  // something to filter back to - only the table body is narrowed.
  const filteredJobs = snapshot.jobs.filter(
    (job) =>
      (stateFilter.size === 0 || stateFilter.has(job.state)) &&
      (partitionFilter === '' || job.partition === partitionFilter) &&
      (!needle ||
        [job.id, job.name, job.user ?? ''].some((field) => field.toLowerCase().includes(needle)))
  )

  function toggleSection(key: SlurmSubsection): void {
    setVisibleSections((prev) => toggled(prev, key))
  }

  function toggleStateFilter(state: string): void {
    setStateFilter((prev) => toggled(prev, state))
  }

  function resetFilters(): void {
    setStateFilter(new Set())
    setTextFilter('')
    setPartitionFilter('')
  }

  return (
    <div className="status-section">
      <div className="slurm-section-toggles">
        {ALL_SUBSECTIONS.map((key) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm${visibleSections.has(key) ? ' btn-primary' : ''}`}
            onClick={() => toggleSection(key)}
          >
            {SUBSECTION_LABELS[key]}
          </button>
        ))}
      </div>
      <div className="slurm-toolbar">
        <div className="slurm-counts">
          {[...counts].map(([state, count]) => {
            const selected = stateFilter.has(state)
            return (
              <button
                key={state}
                type="button"
                title={`Show only ${state.toLowerCase()} jobs`}
                aria-pressed={selected}
                className={`issue-status ${stateClass(state)} slurm-count-pill${
                  selected ? ' slurm-count-pill-selected' : ''
                }${stateFilter.size > 0 && !selected ? ' slurm-count-pill-dimmed' : ''}`}
                onClick={() => toggleStateFilter(state)}
              >
                {count} {state.toLowerCase()}
              </button>
            )
          })}
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

      {visibleSections.has('jobs') && snapshot.jobs.length > 0 && (
        <div className="slurm-toolbar">
          <input
            className="slurm-user-filter"
            type="text"
            placeholder={
              showUser ? 'Filter by job id, name or user...' : 'Filter by job id or name...'
            }
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            aria-label="Filter jobs by id, name or user"
          />
          {jobPartitions.length > 1 && (
            <select
              className="slurm-user-filter"
              value={partitionFilter}
              onChange={(e) => setPartitionFilter(e.target.value)}
              aria-label="Filter jobs by partition"
            >
              <option value="">All partitions</option>
              {jobPartitions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {filtersActive && (
            <button type="button" className="btn btn-sm" onClick={resetFilters}>
              Reset filters
            </button>
          )}
        </div>
      )}

      {snapshot.status === 'waiting' && <p className="hint">{snapshot.message}</p>}
      {actionError && <div className="error-banner">{actionError}</div>}
      {snapshot.status !== 'ok' && snapshot.status !== 'waiting' && (
        <div className="error-banner">
          {snapshot.message}
          {snapshot.fetchedAt && ' Showing the last successful refresh.'}
        </div>
      )}

      {snapshot.fetchedAt && (
        <>
          {visibleSections.has('jobs') &&
            (snapshot.jobs.length === 0 ? (
              <p className="hint">
                {showUser ? 'No jobs in the queue.' : 'You have no jobs in the queue.'}
              </p>
            ) : filteredJobs.length === 0 ? (
              <p className="hint">No jobs match the current filter.</p>
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((job) => {
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
                        <JobRow
                          key={job.id}
                          job={job}
                          showUser={showUser}
                          expander={expander}
                          onCancel={cancellable(job) ? () => void cancel(job.id) : undefined}
                        />,
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
                              onCancel={cancellable(task) ? () => void cancel(task.id) : undefined}
                            />
                          ))
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          {visibleSections.has('jobs') && snapshot.truncated && (
            <p className="hint">
              Showing the first {MAX_SLURM_JOBS.toLocaleString()} jobs. Filter above, or limit the
              partitions in the cluster settings, to see the rest.
            </p>
          )}

          {visibleSections.has('gpu') && <GpuUsage cluster={cluster} snapshot={snapshot} />}

          {visibleSections.has('nodes') && (
            <>
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
              {snapshot.nodes.length > 0 && (
                <NodeList nodes={snapshot.nodes} onSelect={setSelectedNode} />
              )}
            </>
          )}
        </>
      )}

      <SlurmHistory clusterId={cluster.id} autoLoad={!cluster.teleport} />

      {selectedNode && (
        <NodeDetailDialog
          key={selectedNode.name}
          cluster={cluster}
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  )
}
