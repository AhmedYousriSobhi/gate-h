import { useEffect, useState } from 'react'
import type { ClusterSummary, GrafanaStatusResult } from '../../../../shared/types'

interface GrafanaStatusSectionProps {
  cluster: ClusterSummary
}

export default function GrafanaStatusSection({
  cluster
}: GrafanaStatusSectionProps): React.JSX.Element {
  const [status, setStatus] = useState<GrafanaStatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.api.grafana
      .getStatus(cluster.id)
      .then((result) => {
        if (!cancelled) setStatus(result)
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

  if (!cluster.grafana) {
    return <p className="hint">No Grafana instance configured for this cluster.</p>
  }

  if (loading) return <p className="hint">Loading Grafana status...</p>
  if (error) return <div className="error-banner">{error}</div>
  if (!status) return <></>

  return (
    <div className="status-section">
      <div className={`health-badge ${status.health.ok ? 'health-ok' : 'health-down'}`}>
        {status.health.ok
          ? `Grafana reachable (v${status.health.version ?? '?'})`
          : `Grafana unreachable: ${status.health.message}`}
      </div>
      <div className="dashboard-grid">
        {status.dashboards.map((dashboard) => (
          <div className="dashboard-card" key={dashboard.uid}>
            <h4>{dashboard.title}</h4>
            {dashboard.error ? (
              <p className="hint">Could not load: {dashboard.error}</p>
            ) : (
              <>
                {dashboard.snapshotDataUrl ? (
                  <img src={dashboard.snapshotDataUrl} alt={`${dashboard.title} snapshot`} />
                ) : (
                  <p className="hint">
                    {dashboard.panelCount} panel{dashboard.panelCount === 1 ? '' : 's'} - snapshot
                    unavailable (grafana-image-renderer plugin not detected)
                  </p>
                )}
                {dashboard.url && (
                  <a href={dashboard.url} target="_blank" rel="noreferrer">
                    Open in Grafana
                  </a>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
