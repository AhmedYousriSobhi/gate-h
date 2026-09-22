import { session } from 'electron'
import { GRAFANA_EMBED_PARTITION } from '../../shared/types'

// Lets a <webview> in the status panel render a cluster's Grafana dashboard/panel pages live,
// without needing the grafana-image-renderer plugin - many target Grafana servers are ones Gate-H
// doesn't control, so depending on a server-side plugin being installed isn't an option. Instead:
//  - the cluster's own service-account token (the same one client.ts already uses for the API) is
//    injected as a Bearer Authorization header on requests to that Grafana origin, since Grafana
//    accepts that header for page routes the same way it does for the API
//  - the X-Frame-Options/CSP headers Grafana sends by default (which would otherwise stop the page
//    from rendering inside our webview at all) are stripped for those same origins
// Scoped to a dedicated session partition, and only for origins explicitly registered below - never
// touches any other request, in this partition or otherwise.

const originTokens = new Map<string, string>()

/** Arms the embed session for one cluster's Grafana origin - call (and await the IPC round trip)
 *  before pointing a <webview> at it. */
export function registerEmbedOrigin(baseUrl: string, token: string): void {
  originTokens.set(new URL(baseUrl).origin, token)
}

function deleteHeaderCaseInsensitive(headers: Record<string, string[]>, name: string): void {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  if (key) delete headers[key]
}

export function setupGrafanaEmbedSession(): void {
  const ses = session.fromPartition(GRAFANA_EMBED_PARTITION)

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const token = originTokens.get(new URL(details.url).origin)
    if (token) details.requestHeaders['Authorization'] = `Bearer ${token}`
    callback({ requestHeaders: details.requestHeaders })
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    const isRegistered = originTokens.has(new URL(details.url).origin)
    if (!isRegistered || !details.responseHeaders) {
      callback({})
      return
    }
    const headers = { ...details.responseHeaders }
    deleteHeaderCaseInsensitive(headers, 'x-frame-options')
    deleteHeaderCaseInsensitive(headers, 'content-security-policy')
    callback({ responseHeaders: headers })
  })
}
