import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import type { ClusterSummary, GpuSample, SchedulerSnapshot } from '../../../../shared/types'
import { nodeIsDown } from './slurmState'

interface GpuUsageProps {
  cluster: ClusterSummary
  snapshot: SchedulerSnapshot
}

function Bar({
  label,
  value,
  max,
  format
}: {
  label: string
  value: number | null
  max: number | null
  format: (value: number) => string
}): React.JSX.Element {
  const fraction = value !== null && max ? Math.min(value / max, 1) : 0
  return (
    <div className="storage-meter">
      <div className="storage-meter-label">
        <span>{label}</span>
        <span className="slurm-mono storage-meter-value">
          {value === null ? 'n/a' : format(value)}
          {value !== null && max && max !== 100 ? ` / ${format(max)}` : ''}
        </span>
      </div>
      <div className="storage-bar">
        <div
          className={`storage-bar-fill${fraction >= 0.95 ? ' storage-high' : ''}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  )
}

const percent = (value: number): string => `${Math.round(value)}%`
const gib = (mib: number): string => `${(mib / 1024).toFixed(1)} GiB`

/** Installed GPUs per model, split by what their node is doing. Static GRES config from sinfo, so
 *  "busy" means the node is allocated or mixed, not that the GPU itself is in use. */
function CapacitySummary({ snapshot }: { snapshot: SchedulerSnapshot }): React.JSX.Element | null {
  const byModel = new Map<string, { total: number; busy: number; idle: number; down: number }>()
  for (const node of snapshot.nodes) {
    for (const gres of node.gpus) {
      const row = byModel.get(gres.type) ?? { total: 0, busy: 0, idle: 0, down: 0 }
      row.total += gres.count
      if (nodeIsDown(node.state)) row.down += gres.count
      else if (/^idle/i.test(node.state)) row.idle += gres.count
      else row.busy += gres.count
      byModel.set(gres.type, row)
    }
  }
  if (byModel.size === 0) return null
  return (
    <div className="slurm-table-wrap">
      <table className="slurm-table">
        <thead>
          <tr>
            <th>GPU</th>
            <th>Installed</th>
            <th>On busy nodes</th>
            <th>On idle nodes</th>
            <th>On down nodes</th>
          </tr>
        </thead>
        <tbody>
          {[...byModel].map(([model, row]) => (
            <tr key={model}>
              <td>{model}</td>
              <td>{row.total}</td>
              <td>{row.busy}</td>
              <td>{row.idle}</td>
              <td>{row.down}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** GPUs on the nodes of the user's running jobs: from the cluster's DCGM metrics in Grafana,
 *  refreshed with each Slurm snapshot, or sampled with nvidia-smi inside one job on request. */
export default function GpuUsage({ cluster, snapshot }: GpuUsageProps): React.JSX.Element | null {
  const [gpus, setGpus] = useState<GpuSample[] | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sampling, setSampling] = useState<string | null>(null)
  const user = cluster.connection.username
  const running = snapshot.jobs.filter(
    (job) => job.state === 'RUNNING' && (job.user === undefined || job.user === user)
  )
  const nodelists = running.map((job) => job.reason)
  const nodesKey = nodelists.join(' ')
  const fromGrafana = Boolean(cluster.grafana?.gpuDatasourceUid)

  useEffect(() => {
    if (!fromGrafana || !nodesKey) return
    let cancelled = false
    window.api.grafana
      .gpuUsage(cluster.id, nodesKey.split(' '))
      .then((samples) => {
        if (cancelled) return
        setGpus(samples)
        setSource('DCGM metrics via Grafana')
        setError(null)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [cluster.id, fromGrafana, nodesKey, snapshot.fetchedAt])

  async function sample(jobId: string, nodes: number): Promise<void> {
    setSampling(jobId)
    setError(null)
    try {
      setGpus(await window.api.scheduler.sampleGpus(cluster.id, jobId, nodes))
      setSource(`nvidia-smi in job ${jobId}, ${new Date().toLocaleTimeString()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sample the GPUs.')
    } finally {
      setSampling(null)
    }
  }

  return (
    <>
      <div className="slurm-toolbar">
        <h3 className="slurm-subheading slurm-grow">GPUs</h3>
        {source && <span className="slurm-dim">{source}</span>}
      </div>
      <CapacitySummary snapshot={snapshot} />
      {running.length === 0 && (
        <p className="hint">You have no running jobs, so there is no per-job GPU usage to show.</p>
      )}
      {running.length > 0 && (
        <>
          {!fromGrafana && (
            <p className="hint">
              Set a GPU metrics datasource in the cluster&apos;s Grafana settings for live GPU
              usage, or sample a running job below.
            </p>
          )}
          {error && <div className="error-banner">{error}</div>}
          {gpus?.length === 0 && <p className="hint">No GPUs reported for these nodes.</p>}
          {gpus && gpus.length > 0 && (
            <div className="gpu-grid">
              {gpus.map((gpu) => (
                <div className="storage-card" key={`${gpu.host}-${gpu.gpu}`}>
                  <div className="storage-card-header">
                    <span className="slurm-mono">
                      {gpu.host} · GPU {gpu.gpu}
                    </span>
                    <span className="slurm-dim">
                      {gpu.temperatureC !== null ? `${Math.round(gpu.temperatureC)} °C` : ''}
                    </span>
                  </div>
                  {gpu.model && <span className="slurm-dim">{gpu.model}</span>}
                  <Bar label="Utilization" value={gpu.utilizationPct} max={100} format={percent} />
                  <Bar
                    label="Memory"
                    value={gpu.memoryUsedMiB}
                    max={gpu.memoryTotalMiB}
                    format={gib}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="gpu-sample">
            <span className="slurm-dim">Sample with nvidia-smi:</span>
            {running.slice(0, 6).map((job) => (
              <button
                key={job.id}
                className="btn btn-sm"
                disabled={sampling !== null}
                onClick={() => void sample(job.id, job.nodes)}
                title={`srun --overlap into job ${job.id} on ${job.reason}`}
              >
                <Cpu size={13} strokeWidth={2} />
                {sampling === job.id ? 'Sampling...' : job.id}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
