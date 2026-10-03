import type { SlurmJob, SlurmNode } from '../../../../shared/types'
import { shortTime, stateClass } from './slurmState'
// The shared modal styles (.modal-overlay, .modal, .modal-actions) live with the cluster form.
import '../clusters/clusters.css'

interface NodeJobsDialogProps {
  node: SlurmNode
  jobs: SlurmJob[]
  onClose: () => void
}

/** The running jobs on one node, from the latest Slurm snapshot. */
export default function NodeJobsDialog({
  node,
  jobs,
  onClose
}: NodeJobsDialogProps): React.JSX.Element {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>
          {jobs.length} running job{jobs.length === 1 ? '' : 's'} on {node.name}
        </h2>
        <div className="issue-list">
          {jobs.map((job) => (
            <div className="node-job-card" key={job.id}>
              <div>
                <span className="slurm-mono">{job.id}</span>{' '}
                <span className={`issue-status ${stateClass(job.state)}`}>
                  {job.state.toLowerCase()}
                </span>
              </div>
              <div>{job.name}</div>
              <div className="node-job-meta">
                {job.user && (
                  <>
                    <span className="slurm-dim">User</span>
                    <span>{job.user}</span>
                  </>
                )}
                <span className="slurm-dim">Partition</span>
                <span>{job.partition}</span>
                <span className="slurm-dim">Time / limit</span>
                <span className="slurm-mono">
                  {job.elapsed} / {job.timeLimit}
                </span>
                {job.start && (
                  <>
                    <span className="slurm-dim">Started</span>
                    <span className="slurm-mono">{shortTime(job.start)}</span>
                  </>
                )}
                <span className="slurm-dim">Nodes</span>
                <span className="slurm-mono">
                  {job.nodes} · {job.reason}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
