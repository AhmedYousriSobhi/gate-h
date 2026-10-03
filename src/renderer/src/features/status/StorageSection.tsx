import { useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import {
  DEFAULT_STORAGE_INTERVAL_SEC,
  MIN_STORAGE_INTERVAL_SEC,
  STORAGE_PATH_PATTERN,
  type ClusterSummary,
  type StorageConfig
} from '../../../../shared/types'
import { useStorageUsage } from '../../hooks/useStorageUsage'

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

function storageKey(clusterId: string): string {
  return `gateh.storage.paths.${clusterId}`
}

function loadPaths(clusterId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(clusterId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

const INTERVALS = [
  { sec: 60, label: '1 min' },
  { sec: 300, label: '5 min' },
  { sec: 900, label: '15 min' },
  { sec: 3600, label: '1 hour' }
]

interface AutoSetting {
  enabled: boolean
  intervalSec: number
}

/** The panel's own choice wins; until one is made, the cluster's saved settings apply. */
function loadAuto(clusterId: string, config: StorageConfig | null | undefined): AutoSetting {
  const fallback = {
    enabled: config?.autoRefresh ?? false,
    // Snapped to an offered choice so the dropdown can show it.
    intervalSec: (
      INTERVALS.find(
        (i) =>
          i.sec >=
          Math.max(config?.intervalSec ?? DEFAULT_STORAGE_INTERVAL_SEC, MIN_STORAGE_INTERVAL_SEC)
      ) ?? INTERVALS[INTERVALS.length - 1]
    ).sec
  }
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(`gateh.storage.auto.${clusterId}`) ?? 'null'
    )
    if (raw && typeof raw === 'object') {
      const { enabled, intervalSec } = raw as Partial<AutoSetting>
      if (typeof enabled === 'boolean' && INTERVALS.some((i) => i.sec === intervalSec)) {
        return { enabled, intervalSec: intervalSec as number }
      }
    }
  } catch {
    // Fall through to the cluster's settings.
  }
  return fallback
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
  const [extraPaths, setExtraPaths] = useState(() => loadPaths(cluster.id))
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [auto, setAuto] = useState(() => loadAuto(cluster.id, cluster.storage))
  const { usage, loading, error, checkedAt, check } = useStorageUsage(cluster, extraPaths, {
    enabled: auto.enabled,
    intervalSec: auto.intervalSec
  })
  const configured = cluster.storage?.paths ?? []
  const autoRefresh = auto.enabled
  const intervalSec = auto.intervalSec

  function saveAuto(next: AutoSetting): void {
    setAuto(next)
    try {
      localStorage.setItem(`gateh.storage.auto.${cluster.id}`, JSON.stringify(next))
    } catch {
      // Kept for this session only.
    }
  }

  function savePaths(next: string[]): void {
    setExtraPaths(next)
    try {
      localStorage.setItem(storageKey(cluster.id), JSON.stringify(next))
    } catch {
      // Kept for this session only.
    }
  }

  function addPath(e: React.FormEvent): void {
    e.preventDefault()
    const path = draft.trim()
    if (!path) return
    if (!STORAGE_PATH_PATTERN.test(path.replace(/\$(USER|HOME)/g, ''))) {
      setDraftError('Use letters, digits and _ . / ~ - only (plus $USER or $HOME).')
      return
    }
    setDraftError(null)
    if (!configured.includes(path) && !extraPaths.includes(path)) savePaths([...extraPaths, path])
    setDraft('')
  }

  return (
    <div className="status-section">
      <div className="slurm-toolbar">
        <span className="slurm-dim slurm-grow">
          {checkedAt
            ? `Checked at ${checkedAt.toLocaleTimeString()}`
            : [...configured, ...extraPaths].join(', ') || 'No paths yet'}
        </span>
        <label className="form-field-checkbox">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })}
          />
          Auto-recheck
        </label>
        <select
          className="slurm-user-filter"
          value={intervalSec}
          disabled={!autoRefresh}
          onChange={(e) => saveAuto({ ...auto, intervalSec: Number(e.target.value) })}
          aria-label="Auto-recheck interval"
        >
          {INTERVALS.map((i) => (
            <option key={i.sec} value={i.sec}>
              every {i.label}
            </option>
          ))}
        </select>
        <button
          className="btn btn-sm"
          disabled={loading || configured.length + extraPaths.length === 0}
          onClick={() => void check()}
        >
          <RefreshCw size={13} strokeWidth={2} className={loading ? 'slurm-spin' : ''} />
          {usage ? 'Check again' : 'Check usage'}
        </button>
      </div>
      <form className="issue-form" onSubmit={addPath}>
        <input
          placeholder="Add a path to check, e.g. /scratch/$USER"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Storage path to check"
        />
        <button type="submit" className="btn btn-sm">
          <Plus size={13} strokeWidth={2.5} />
          Add
        </button>
      </form>
      {draftError && <p className="slurm-error">{draftError}</p>}
      {extraPaths.length > 0 && (
        <div className="slurm-node-chips">
          {extraPaths.map((path) => (
            <span className="issue-status issue-status-todo slurm-mono" key={path}>
              {path}{' '}
              <button
                type="button"
                className="btn-icon"
                title={`Stop checking ${path}`}
                onClick={() => savePaths(extraPaths.filter((p) => p !== path))}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
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
