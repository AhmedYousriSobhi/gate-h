import { execFile } from 'child_process'
import { watch, type FSWatcher } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { listClusters } from '../clusters'
import { addNotification } from '../notifications/store'
import type { ClusterSummary, TeleportSessionInfo } from '../../shared/types'

// Tracks the tsh session each Teleport cluster would use, so the renderer can show "Log in" /
// "Renew" at the right time and waiting terminals can resume by themselves once the user logs in
// anywhere - in Gate-H or with `tsh login` in any terminal. Entirely event-driven, nothing polls:
//   - `tsh status` (local only, reads ~/.tsh) runs at startup, when clusters change, after a
//     login dialog, and when ~/.tsh changes (inotify via fs.watch, debounced);
//   - per session, one timer for the 15-minute warning and one for expiry, re-armed on every
//     refresh and unref'd so they never keep the app alive.

const WARN_BEFORE_MS = 15 * 60_000
// tsh writes several files per login/logout; one refresh once they've settled is enough.
const REFRESH_DEBOUNCE_MS = 500
const TSH_STATUS_TIMEOUT_MS = 10_000
// setTimeout keeps delays in a signed 32-bit int and fires at once past that (~24.8 days).
const MAX_TIMER_MS = 2 ** 31 - 1

interface TshProfile {
  profile_url?: string
  username?: string
  valid_until?: string
}

interface TshStatus {
  active?: TshProfile | null
  profiles?: TshProfile[] | null
}

/** Clusters that use the same proxy and Teleport user share one tsh session. */
interface SessionGroup {
  key: string
  proxy: string
  clusters: ClusterSummary[]
  validUntil: string | null
}

let broadcast: ((sessions: Record<string, TeleportSessionInfo>) => void) | null = null
let sessions: Record<string, TeleportSessionInfo> = {}
let groups: SessionGroup[] = []
let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let sessionTimers: Array<ReturnType<typeof setTimeout>> = []
let inFlight: Promise<void> | null = null
let rerunRequested = false
// Each warning goes out once per certificate (key + expiry), however often state is re-read.
const warned = new Set<string>()

export function proxyHost(address: string): string {
  const withoutScheme = address.replace(/^[a-z]+:\/\//i, '').split('/')[0]
  return withoutScheme.replace(/:\d+$/, '').toLowerCase()
}

function parseTime(value: string): number {
  // tsh writes RFC 3339 with up to nanosecond precision; Date only reliably takes milliseconds.
  return Date.parse(value.replace(/(\.\d{3})\d+/, '$1'))
}

/** The expiry of the stored tsh profile for `proxy` (and `user`, if given), from
 *  `tsh status --format=json` output. Same matching as teleport.sh's read_session. */
export function findValidUntil(status: TshStatus, proxy: string, user?: string): string | null {
  const profiles = [status.active, ...(status.profiles ?? [])]
  for (const profile of profiles) {
    if (!profile?.profile_url || proxyHost(profile.profile_url) !== proxyHost(proxy)) continue
    if (user && profile.username !== user) continue
    if (!profile.valid_until || Number.isNaN(parseTime(profile.valid_until))) return null
    return new Date(parseTime(profile.valid_until)).toISOString()
  }
  return null
}

function readTshStatus(): Promise<TshStatus> {
  return new Promise((resolve) => {
    execFile(
      'tsh',
      ['status', '--format=json'],
      { timeout: TSH_STATUS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        // tsh exits non-zero with "Not logged in" when there are no profiles at all, and a
        // missing tsh (ENOENT) means no sessions either.
        if (err && !stdout) return resolve({})
        try {
          resolve(JSON.parse(stdout) as TshStatus)
        } catch {
          resolve({})
        }
      }
    )
  })
}

function sessionKey(cluster: ClusterSummary): string {
  return `${proxyHost(cluster.teleport?.proxy ?? '')}|${cluster.teleport?.user ?? ''}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function clusterList(group: SessionGroup): string {
  const names = group.clusters.map((c) => c.name)
  return names.length > 1 ? ` (${names.join(', ')})` : ''
}

function notify(group: SessionGroup, message: string): void {
  // Attached to the group's first cluster, so clicking it opens a terminal that can log in.
  const target = group.clusters[0]
  addNotification({
    clusterId: target.id,
    clusterName: target.name,
    kind: 'ssh',
    severity: 'warning',
    message
  })
}

/** Sends whatever notifications are due for the current state. Runs after each refresh and
 *  from the session timers - never on an interval. */
function evaluate(fromExpiryTimer: SessionGroup | null): void {
  const now = Date.now()
  for (const group of groups) {
    if (!group.validUntil) continue
    const expiresAt = Date.parse(group.validUntil)
    const id = `${group.key}@${group.validUntil}`
    if (now >= expiresAt - WARN_BEFORE_MS && now < expiresAt && !warned.has(id)) {
      warned.add(id)
      notify(
        group,
        `Teleport session for ${group.proxy}${clusterList(group)} expires at ` +
          `${formatTime(group.validUntil)}. Click Renew in the terminal to log in again now.`
      )
    }
  }
  // Expiry is only announced when it happens while the app is running - a session that
  // expired overnight isn't news at the next launch, and its terminal already says "Log in".
  if (fromExpiryTimer) {
    notify(
      fromExpiryTimer,
      `Teleport session for ${fromExpiryTimer.proxy}${clusterList(fromExpiryTimer)} has ` +
        `expired. Open ${fromExpiryTimer.clusters[0].name} and click Log in.`
    )
  }
  broadcast?.(sessions)
}

function armTimers(): void {
  sessionTimers.forEach(clearTimeout)
  sessionTimers = []
  const now = Date.now()
  for (const group of groups) {
    if (!group.validUntil) continue
    const expiresAt = Date.parse(group.validUntil)
    const arm = (at: number, onFire: () => void): void => {
      if (at <= now) return
      // A delay past the 32-bit limit just re-arms from a fresh reading instead of misfiring.
      const delay = Math.min(at - now, MAX_TIMER_MS)
      const timer = setTimeout(delay === at - now ? onFire : armTimers, delay)
      timer.unref()
      sessionTimers.push(timer)
    }
    arm(expiresAt - WARN_BEFORE_MS, () => evaluate(null))
    arm(expiresAt, () => evaluate(group))
  }
}

async function runRefresh(): Promise<void> {
  const teleportClusters = listClusters().filter((c) => c.teleport)
  // No Teleport clusters, no tsh process - the common case costs nothing.
  const status = teleportClusters.length ? await readTshStatus() : {}
  const byKey = new Map<string, SessionGroup>()
  for (const cluster of teleportClusters) {
    const key = sessionKey(cluster)
    let group = byKey.get(key)
    if (!group) {
      const proxy = cluster.teleport?.proxy ?? ''
      group = {
        key,
        proxy,
        clusters: [],
        validUntil: findValidUntil(status, proxy, cluster.teleport?.user)
      }
      byKey.set(key, group)
    }
    group.clusters.push(cluster)
  }
  groups = [...byKey.values()]
  sessions = {}
  for (const group of groups) {
    for (const cluster of group.clusters) {
      sessions[cluster.id] = { clusterId: cluster.id, validUntil: group.validUntil }
    }
  }
  armTimers()
  ensureWatcher()
  evaluate(null)
}

/** Re-reads tsh's state. Calls while one is running coalesce into a single follow-up read, so a
 *  burst of events costs at most two `tsh status` runs. */
export function refreshTeleportSessions(): Promise<void> {
  if (inFlight) {
    rerunRequested = true
    return inFlight
  }
  inFlight = runRefresh()
    .catch((err) => console.error('[gate-h] teleport session refresh failed:', err))
    .finally(() => {
      inFlight = null
      if (rerunRequested) {
        rerunRequested = false
        void refreshTeleportSessions()
      }
    })
  return inFlight
}

function scheduleRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void refreshTeleportSessions()
  }, REFRESH_DEBOUNCE_MS)
  debounceTimer.unref()
}

/** Watches ~/.tsh, where every `tsh login`/`logout` writes. It doesn't exist until the first
 *  login, so this is retried after each refresh rather than failing once for good. */
function ensureWatcher(): void {
  if (watcher || !groups.length) return
  try {
    watcher = watch(join(homedir(), '.tsh'), { persistent: false }, scheduleRefresh)
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
    })
  } catch {
    watcher = null
  }
}

export function getTeleportSessions(): Record<string, TeleportSessionInfo> {
  return sessions
}

export function startTeleportSessionMonitor(
  onChange: (sessions: Record<string, TeleportSessionInfo>) => void
): void {
  broadcast = onChange
  void refreshTeleportSessions()
}

export function stopTeleportSessionMonitor(): void {
  broadcast = null
  watcher?.close()
  watcher = null
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  sessionTimers.forEach(clearTimeout)
  sessionTimers = []
}
