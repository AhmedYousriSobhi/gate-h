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
      embedHeight
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
        embedHeight: profile.panelEmbedHeight?.[uid]
      })
    )
  )
  return { health, dashboards }
}
