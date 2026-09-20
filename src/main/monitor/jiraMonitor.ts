import { getClusterSecrets, listClusters } from '../clusters'
import { listJiraIssues } from '../jira/client'
import { addNotification } from '../notifications/store'
import type { ClusterSummary } from '../../shared/types'

// Jira's API is heavier and more rate-limit-sensitive than the reachability TCP probe, so this
// polls far less often - every 3 minutes is enough to feel "live" for ticket triage without
// hammering the API.
const SWEEP_INTERVAL_MS = 3 * 60 * 1000

// key: `${clusterId}:${issueKey}` -> last-seen status. A cluster's first sweep this run only
// establishes this baseline (no notifications) - otherwise every cluster with existing tickets
// would fire a wall of "new ticket" notifications the moment the app starts.
const lastSeenStatus = new Map<string, string>()
const sweptClusterIds = new Set<string>()
let intervalHandle: ReturnType<typeof setInterval> | null = null

async function sweepCluster(cluster: ClusterSummary): Promise<void> {
  if (!cluster.jira) return

  let token: string | null
  try {
    token = getClusterSecrets(cluster.id).jiraApiToken
  } catch {
    return
  }
  if (!token) return

  let issues
  try {
    issues = await listJiraIssues(cluster.jira, token)
  } catch {
    // Transient Jira API errors (auth expired, network blip) shouldn't spam notifications - the
    // Status tab already surfaces the error when the user looks at it.
    return
  }

  const isFirstSweep = !sweptClusterIds.has(cluster.id)

  for (const issue of issues) {
    const key = `${cluster.id}:${issue.key}`
    const previousStatus = lastSeenStatus.get(key)

    if (previousStatus === undefined) {
      lastSeenStatus.set(key, issue.status)
      if (!isFirstSweep) {
        addNotification({
          clusterId: cluster.id,
          clusterName: cluster.name,
          kind: 'jira',
          severity: 'info',
          message: `New ticket ${issue.key} on ${cluster.name}: ${issue.summary}`
        })
      }
      continue
    }

    if (previousStatus !== issue.status) {
      addNotification({
        clusterId: cluster.id,
        clusterName: cluster.name,
        kind: 'jira',
        severity: 'info',
        message: `${issue.key} on ${cluster.name} moved to "${issue.status}": ${issue.summary}`
      })
      lastSeenStatus.set(key, issue.status)
    }
  }

  sweptClusterIds.add(cluster.id)
}

async function sweep(): Promise<void> {
  const clusters = listClusters()
  const knownIds = new Set(clusters.map((c) => c.id))
  for (const key of lastSeenStatus.keys()) {
    if (!knownIds.has(key.split(':')[0])) lastSeenStatus.delete(key)
  }
  for (const id of sweptClusterIds) {
    if (!knownIds.has(id)) sweptClusterIds.delete(id)
  }
  await Promise.all(clusters.map(sweepCluster))
}

export function startJiraMonitor(): void {
  void sweep()
  intervalHandle = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
}

export function stopJiraMonitor(): void {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = null
}
