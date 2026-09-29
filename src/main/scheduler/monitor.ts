import { getCluster, listClusters } from '../clusters'
import { addNotification } from '../notifications/store'
import { hasLiveConnection, NoSessionError, runOnCluster } from './exec'
import { describeChanges, finishedJobs, type FinalStates } from './changes'
import { clearRecent, reuseRecent } from './reuse'
import {
  arrayTasksCommand,
  classifyFailure,
  finalStatesCommand,
  parseFinalStates,
  historyCommand,
  parseHistory,
  parseJobs,
  parseSnapshot,
  snapshotCommand,
  type SlurmData
} from './slurm'
import {
  MIN_SCHEDULER_INTERVAL_SEC,
  type ClusterSummary,
  type SchedulerConfig,
  type SchedulerSnapshot,
  type SlurmHistoryJob,
  type SlurmJob
} from '../../shared/types'

// Polls a cluster's Slurm queue while the renderer is showing it: the Status widget's Slurm
// section watches the selected cluster and unwatches when it's hidden, backgrounded or put in
// standby. The one exception is the opt-in background check for notifications (below). slurmctld is shared by every user of the cluster,
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

interface RunResult {
  snapshot: SchedulerSnapshot
  /** A command ran (so it counts for the interval), as opposed to waiting for a session. */
  ran: boolean
  ok: boolean
}

// One refresh per cluster at a time, shared by the foreground poll and the background check, so
// the two can't both diff against the same baseline and notify twice.
const inFlight = new Map<string, Promise<RunResult>>()

function refresh(cluster: ClusterSummary, config: SchedulerConfig): Promise<RunResult> {
  const running = inFlight.get(cluster.id)
  if (running) return running
  const run = runSnapshot(cluster, config).finally(() => inFlight.delete(cluster.id))
  inFlight.set(cluster.id, run)
  return run
}

async function runSnapshot(cluster: ClusterSummary, config: SchedulerConfig): Promise<RunResult> {
  const previous = cached(cluster.id, config) ?? emptySnapshot(cluster.id)
  try {
    const result = await runOnCluster(cluster, snapshotCommand(config))
    if (result.exitCode !== 0) {
      const failure = classifyFailure(result.exitCode, result.stderr)
      return { snapshot: { ...previous, ...failure }, ran: true, ok: false }
    }
    const data = parseSnapshot(result.stdout, config.scope)
    if (config.notify && previous.fetchedAt) await notifyChanges(cluster, previous, data)
    return {
      snapshot: {
        ...previous,
        ...data,
        status: 'ok',
        message: undefined,
        fetchedAt: new Date().toISOString()
      },
      ran: true,
      ok: true
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof NoSessionError) {
      return { snapshot: { ...previous, status: 'waiting', message }, ran: false, ok: false }
    }
    return { snapshot: { ...previous, status: 'error', message }, ran: true, ok: false }
  }
}

// sacct is asked about at most this many finished jobs per refresh; the rest are reported as
// having left the queue.
const MAX_FINAL_STATE_LOOKUPS = 100

async function notifyChanges(
  cluster: ClusterSummary,
  before: SchedulerSnapshot,
  after: SlurmData
): Promise<void> {
  const user = cluster.connection.username
  const finished = finishedJobs(before, after, user).slice(0, MAX_FINAL_STATE_LOOKUPS)
  let finalStates: FinalStates | null = null
  if (finished.length) {
    // Accounting storage is optional; without it the jobs still get a "left the queue" notice.
    try {
      const result = await runOnCluster(cluster, finalStatesCommand(finished.map((job) => job.id)))
      if (result.exitCode === 0) finalStates = parseFinalStates(result.stdout)
    } catch {
      finalStates = null
    }
  }
  for (const change of describeChanges(before, after, finalStates, user)) {
    addNotification({
      clusterId: cluster.id,
      clusterName: cluster.name,
      kind: 'scheduler',
      severity: change.severity,
      message: change.message
    })
  }
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
  const { snapshot, ran, ok } = await refresh(cluster, config)
  if (ran) watch.lastRunAt = Date.now()
  if (ok) watch.failures = 0
  else if (ran) watch.failures++
  watch.running = false

  // Unwatched while the command ran: cache the result, but don't schedule another.
  const delay = watches.get(clusterId) === watch ? nextDelay(watch, config, snapshot.status) : null
  publish(clusterId, config, {
    ...snapshot,
    refreshing: false,
    nextRefreshAt: delay === null ? null : new Date(Date.now() + delay).toISOString()
  })
  if (delay !== null) watch.timer = setTimeout(() => void poll(clusterId), delay)
}

// With notifications on, an open cluster keeps being checked while it's in the background, on
// the SSH connection its terminal already holds - every 5 minutes at most, backing off to 30 on
// failures. Never for Teleport clusters (each run would be an audited session) or without a live
// connection, so a closed or standby cluster still costs nothing.
const BACKGROUND_SWEEP_MS = 60_000
const BACKGROUND_INTERVAL_MS = 5 * 60_000
const MAX_BACKGROUND_BACKOFF_MS = 30 * 60_000
const background = new Map<string, { lastRunAt: number; failures: number; running: boolean }>()
let sweepTimer: ReturnType<typeof setInterval> | null = null

/** Run once a minute by startSchedulerMonitor; exported for scripts/scheduler-monitor.checks.ts. */
export function sweepBackground(): void {
  for (const cluster of listClusters()) {
    const config = cluster.scheduler
    if (!config?.notify || cluster.teleport || !cluster.activeMonitoring) continue
    if (watches.has(cluster.id) || !hasLiveConnection(cluster.id)) continue
    const state = background.get(cluster.id) ?? { lastRunAt: 0, failures: 0, running: false }
    background.set(cluster.id, state)
    const fetchedAt = Date.parse(cached(cluster.id, config)?.fetchedAt ?? '0')
    const wait = Math.min(
      Math.max(intervalMs(config), BACKGROUND_INTERVAL_MS) * 2 ** state.failures,
      MAX_BACKGROUND_BACKOFF_MS
    )
    if (state.running || Date.now() - Math.max(state.lastRunAt, fetchedAt) < wait) continue
    state.running = true
    void refresh(cluster, config).then(({ snapshot, ran, ok }) => {
      state.running = false
      if (ran) state.lastRunAt = Date.now()
      state.failures = ok ? 0 : ran ? state.failures + 1 : state.failures
      publish(cluster.id, config, { ...snapshot, refreshing: false, nextRefreshAt: null })
    })
  }
}

export function startSchedulerMonitor(): void {
  if (!sweepTimer) sweepTimer = setInterval(sweepBackground, BACKGROUND_SWEEP_MS)
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
  clearRecent()
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = null
  background.clear()
}
