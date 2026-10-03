import { useEffect, useState } from 'react'
import type { SlurmHistoryJob } from '../../../../shared/types'
import { shortTime, stateClass } from './slurmState'

const RANGES = [
  { days: 1, label: 'Last 24 h' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' }
]

/** The SSH user's recent jobs from sacct. Only loaded on request: sacct reads the accounting
 *  database, which there's no reason to poll. */
export default function SlurmHistory({
  clusterId,
  autoLoad
}: {
  clusterId: string
  /** Load the last 24 h on open. Off for Teleport, where every run is an audited session. */
  autoLoad: boolean
}): React.JSX.Element {
  const [days, setDays] = useState<number | null>(autoLoad ? 1 : null)
  const [jobs, setJobs] = useState<SlurmHistoryJob[] | null>(null)
  const [allUsers, setAllUsers] = useState(false)
  const [text, setText] = useState('')
  const [user, setUser] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(autoLoad)
  const [error, setError] = useState<string | null>(null)

  async function load(range: number, everyone = allUsers): Promise<void> {
    setDays(range)
    setLoading(true)
    setError(null)
    try {
      setJobs(await window.api.scheduler.history(clusterId, range, everyone))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the job history.')
      setJobs(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!autoLoad) return
    let cancelled = false
    window.api.scheduler
      .history(clusterId, 1)
      .then((result) => {
        if (!cancelled) setJobs(result)
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
  }, [clusterId, autoLoad])

  const needle = text.trim().toLowerCase()
  const users = [...new Set((jobs ?? []).map((job) => job.user))].sort()
  // Slurm times are cluster-local text (`2026-09-29T14:05:00`), so compare the date part as text.
  const shown = (jobs ?? []).filter((job) => {
    const day = (job.end ?? job.start ?? '').slice(0, 10)
    return (
      (!needle ||
        job.id.toLowerCase().includes(needle) ||
        job.name.toLowerCase().includes(needle)) &&
      (user === '' || job.user === user) &&
      (!from || day >= from) &&
      (!to || day <= to)
    )
  })
  const filtered = needle !== '' || user !== '' || from !== '' || to !== ''

  return (
    <>
      <div className="slurm-toolbar">
        <h3 className="slurm-subheading slurm-grow">History</h3>
        <label className="form-field-checkbox">
          <input
            type="checkbox"
            checked={allUsers}
            disabled={loading}
            onChange={(e) => {
              setAllUsers(e.target.checked)
              setUser('')
              void load(days ?? 1, e.target.checked)
            }}
          />
          All users
        </label>
        {RANGES.map((range) => (
          <button
            key={range.days}
            className={`btn btn-sm${days === range.days ? ' btn-primary' : ''}`}
            disabled={loading}
            onClick={() => void load(range.days)}
          >
            {range.label}
          </button>
        ))}
      </div>
      {jobs && jobs.length > 0 && (
        <div className="slurm-toolbar">
          <input
            className="slurm-user-filter"
            type="text"
            placeholder="Filter by job id or name..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Filter history by job id or name"
          />
          {allUsers && users.length > 1 && (
            <select
              className="slurm-user-filter"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              aria-label="Filter history by user"
            >
              <option value="">All users</option>
              {users.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <input
            className="slurm-user-filter"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Ended on or after"
          />
          <input
            className="slurm-user-filter"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Ended on or before"
          />
          {filtered && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setText('')
                setUser('')
                setFrom('')
                setTo('')
              }}
            >
              Reset filters
            </button>
          )}
        </div>
      )}
      {days === null && !loading && (
        <p className="hint">Pick a range to load your finished jobs from sacct.</p>
      )}
      {loading && <p className="hint">Loading job history...</p>}
      {error && <div className="error-banner">{error}</div>}
      {!loading && jobs && jobs.length === 0 && <p className="hint">No jobs in this period.</p>}
      {!loading && jobs && jobs.length > 0 && shown.length === 0 && (
        <p className="hint">No jobs match the current filter.</p>
      )}
      {!loading && shown.length > 0 && (
        <div className="slurm-table-wrap">
          <table className="slurm-table">
            <thead>
              <tr>
                <th>Job</th>
                {allUsers && <th>User</th>}
                <th>Partition</th>
                <th>State</th>
                <th>Exit</th>
                <th>Elapsed</th>
                <th>CPU eff.</th>
                <th>Ended</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((job) => (
                <tr key={job.id}>
                  <td className="slurm-mono">{job.id}</td>
                  {allUsers && <td>{job.user}</td>}
                  <td>{job.partition}</td>
                  <td>
                    <span className={`issue-status ${stateClass(job.state)}`}>
                      {job.state.toLowerCase()}
                    </span>
                  </td>
                  <td className="slurm-mono">{job.exitCode}</td>
                  <td className="slurm-mono">{job.elapsed}</td>
                  <td
                    className="slurm-mono"
                    title="CPU time used (TotalCPU) as a share of reserved CPU time (AllocCPUS x Elapsed)"
                  >
                    {job.cpuEfficiencyPct !== null ? `${job.cpuEfficiencyPct}%` : '—'}
                  </td>
                  <td className="slurm-mono">{job.end ? shortTime(job.end) : 'running'}</td>
                  <td className="slurm-name" title={job.name}>
                    {job.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
