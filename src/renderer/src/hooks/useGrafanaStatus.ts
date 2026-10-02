import { useEffect, useRef, useState } from 'react'
import type {
  ClusterReachability,
  ClusterSummary,
  GrafanaStatusResult
} from '../../../shared/types'
import { cachedStatus, rememberStatus } from '../features/status/statusCache'

// How often to re-fetch dashboard/panel status in the background, matching the reachability
// sweep's cadence (src/main/monitor/clusterMonitor.ts) so both stay in step. On repeated failures
// the interval backs off exponentially, capped at GRAFANA_MAX_REFRESH_BACKOFF_MS, so a Grafana
// instance that's actually down doesn't get polled every tick.
const GRAFANA_REFRESH_INTERVAL_MS = 60_000
const GRAFANA_MAX_REFRESH_BACKOFF_MS = 5 * 60_000

/** GrafanaStatusSection's poll-with-backoff loop, pulled out into a hook - pure code motion, same
 *  effect/state, no behavior change. Lets the component stay focused on panel selection/embedding/
 *  drag-resize instead of also owning the fetch loop. `setStatus`/`setError` are still exposed so
 *  the component's own mutate-then-refetch actions (toggling a panel, resizing, ...) can push a
 *  fresh result in immediately, the same way they already did. */
export function useGrafanaStatus(
  cluster: ClusterSummary,
  baseUrl: string,
  reachability?: ClusterReachability
): {
  status: GrafanaStatusResult | null
  setStatus: (result: GrafanaStatusResult) => void
  error: string | null
  setError: (message: string | null) => void
  loading: boolean
} {
  const [status, setStatusState] = useState<GrafanaStatusResult | null>(() =>
    cachedStatus(cluster.id, baseUrl)
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => cachedStatus(cluster.id, baseUrl) === null)
  const hasLoadedOnceRef = useRef(!loading)
  const consecutiveFailuresRef = useRef(0)

  function setStatus(result: GrafanaStatusResult): void {
    rememberStatus(cluster.id, baseUrl, result)
    setStatusState(result)
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
          rememberStatus(cluster.id, baseUrl, result)
          setStatusState(result)
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
  }, [cluster.id, cluster.updatedAt, reachability?.status, baseUrl])

  return { status, setStatus, error, setError, loading }
}
