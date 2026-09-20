import type {
  GrafanaDashboardStatus,
  GrafanaHealth,
  GrafanaProfile,
  GrafanaStatusResult
} from '../../shared/types'

// Talks to a cluster's Grafana instance over its HTTP API using a service-account token.
// Dashboard "snapshots" are fetched as pre-rendered PNGs via Grafana's render endpoint (needs the
// grafana-image-renderer plugin on the Grafana side) rather than parsing per-datasource queries -
// this keeps H-Gate genuinely datasource-agnostic: it works the same whether a cluster's Grafana
// is backed by Prometheus, InfluxDB, or anything else, at the cost of a static (non-live) image.
// When the renderer plugin isn't installed, we fall back to just the dashboard title/link.

function trimBaseUrl(baseUrl: string): string {
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

async function fetchPanelSnapshot(
  baseUrl: string,
  token: string,
  uid: string,
  panelId: number
): Promise<string | null> {
  try {
    const res = await grafanaFetch(
      baseUrl,
      token,
      `/render/d-solo/${uid}?orgId=1&panelId=${panelId}&width=480&height=240&tz=UTC`
    )
    if (!res.ok || !res.headers.get('content-type')?.includes('image')) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    // Image renderer plugin is likely not installed on this Grafana instance - non-fatal.
    return null
  }
}

async function getDashboardStatus(
  baseUrl: string,
  token: string,
  uid: string
): Promise<GrafanaDashboardStatus> {
  try {
    const res = await grafanaFetch(baseUrl, token, `/api/dashboards/uid/${uid}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as DashboardApiResponse
    const panels = data.dashboard?.panels ?? []
    const title = data.dashboard?.title ?? uid
    const url = `${trimBaseUrl(baseUrl)}${data.meta?.url ?? `/d/${uid}`}`
    const firstPanel = panels[0]
    const snapshotDataUrl = firstPanel
      ? await fetchPanelSnapshot(baseUrl, token, uid, firstPanel.id)
      : null

    return { uid, title, url, panelCount: panels.length, snapshotDataUrl }
  } catch (err) {
    return {
      uid,
      title: uid,
      url: '',
      panelCount: 0,
      snapshotDataUrl: null,
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
    profile.dashboardUids.map((uid) => getDashboardStatus(profile.baseUrl, token, uid))
  )
  return { health, dashboards }
}
