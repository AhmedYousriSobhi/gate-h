import { useEffect, useMemo, useState } from 'react'
import type { ClusterSummary } from '../../../shared/types'

const REFRESH_MS = 5 * 60_000

/** Unresolved Jira tickets per cluster, for the Overview. Standby clusters are skipped (no
 *  background traffic for them), and a failed lookup just leaves that cluster without a number. */
export function useJiraOpenCounts(clusters: ClusterSummary[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const idsKey = useMemo(
    () =>
      clusters
        .filter((c) => c.jira && c.activeMonitoring)
        .map((c) => c.id)
        .join(','),
    [clusters]
  )

  useEffect(() => {
    if (!idsKey) return
    const ids = idsKey.split(',')
    let cancelled = false

    const load = (): void => {
      if (document.hidden) return
      for (const id of ids) {
        window.api.jira
          .openCount(id)
          .then((count) => {
            if (!cancelled) setCounts((prev) => ({ ...prev, [id]: count }))
          })
          .catch(() => {})
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [idsKey])

  return counts
}
