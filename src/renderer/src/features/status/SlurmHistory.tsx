import { useState } from 'react'
import type { SlurmHistoryJob } from '../../../../shared/types'
import { shortTime, stateClass } from './slurmState'

const RANGES = [
  { days: 1, label: 'Last 24 h' },
  { days: 7, label: 'Last 7 days' }
]

/** The SSH user's recent jobs from sacct. Only loaded on request: sacct reads the accounting
 *  database, which there's no reason to poll. */
export default function SlurmHistory({ clusterId }: { clusterId: string }): React.JSX.Element {
  const [days, setDays] = useState<number | null>(null)
  const [jobs, setJobs] = useState<SlurmHistoryJob[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(range: number): Promise<void> {
    setDays(range)
    setLoading(true)
    setError(null)
    try {
      setJobs(await window.api.scheduler.history(clusterId, range))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the job history.')
      setJobs(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="slurm-toolbar">
        <h3 className="slurm-subheading slurm-grow">History</h3>
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
      {loading && <p className="hint">Loading job history...</p>}
      {error && <div className="error-banner">{error}</div>}
      {!loading && jobs && jobs.length === 0 && <p className="hint">No jobs in this period.</p>}
      {!loading && jobs && jobs.length > 0 && (
        <div className="slurm-table-wrap">
          <table className="slurm-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Partition</th>
                <th>State</th>
                <th>Exit</th>
                <th>Elapsed</th>
                <th>Ended</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="slurm-mono">{job.id}</td>
                  <td>{job.partition}</td>
                  <td>
                    <span className={`issue-status ${stateClass(job.state)}`}>
                      {job.state.toLowerCase()}
                    </span>
                  </td>
                  <td className="slurm-mono">{job.exitCode}</td>
                  <td className="slurm-mono">{job.elapsed}</td>
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
