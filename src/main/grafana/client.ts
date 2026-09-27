import {
  DEFAULT_PANEL_EMBED_HEIGHT,
  type GrafanaDashboardStatus,
  type GrafanaHealth,
  type GrafanaProfile,
  type GrafanaStatusResult,
  type PanelOrientation
} from '../../shared/types'

// Talks to a cluster's Grafana instance over its HTTP API using a service-account token, to list
// dashboards/panels and check reachability. Actually *displaying* a panel is handled separately
// (see grafana/embed.ts) by embedding Grafana's own live dashboard page in a <webview> - many
// target Grafana servers are ones Gate-H has no control over, so depending on a server-side plugin
// (grafana-image-renderer, for pre-rendered snapshot images) isn't an option.

export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function grafanaFetch(baseUrl: string, token: string, path: string): Promise<Response> {
  return fetch(`${trimBaseUrl(baseUrl)}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
}

export async function checkGrafanaHealth(baseUrl: string, token: string): Promise<GrafanaHealth> {
  try {
    const res = await grafanaFetch(baseUrl, token, '/api/health')
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    const data = (await res.json()) as { version?: string }
    return { ok: true, version: data.version }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' }
  }
}

interface DashboardApiResponse {
  dashboard?: { title?: string; panels?: Array<{ id: number; title?: string }> }
  meta?: { url?: string }
}

interface DashboardLayoutPrefs {
  selectedPanelIds: number[] | undefined
  orientation: PanelOrientation | undefined
  embedHeight: number | undefined
  panelWidths: Record<number, number> | undefined
}

/** Normalizes a dashboard's saved per-panel width shares against its *current* selection: only
 *  used when every currently-selected panel has a saved (positive) share, in which case those
 *  shares are rescaled to sum to 1. Otherwise (nothing saved yet, or a panel was added/removed
 *  since the last save and the saved keys no longer line up) falls back to an equal split rather
 *  than guessing at a share for a panel that was never dragged - self-heals instead of carrying
 *  stale/partial data forward. */
export function normalizePanelWidths(
  selectedIds: number[],
  saved: Record<number, number> | undefined
): Record<number, number> {
  if (selectedIds.length === 0) return {}

  const allKnown = selectedIds.every((id) => (saved?.[id] ?? 0) > 0)
  if (allKnown) {
    const total = selectedIds.reduce((sum, id) => sum + saved![id], 0)
    return Object.fromEntries(selectedIds.map((id) => [id, saved![id] / total]))
  }

  const equalShare = 1 / selectedIds.length
  return Object.fromEntries(selectedIds.map((id) => [id, equalShare]))
}

async function getDashboardStatus(
  baseUrl: string,
  token: string,
  uid: string,
  prefs: DashboardLayoutPrefs
): Promise<GrafanaDashboardStatus> {
  const orientation = prefs.orientation ?? 'vertical'
  const embedHeight = prefs.embedHeight ?? DEFAULT_PANEL_EMBED_HEIGHT
  try {
    const res = await grafanaFetch(baseUrl, token, `/api/dashboards/uid/${uid}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as DashboardApiResponse
    const panels = data.dashboard?.panels ?? []
    const title = data.dashboard?.title ?? uid
    const url = `${trimBaseUrl(baseUrl)}${data.meta?.url ?? `/d/${uid}`}`

    // No selection saved yet (or it no longer matches any panel on the dashboard) - default to
    // just the first panel, same as before panel selection existed.
    const requested = prefs.selectedPanelIds?.filter((id) => panels.some((p) => p.id === id)) ?? []
    const effectiveIds = requested.length > 0 ? requested : panels.slice(0, 1).map((p) => p.id)

    return {
      uid,
      title,
      url,
      panels: panels.map((p) => ({ id: p.id, title: p.title ?? String(p.id) })),
      selectedPanelIds: effectiveIds,
      orientation,
      embedHeight,
      panelWidths: normalizePanelWidths(effectiveIds, prefs.panelWidths)
    }
  } catch (err) {
    return {
      uid,
      title: uid,
      url: '',
      panels: [],
      selectedPanelIds: [],
      orientation,
      embedHeight,
      panelWidths: {},
      error: err instanceof Error ? err.message : 'Unknown error'
    }
  }
}

export async function getGrafanaStatus(
  profile: GrafanaProfile,
  token: string
): Promise<GrafanaStatusResult> {
  const health = await checkGrafanaHealth(profile.baseUrl, token)
  const dashboards = await Promise.all(
    profile.dashboardUids.map((uid) =>
      getDashboardStatus(profile.baseUrl, token, uid, {
        selectedPanelIds: profile.panelSelections?.[uid],
        orientation: profile.panelOrientation?.[uid],
        embedHeight: profile.panelEmbedHeight?.[uid],
        panelWidths: profile.panelWidths?.[uid]
      })
    )
  )
  return { health, dashboards }
}
