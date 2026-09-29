import type { GrafanaStatusResult } from '../../../../shared/types'

// Switching clusters unmounts the Status widget of the one left behind (so a background cluster
// runs no Grafana polling or embeds - SPEC §3.6), which throws away its fetched state. This keeps
// just that small, serializable state per cluster - the approach VS Code recommends over keeping
// hidden webviews alive (getState/setState rather than retainContextWhenHidden) - so coming back
// renders immediately from the last result while a fresh one loads (stale-while-revalidate),
// instead of a "Loading..." placeholder first. The live panel embeds themselves still reload:
// keeping those alive is what costs the memory.

/** More clusters than anyone switches between; the oldest entry goes first past this. */
const MAX_ENTRIES = 16

interface Entry {
  /** A cached status is only valid for the Grafana instance it came from. */
  baseUrl: string
  status: GrafanaStatusResult
}

const statuses = new Map<string, Entry>()
const scrollTops = new Map<string, number>()
const armedEmbeds = new Set<string>()

function touch<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string)
}

export function cachedStatus(clusterId: string, baseUrl: string): GrafanaStatusResult | null {
  const entry = statuses.get(clusterId)
  return entry && entry.baseUrl === baseUrl ? entry.status : null
}

export function rememberStatus(
  clusterId: string,
  baseUrl: string,
  status: GrafanaStatusResult
): void {
  touch(statuses, clusterId, { baseUrl, status })
}

/** The embed session is armed in the main process and stays armed; `key` is cluster id plus its
 *  config version, so an edited cluster (a new token) is armed again before embedding. */
export function isEmbedArmed(key: string): boolean {
  return armedEmbeds.has(key)
}

export function markEmbedArmed(key: string): void {
  armedEmbeds.add(key)
}

export function savedScrollTop(clusterId: string): number {
  return scrollTops.get(clusterId) ?? 0
}

export function saveScrollTop(clusterId: string, top: number): void {
  touch(scrollTops, clusterId, top)
}
