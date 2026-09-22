import { useEffect, useRef, useState } from 'react'
import {
  CircleCheck,
  CircleX,
  Columns2,
  ExternalLink,
  Rows2,
  SlidersHorizontal
} from 'lucide-react'
import {
  GRAFANA_EMBED_PARTITION,
  MAX_PANEL_EMBED_HEIGHT,
  MIN_PANEL_EMBED_HEIGHT,
  type ClusterReachability,
  type ClusterSummary,
  type GrafanaStatusResult,
  type PanelOrientation
} from '../../../../shared/types'

interface GrafanaStatusSectionProps {
  cluster: ClusterSummary
  /** This cluster's live reachability reading - when its `status` value flips to 'online', an
   *  immediate status refresh is triggered (on top of the regular poll interval below) and the
   *  failure-backoff state resets, the same recovery TerminalPanel reacts to. */
  reachability?: ClusterReachability
}

// How often to re-fetch dashboard/panel status in the background, matching the reachability
// sweep's cadence (src/main/monitor/clusterMonitor.ts) so both stay in step. On repeated failures
// the interval backs off exponentially, capped at GRAFANA_MAX_REFRESH_BACKOFF_MS, so a Grafana
// instance that's actually down doesn't get polled every tick.
const GRAFANA_REFRESH_INTERVAL_MS = 60_000
const GRAFANA_MAX_REFRESH_BACKOFF_MS = 5 * 60_000

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// Grafana's own per-panel "..." menu button never actually opens a menu in this embedded context
// (confirmed via direct devtools inspection - the click reaches the real button with no errors,
// but no menu populates) - a control that looks clickable but silently does nothing is worse than
// none at all, so hide it once the guest page has loaded. Verified selector, not a guess.
function hidePanelMenu(el: HTMLElement | null): void {
  if (!el) return
  const webview = el as Electron.WebviewTag
  const onDomReady = (): void => {
    webview.insertCSS('[data-testid*="Panel menu"] { display: none !important; }')
    webview.removeEventListener('dom-ready', onDomReady)
  }
  webview.addEventListener('dom-ready', onDomReady)
}

export default function GrafanaStatusSection({
  cluster,
  reachability
}: GrafanaStatusSectionProps): React.JSX.Element {
  const [status, setStatus] = useState<GrafanaStatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const hasLoadedOnceRef = useRef(false)
  const consecutiveFailuresRef = useRef(0)
  const [pickerUid, setPickerUid] = useState<string | null>(null)
  // Panels can't be embedded until the main process has armed the embed session (Authorization
  // header + frame-blocking header stripping) for this cluster's Grafana origin - see
  // grafana:prepareEmbed / grafana/embed.ts.
  const [embedReady, setEmbedReady] = useState(false)

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

  function setOrientation(dashboardUid: string, orientation: PanelOrientation): void {
    window.api.grafana
      .setDashboardOrientation(cluster.id, dashboardUid, orientation)
      .then(() => window.api.grafana.getStatus(cluster.id))
      .then(setStatus)
      .catch((err: Error) => setError(err.message))
  }

  // Drag-resize for a dashboard's embedded panel height - local state while dragging (cheap,
  // avoids an IPC/DB write per pointermove), committed via setPanelEmbedHeight on release, same
  // two-phase pattern as MainPanel's Terminal/Status split.
  const [dragHeight, setDragHeight] = useState<{ uid: string; height: number } | null>(null)
  const dragStartRef = useRef<{ uid: string; startY: number; startHeight: number } | null>(null)

  function handleResizeStart(
    e: React.PointerEvent<HTMLDivElement>,
    uid: string,
    currentHeight: number
  ): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartRef.current = { uid, startY: e.clientY, startHeight: currentHeight }
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>): void {
    const start = dragStartRef.current
    if (!start || e.buttons !== 1) return
    const height = Math.min(
      MAX_PANEL_EMBED_HEIGHT,
      Math.max(MIN_PANEL_EMBED_HEIGHT, start.startHeight + (e.clientY - start.startY))
    )
    setDragHeight({ uid: start.uid, height })
  }

  function handleResizeEnd(): void {
    const start = dragStartRef.current
    dragStartRef.current = null
    if (!start || dragHeight?.uid !== start.uid) return
    window.api.grafana
      .setPanelEmbedHeight(cluster.id, start.uid, dragHeight.height)
      .then(() => window.api.grafana.getStatus(cluster.id))
      .then(setStatus)
      .catch((err: Error) => setError(err.message))
    setDragHeight(null)
  }

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    consecutiveFailuresRef.current = 0

    function scheduleNext(delay: number): void {
      if (!cancelled) timer = setTimeout(runFetch, delay)
    }

    function runFetch(): void {
      window.api.grafana
        .getStatus(cluster.id)
        .then((result) => {
          if (cancelled) return
          consecutiveFailuresRef.current = 0
          setStatus(result)
          setError(null)
          scheduleNext(GRAFANA_REFRESH_INTERVAL_MS)
        })
        .catch((err: Error) => {
          if (cancelled) return
          setError(err.message)
          consecutiveFailuresRef.current += 1
          const backoff = Math.min(
            GRAFANA_REFRESH_INTERVAL_MS * 2 ** consecutiveFailuresRef.current,
            GRAFANA_MAX_REFRESH_BACKOFF_MS
          )
          scheduleNext(backoff)
        })
        .finally(() => {
          if (cancelled) return
          setLoading(false)
          hasLoadedOnceRef.current = true
        })
    }

    // Only show the "Loading..." placeholder on the very first fetch - a background refresh
    // (interval tick or reconnect signal) shouldn't blank out already-rendered dashboards.
    if (!hasLoadedOnceRef.current) setLoading(true)
    runFetch()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // Re-fetches whenever this cluster's saved config changes (e.g. a new Grafana token), not
    // just when a different cluster is selected - `cluster.id` alone doesn't change on edit -
    // and whenever this cluster's reachability status value changes (e.g. recovers), resetting
    // the backoff state above.
  }, [cluster.id, cluster.updatedAt, reachability?.status])

  useEffect(() => {
    if (!cluster.grafana) return
    window.api.grafana
      .prepareEmbed(cluster.id)
      .then(() => setEmbedReady(true))
      .catch((err: Error) => setError(err.message))
  }, [cluster.id, cluster.updatedAt, cluster.grafana])

  if (!cluster.grafana) {
    return <p className="hint">No Grafana instance configured for this cluster.</p>
  }

  if (loading) return <p className="hint">Loading Grafana status...</p>
  if (error) return <div className="error-banner">{error}</div>
  if (!status) return <></>

  const grafanaBaseUrl = trimBaseUrl(cluster.grafana.baseUrl)

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
              <div className="dashboard-card-actions">
                {!dashboard.error && dashboard.selectedPanelIds.length > 1 && (
                  <>
                    <button
                      className={`btn-icon${dashboard.orientation === 'horizontal' ? ' btn-icon-active' : ''}`}
                      title="Side by side"
                      onClick={() => setOrientation(dashboard.uid, 'horizontal')}
                    >
                      <Columns2 size={13} strokeWidth={2} />
                    </button>
                    <button
                      className={`btn-icon${dashboard.orientation === 'vertical' ? ' btn-icon-active' : ''}`}
                      title="Stacked"
                      onClick={() => setOrientation(dashboard.uid, 'vertical')}
                    >
                      <Rows2 size={13} strokeWidth={2} />
                    </button>
                  </>
                )}
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
                {dashboard.selectedPanelIds.length === 0 && (
                  <p className="hint">No panels selected - pick some above.</p>
                )}
                {!embedReady && dashboard.selectedPanelIds.length > 0 && (
                  <p className="hint">Preparing panel embed...</p>
                )}
                {embedReady && dashboard.selectedPanelIds.length > 0 && (
                  <>
                    <div className={`panel-embed-list panel-embed-list-${dashboard.orientation}`}>
                      {dashboard.selectedPanelIds.map((panelId) => {
                        const panelTitle =
                          dashboard.panels.find((p) => p.id === panelId)?.title ?? String(panelId)
                        const embedUrl = `${grafanaBaseUrl}/d-solo/${dashboard.uid}?orgId=1&panelId=${panelId}&theme=dark&kiosk`
                        const height =
                          dragHeight?.uid === dashboard.uid
                            ? dragHeight.height
                            : dashboard.embedHeight
                        return (
                          <figure className="panel-embed" key={panelId}>
                            <webview
                              ref={hidePanelMenu}
                              src={embedUrl}
                              partition={GRAFANA_EMBED_PARTITION}
                              allowpopups
                              style={{ height }}
                            />
                            <figcaption>{panelTitle}</figcaption>
                          </figure>
                        )
                      })}
                    </div>
                    <div
                      className="panel-embed-resizer"
                      onPointerDown={(e) =>
                        handleResizeStart(e, dashboard.uid, dashboard.embedHeight)
                      }
                      onPointerMove={handleResizeMove}
                      onPointerUp={handleResizeEnd}
                    />
                  </>
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
