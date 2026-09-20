import { listClusters } from '../clusters'
import { checkTcpReachable } from './reachability'
import type { ClusterReachability } from '../../shared/types'

// 60s matches the default check interval of standard SSH-aware monitoring tools (e.g.
// Nagios/Icinga's check_ssh) - frequent enough for a "live" LED, conservative enough not to look
// like abuse to a cluster's intrusion detection.
const SWEEP_INTERVAL_MS = 60_000

const state = new Map<string, ClusterReachability>()
let broadcast: ((event: ClusterReachability) => void) | null = null
let intervalHandle: ReturnType<typeof setInterval> | null = null

function setStatus(clusterId: string, status: ClusterReachability['status']): void {
  const entry: ClusterReachability = { clusterId, status, checkedAt: new Date().toISOString() }
  state.set(clusterId, entry)
  broadcast?.(entry)
}

async function checkOne(clusterId: string, host: string, port: number): Promise<void> {
  setStatus(clusterId, 'checking')
  const reachable = await checkTcpReachable(host, port)
  setStatus(clusterId, reachable ? 'online' : 'offline')
}

async function sweep(): Promise<void> {
  const clusters = listClusters()
  const knownIds = new Set(clusters.map((c) => c.id))
  for (const id of state.keys()) {
    if (!knownIds.has(id)) state.delete(id)
  }
  await Promise.all(clusters.map((c) => checkOne(c.id, c.connection.host, c.connection.port)))
}

export function getAllReachability(): Record<string, ClusterReachability> {
  return Object.fromEntries(state)
}

/** Checks a single cluster immediately - used right after it's added/edited so its LED doesn't
 *  wait for the next sweep. */
export function refreshCluster(clusterId: string, host: string, port: number): void {
  void checkOne(clusterId, host, port)
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
