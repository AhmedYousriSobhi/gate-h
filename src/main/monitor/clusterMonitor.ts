import { listClusters } from '../clusters'
import { checkTcpReachable } from './reachability'
import { addNotification } from '../notifications/store'
import type { ClusterReachability } from '../../shared/types'

// 60s matches the default check interval of standard SSH-aware monitoring tools (e.g.
// Nagios/Icinga's check_ssh) - frequent enough for a "live" LED, conservative enough not to look
// like abuse to a cluster's intrusion detection.
const SWEEP_INTERVAL_MS = 60_000

const state = new Map<string, ClusterReachability>()
// Tracks the last *settled* (non-"checking") status per cluster, separately from `state` above,
// so a transition can be detected against the previous real reading rather than against the
// transient "checking" entry that setStatus() writes moments before the real result comes in.
const lastSettledStatus = new Map<string, 'online' | 'offline'>()
let broadcast: ((event: ClusterReachability) => void) | null = null
let intervalHandle: ReturnType<typeof setInterval> | null = null
let lastSweepStartedAt = 0
// Floor on how often a sweep can run, even when nudged early by triggerImmediateSweepIfStale() -
// this is what keeps "check again when the window regains focus" from ever turning into spam if
// the user alt-tabs in and out repeatedly.
const MIN_SWEEP_GAP_MS = 15_000

function setStatus(
  clusterId: string,
  clusterName: string,
  status: ClusterReachability['status']
): void {
  const entry: ClusterReachability = { clusterId, status, checkedAt: new Date().toISOString() }
  state.set(clusterId, entry)
  broadcast?.(entry)

  if (status === 'checking') return

  const previous = lastSettledStatus.get(clusterId)
  if (previous && previous !== status) {
    addNotification({
      clusterId,
      clusterName,
      kind: 'reachability',
      severity: status === 'offline' ? 'warning' : 'info',
      message:
        status === 'offline'
          ? `${clusterName} became unreachable`
          : `${clusterName} is reachable again`
    })
  }
  lastSettledStatus.set(clusterId, status)
}

async function checkOne(
  clusterId: string,
  clusterName: string,
  host: string,
  port: number
): Promise<void> {
  setStatus(clusterId, clusterName, 'checking')
  const reachable = await checkTcpReachable(host, port)
  setStatus(clusterId, clusterName, reachable ? 'online' : 'offline')
}

async function sweep(): Promise<void> {
  lastSweepStartedAt = Date.now()
  const clusters = listClusters()
  const knownIds = new Set(clusters.map((c) => c.id))
  for (const id of state.keys()) {
    if (!knownIds.has(id)) {
      state.delete(id)
      lastSettledStatus.delete(id)
    }
  }
  await Promise.all(
    clusters.map((c) => checkOne(c.id, c.name, c.connection.host, c.connection.port))
  )
}

export function getAllReachability(): Record<string, ClusterReachability> {
  return Object.fromEntries(state)
}

/** Checks a single cluster immediately - used right after it's added/edited so its LED doesn't
 *  wait for the next sweep. */
export function refreshCluster(
  clusterId: string,
  clusterName: string,
  host: string,
  port: number
): void {
  void checkOne(clusterId, clusterName, host, port)
}

/** Runs a sweep right away instead of waiting for the next scheduled tick, but only if it's been
 *  at least MIN_SWEEP_GAP_MS since the last one - e.g. when the window regains focus, so
 *  reachability catches up quickly after something like reconnecting a VPN, without that turning
 *  into extra load on a cluster's login node if focus events fire in quick succession. */
export function triggerImmediateSweepIfStale(): void {
  if (Date.now() - lastSweepStartedAt >= MIN_SWEEP_GAP_MS) {
    void sweep()
  }
}

export function startClusterMonitor(onUpdate: (event: ClusterReachability) => void): void {
  broadcast = onUpdate
  void sweep()
  intervalHandle = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
}

export function stopClusterMonitor(): void {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = null
  broadcast = null
}
