import { useEffect, useState } from 'react'
import { CircleCheck, CircleX, ExternalLink, SlidersHorizontal } from 'lucide-react'
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
  const [pickerUid, setPickerUid] = useState<string | null>(null)

  function togglePanel(dashboardUid: string, panelId: number, current: number[]): void {
    const next = current.includes(panelId)
      ? current.filter((id) => id !== panelId)
      : [...current, panelId]
    window.api.grafana
      .setPanelSelection(cluster.id, dashboardUid, next)
      .then(() => window.api.grafana.getStatus(cluster.id))
      .then(setStatus)
      .catch((err: Error) => setError(err.message))
  }

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
    // Re-fetch whenever this cluster's saved config changes (e.g. a new Grafana token), not just
    // when a different cluster is selected - `cluster.id` alone doesn't change on edit.
  }, [cluster.id, cluster.updatedAt])

  if (!cluster.grafana) {
    return <p className="hint">No Grafana instance configured for this cluster.</p>
  }

  if (loading) return <p className="hint">Loading Grafana status...</p>
  if (error) return <div className="error-banner">{error}</div>
  if (!status) return <></>

  return (
    <div className="status-section">
      <div className={`health-badge ${status.health.ok ? 'health-ok' : 'health-down'}`}>
        {status.health.ok ? (
          <CircleCheck size={14} strokeWidth={2} />
        ) : (
          <CircleX size={14} strokeWidth={2} />
        )}
        {status.health.ok
          ? `Grafana reachable (v${status.health.version ?? '?'})`
          : `Grafana unreachable: ${status.health.message}`}
      </div>
      <div className="dashboard-grid">
        {status.dashboards.map((dashboard) => (
          <div className="dashboard-card" key={dashboard.uid}>
            <div className="dashboard-card-header">
              <h4>{dashboard.title}</h4>
              {!dashboard.error && dashboard.panels.length > 0 && (
                <button
                  className={`btn-icon${pickerUid === dashboard.uid ? ' btn-icon-active' : ''}`}
                  title="Choose panels"
                  onClick={() =>
                    setPickerUid((uid) => (uid === dashboard.uid ? null : dashboard.uid))
                  }
                >
                  <SlidersHorizontal size={13} strokeWidth={2} />
                </button>
              )}
            </div>
            {dashboard.error ? (
              <p className="hint">Could not load: {dashboard.error}</p>
            ) : (
              <>
                {pickerUid === dashboard.uid && (
                  <div className="panel-picker">
                    {dashboard.panels.map((panel) => (
                      <label key={panel.id} className="panel-picker-item">
                        <input
                          type="checkbox"
                          checked={dashboard.selectedPanelIds.includes(panel.id)}
                          onChange={() =>
                            togglePanel(dashboard.uid, panel.id, dashboard.selectedPanelIds)
                          }
                        />
                        {panel.title}
                      </label>
                    ))}
                  </div>
                )}
                {dashboard.snapshots.length === 0 && (
                  <p className="hint">No panels selected - pick some above.</p>
                )}
                {dashboard.snapshots.map((snapshot) =>
                  snapshot.dataUrl ? (
                    <figure className="panel-snapshot" key={snapshot.id}>
                      <img src={snapshot.dataUrl} alt={`${snapshot.title} snapshot`} />
                      <figcaption>{snapshot.title}</figcaption>
                    </figure>
                  ) : (
                    <p className="hint" key={snapshot.id}>
                      {snapshot.title}: snapshot unavailable (grafana-image-renderer plugin not
                      detected)
                    </p>
                  )
                )}
                {dashboard.url && (
                  <a href={dashboard.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} strokeWidth={2} />
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
