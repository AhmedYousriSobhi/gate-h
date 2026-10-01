import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  MIN_STORAGE_INTERVAL_SEC,
  type ClusterSummary,
  type StorageUsage
} from '../../../../shared/types'

// Caps how long a backed-off retry can grow to, relative to the configured interval - a cluster
// that's down shouldn't go completely silent, just slow down, the same principle as the
// reconnect backoff elsewhere (TerminalPanel.tsx) and SPEC.md's "no connection-attempt storms".
const MAX_BACKOFF_MULTIPLIER = 8

function size(kib: number): string {
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = kib
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function Meter({
  label,
  used,
  total,
  soft = null
}: {
  label: string
  used: number
  total: number | null
  /** A quota's soft limit: going over it starts the grace period, so it's flagged too. */
  soft?: number | null
}): React.JSX.Element {
  const fraction = total ? Math.min(used / total, 1) : 0
  const overSoft = soft !== null && used >= soft
  const level =
    fraction >= 0.95 ? 'storage-full' : fraction >= 0.8 || overSoft ? 'storage-high' : ''
  return (
    <div className="storage-meter">
      <div className="storage-meter-label">
        <span>{label}</span>
        <span className="slurm-mono">
          {size(used)}
          {total ? ` of ${size(total)} (${Math.round(fraction * 100)}%)` : ' - no limit'}
          {overSoft && ` - over the ${size(soft)} soft limit`}
        </span>
      </div>
      {total !== null && (
        <div className="storage-bar">
          <div className={`storage-bar-fill ${level}`} style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  )
}

/** Usage and quota for the cluster's configured paths - run on request, since quota tools hit the
 *  filesystem's metadata servers and nothing here changes minute to minute. */
export default function StorageSection({
  cluster
}: {
  cluster: ClusterSummary
}): React.JSX.Element {
  const [usage, setUsage] = useState<StorageUsage[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const consecutiveFailuresRef = useRef(0)

  /** Resolves true on success - read by the auto-refresh loop below to back off on repeated
   *  failure instead of retrying a down cluster at the same steady cadence. */
  async function check(): Promise<boolean> {
    setLoading(true)
    setError(null)
    try {
      setUsage(await window.api.storage.usage(cluster.id))
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
  }, [cluster.id, autoRefresh, intervalSec])

  if (!cluster.storage) {
    return <p className="hint">No storage paths configured. Edit the cluster to add some.</p>
  }

  return (
    <div className="status-section">
      <div className="slurm-toolbar">
        <span className="slurm-dim slurm-grow">
          {checkedAt
            ? `Checked at ${checkedAt.toLocaleTimeString()}`
            : cluster.storage.paths.join(', ')}
          {autoRefresh && ` · auto-refreshing every ${intervalSec}s`}
        </span>
        <button className="btn btn-sm" disabled={loading} onClick={() => void check()}>
          <RefreshCw size={13} strokeWidth={2} className={loading ? 'slurm-spin' : ''} />
          {usage ? 'Check again' : 'Check usage'}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {usage?.length === 0 && <p className="hint">The cluster returned no usage information.</p>}
      {usage?.map((entry) => (
        <div className="storage-card" key={entry.path}>
          <div className="storage-card-header">
            <span className="slurm-mono">{entry.path}</span>
            <span className="issue-status issue-status-todo">{entry.fsType}</span>
          </div>
          {entry.quota && (
            <Meter
              label={`Your quota (${entry.quota.source === 'lfs' ? 'lfs quota' : 'mmlsquota'})`}
              used={entry.quota.usedKiB}
              total={entry.quota.hardKiB ?? entry.quota.softKiB}
              soft={entry.quota.hardKiB ? entry.quota.softKiB : null}
            />
          )}
          {entry.quota?.files !== null && entry.quota?.files !== undefined && (
            <div className="storage-meter-label slurm-dim">
              <span>Files</span>
              <span className="slurm-mono">
                {entry.quota.files.toLocaleString()}
                {entry.quota.filesHard ? ` of ${entry.quota.filesHard.toLocaleString()}` : ''}
              </span>
            </div>
          )}
          {entry.filesystem && (
            <Meter
              label="Whole filesystem (shared)"
              used={entry.filesystem.usedKiB}
              total={entry.filesystem.sizeKiB}
            />
          )}
          {entry.error && <p className="slurm-error">{entry.error}</p>}
        </div>
      ))}
    </div>
  )
}
