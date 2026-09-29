import { getCluster } from '../clusters'
import { NoSessionError, runOnCluster } from './exec'
import {
  arrayTasksCommand,
  classifyFailure,
  historyCommand,
  parseHistory,
  parseJobs,
  parseSnapshot,
  snapshotCommand
} from './slurm'
import {
  MIN_SCHEDULER_INTERVAL_SEC,
  type SchedulerConfig,
  type SchedulerSnapshot,
  type SlurmHistoryJob,
  type SlurmJob
} from '../../shared/types'

// Polls a cluster's Slurm queue only while the renderer is showing it: the Status widget's Slurm
// section watches the selected cluster and unwatches when it's hidden, backgrounded or put in
// standby, so background clusters never poll. slurmctld is shared by every user of the cluster,
// hence the interval floor, the failure backoff, and the slower cadence while the window is
// unfocused. Snapshots stay cached per cluster, so switching back shows the last one at once.

const MAX_BACKOFF_MS = 5 * 60_000
const UNFOCUSED_INTERVAL_MS = 5 * 60_000
const MANUAL_REFRESH_GAP_MS = 10_000
// Checking for a session is free (no command runs), so a waiting section can check often.
const WAITING_RECHECK_MS = 5_000

interface Watch {
  watchers: number
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  failures: number
  lastRunAt: number
}

const watches = new Map<string, Watch>()
// Keyed by cluster id; `configKey` drops a snapshot taken under settings since edited.
const cache = new Map<string, { configKey: string; snapshot: SchedulerSnapshot }>()
let broadcast: ((snapshot: SchedulerSnapshot) => void) | null = null
let windowFocused = true

export function setSchedulerBroadcaster(fn: (snapshot: SchedulerSnapshot) => void): void {
  broadcast = fn
}

function emptySnapshot(clusterId: string): SchedulerSnapshot {
  return {
    clusterId,
    status: 'waiting',
    fetchedAt: null,
    refreshing: false,
    jobs: [],
    truncated: false,
    partitions: [],
    nodeIssues: [],
    nextRefreshAt: null
  }
}

function cached(clusterId: string, config: SchedulerConfig): SchedulerSnapshot | null {
  const entry = cache.get(clusterId)
  return entry && entry.configKey === JSON.stringify(config) ? entry.snapshot : null
}

function publish(clusterId: string, config: SchedulerConfig, snapshot: SchedulerSnapshot): void {
  cache.set(clusterId, { configKey: JSON.stringify(config), snapshot })
  broadcast?.(snapshot)
}

function intervalMs(config: SchedulerConfig): number {
  return Math.max(config.intervalSec, MIN_SCHEDULER_INTERVAL_SEC) * 1000
}

/** When to poll next, or null for "only on request". */
function nextDelay(watch: Watch, config: SchedulerConfig, status: string): number | null {
  if (status === 'waiting') return WAITING_RECHECK_MS
  if (!config.autoRefresh) return null
  const base = windowFocused
    ? intervalMs(config)
    : Math.max(intervalMs(config), UNFOCUSED_INTERVAL_MS)
  return watch.failures ? Math.min(base * 2 ** watch.failures, MAX_BACKOFF_MS) : base
}

async function poll(clusterId: string): Promise<void> {
  const watch = watches.get(clusterId)
  if (!watch || watch.running) return
  if (watch.timer) clearTimeout(watch.timer)
  watch.timer = null
  const cluster = getCluster(clusterId)
  const config = cluster?.scheduler
  if (!cluster || !config || !cluster.activeMonitoring) return

  watch.running = true
  const previous = cached(clusterId, config) ?? emptySnapshot(clusterId)
  // A waiting section re-checks every few seconds; flashing "refreshing" each time would be noise.
  if (previous.status !== 'waiting') {
    publish(clusterId, config, { ...previous, refreshing: true, nextRefreshAt: null })
  }

  let next: SchedulerSnapshot
  try {
    const result = await runOnCluster(cluster, snapshotCommand(config))
    watch.lastRunAt = Date.now()
    if (result.exitCode === 0) {
      next = {
        ...previous,
        ...parseSnapshot(result.stdout, config.scope),
        status: 'ok',
        message: undefined,
        fetchedAt: new Date().toISOString()
      }
      watch.failures = 0
    } else {
      next = { ...previous, ...classifyFailure(result.exitCode, result.stderr) }
      watch.failures++
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof NoSessionError) {
      next = { ...previous, status: 'waiting', message }
    } else {
      watch.lastRunAt = Date.now()
      next = { ...previous, status: 'error', message }
      watch.failures++
    }
  }
  watch.running = false

  // Unwatched while the command ran: cache the result, but don't schedule another.
  const delay = watches.get(clusterId) === watch ? nextDelay(watch, config, next.status) : null
  next = {
    ...next,
    refreshing: false,
    nextRefreshAt: delay === null ? null : new Date(Date.now() + delay).toISOString()
  }
  publish(clusterId, config, next)
  if (delay !== null) watch.timer = setTimeout(() => void poll(clusterId), delay)
}

export function watchScheduler(clusterId: string): void {
  const config = getCluster(clusterId)?.scheduler
  if (!config) return
  const existing = watches.get(clusterId)
  if (existing) {
    existing.watchers++
    const snapshot = cached(clusterId, config)
    if (snapshot) broadcast?.(snapshot)
    return
  }
  const watch: Watch = { watchers: 1, timer: null, running: false, failures: 0, lastRunAt: 0 }
  watches.set(clusterId, watch)
  const snapshot = cached(clusterId, config)
  if (snapshot) broadcast?.(snapshot)
  // A cached snapshot with manual refresh stays as it is - on Teleport every run is an audited
  // session, so selecting a cluster again shouldn't cost one.
  const stale =
    !snapshot ||
    snapshot.status === 'waiting' ||
    (config.autoRefresh && Date.now() - Date.parse(snapshot.fetchedAt ?? '0') >= intervalMs(config))
  if (stale) void poll(clusterId)
  else if (config.autoRefresh) {
    const due = Date.parse(snapshot.fetchedAt ?? '0') + intervalMs(config) - Date.now()
    watch.timer = setTimeout(() => void poll(clusterId), Math.max(due, 0))
  }
}

export function unwatchScheduler(clusterId: string): void {
  const watch = watches.get(clusterId)
  if (!watch || --watch.watchers > 0) return
  if (watch.timer) clearTimeout(watch.timer)
  watches.delete(clusterId)
}

export function refreshScheduler(clusterId: string): void {
  const watch = watches.get(clusterId)
  if (!watch || Date.now() - watch.lastRunAt < MANUAL_REFRESH_GAP_MS) return
  void poll(clusterId)
}

/** Unfocused, polling slows to UNFOCUSED_INTERVAL_MS; on refocus, anything overdue for its
 *  normal interval refreshes once. */
export function setSchedulerWindowFocused(focused: boolean): void {
  windowFocused = focused
  if (!focused) return
  for (const [clusterId, watch] of watches) {
    const config = getCluster(clusterId)?.scheduler
    if (!config?.autoRefresh || watch.running) continue
    if (Date.now() - watch.lastRunAt >= intervalMs(config)) void poll(clusterId)
  }
}

// On-demand lookups - an array's tasks, the job history. Repeating one within 30s (expanding and
// collapsing a row, switching history ranges back and forth) reuses the last result rather than
// running again: on Teleport every run is an audited session. Keyed by cluster, kind and argument.
const ON_DEMAND_TTL_MS = 30_000
const onDemand = new Map<string, { at: number; result: Promise<unknown> }>()

function reuseRecent<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = onDemand.get(key)
  if (hit && Date.now() - hit.at < ON_DEMAND_TTL_MS) return hit.result as Promise<T>
  const result = run()
  onDemand.set(key, { at: Date.now(), result })
  // A failure isn't worth remembering - the next click should try again.
  result.catch(() => {
    if (onDemand.get(key)?.result === result) onDemand.delete(key)
  })
  return result
}

async function runOnDemand<T>(
  clusterId: string,
  command: (config: SchedulerConfig) => string,
  parse: (stdout: string, config: SchedulerConfig) => T
): Promise<T> {
  const cluster = getCluster(clusterId)
  const config = cluster?.scheduler
  if (!cluster || !config) throw new Error('This cluster has no scheduler configured.')
  if (!cluster.activeMonitoring) throw new Error('This cluster is in standby.')
  const result = await runOnCluster(cluster, command(config))
  if (result.exitCode !== 0) {
    throw new Error(classifyFailure(result.exitCode, result.stderr).message)
  }
  return parse(result.stdout, config)
}

export function fetchArrayTasks(clusterId: string, arrayJobId: string): Promise<SlurmJob[]> {
  return reuseRecent(`${clusterId}:array:${arrayJobId}`, () =>
    runOnDemand(
      clusterId,
      (config) => arrayTasksCommand(config, arrayJobId),
      (stdout, config) => parseJobs(stdout, config.scope).jobs
    )
  )
}

export function fetchJobHistory(clusterId: string, days: number): Promise<SlurmHistoryJob[]> {
  return reuseRecent(`${clusterId}:history:${days}`, () =>
    runOnDemand(clusterId, () => historyCommand(days), parseHistory)
  )
}

export function stopSchedulerMonitor(): void {
  for (const watch of watches.values()) if (watch.timer) clearTimeout(watch.timer)
  watches.clear()
  onDemand.clear()
}
