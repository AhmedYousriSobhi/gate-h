import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import type { ClusterSummary, GpuSample, SchedulerSnapshot } from '../../../../shared/types'

interface GpuUsageProps {
  cluster: ClusterSummary
  snapshot: SchedulerSnapshot
}

function Bar({
  label,
  value,
  max,
  unit
}: {
  label: string
  value: number | null
  max: number | null
  unit: string
}): React.JSX.Element {
  const fraction = value !== null && max ? Math.min(value / max, 1) : 0
  return (
    <div className="storage-meter">
      <div className="storage-meter-label">
        <span>{label}</span>
        <span className="slurm-mono">
          {value === null ? 'n/a' : `${Math.round(value).toLocaleString()}${unit}`}
          {value !== null && max && unit !== '%'
            ? ` / ${Math.round(max).toLocaleString()}${unit}`
            : ''}
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

  if (running.length === 0) return null

  return (
    <>
      <div className="slurm-toolbar">
        <h3 className="slurm-subheading slurm-grow">GPUs</h3>
        {source && <span className="slurm-dim">{source}</span>}
      </div>
      {!fromGrafana && (
        <p className="hint">
          Set a GPU metrics datasource in the cluster&apos;s Grafana settings for live GPU usage, or
          sample a running job below.
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
              <Bar label="Utilization" value={gpu.utilizationPct} max={100} unit="%" />
              <Bar label="Memory" value={gpu.memoryUsedMiB} max={gpu.memoryTotalMiB} unit=" MiB" />
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
  )
}
