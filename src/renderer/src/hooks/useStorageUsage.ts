import { useEffect, useRef, useState } from 'react'
import {
  MIN_STORAGE_INTERVAL_SEC,
  type ClusterSummary,
  type StorageUsage
} from '../../../shared/types'

// Caps how long a backed-off retry can grow to, relative to the configured interval - a cluster
// that's down shouldn't go completely silent, just slow down, the same principle as the
// reconnect backoff elsewhere (TerminalPanel.tsx) and SPEC.md's "no connection-attempt storms".
const MAX_BACKOFF_MULTIPLIER = 8

/** StorageSection's on-request check plus its optional auto-refresh poll-with-backoff loop,
 *  pulled out into a hook - pure code motion, same state/effect, no behavior change. */
export function useStorageUsage(
  cluster: ClusterSummary,
  extraPaths: string[] = []
): {
  usage: StorageUsage[] | null
  loading: boolean
  error: string | null
  checkedAt: Date | null
  check: () => Promise<boolean>
} {
  const [usage, setUsage] = useState<StorageUsage[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const consecutiveFailuresRef = useRef(0)
  const extraKey = extraPaths.join('\n')

  /** Resolves true on success - read by the auto-refresh loop below to back off on repeated
   *  failure instead of retrying a down cluster at the same steady cadence. */
  async function check(): Promise<boolean> {
    setLoading(true)
    setError(null)
    try {
      setUsage(await window.api.storage.usage(cluster.id, extraPaths))
      setCheckedAt(new Date())
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check storage usage.')
      return false
    } finally {
      setLoading(false)
    }
  }

  const autoRefresh = cluster.storage?.autoRefresh ?? false
  const intervalSec = Math.max(
    cluster.storage?.intervalSec ?? MIN_STORAGE_INTERVAL_SEC,
    MIN_STORAGE_INTERVAL_SEC
  )

  // Runs only while this section is mounted, which already means the cluster is selected and
  // Storage is visible - Status fully unmounts for a background cluster (see MainPanel.tsx), so
  // there's no separate "stop while backgrounded" case to handle here.
  useEffect(() => {
    if (!autoRefresh) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = (): void => {
      // A hidden window gets rechecked at the same cadence once visible again, rather than
      // firing a burst of catch-up requests - this is a "check less while unfocused", not a
      // "resume exactly on time", pause.
      if (document.hidden) {
        timer = setTimeout(tick, intervalSec * 1000)
        return
      }
      void check().then((ok) => {
        if (disposed) return
        consecutiveFailuresRef.current = ok ? 0 : consecutiveFailuresRef.current + 1
        const backoff = Math.min(2 ** consecutiveFailuresRef.current, MAX_BACKOFF_MULTIPLIER)
        timer = setTimeout(tick, intervalSec * 1000 * backoff)
      })
    }
    timer = setTimeout(tick, intervalSec * 1000)

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
    // `check` is a new function identity every render; depending on it would restart the timer
    // on every render instead of only when the cluster or its auto-refresh settings actually
    // change. It only closes over `cluster.id` and the setters above, neither of which need
    // their own entry here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id, autoRefresh, intervalSec, extraKey])

  return { usage, loading, error, checkedAt, check }
}
