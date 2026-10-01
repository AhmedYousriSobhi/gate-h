import type { SchedulerSnapshot } from '../../../../shared/types'

/** Compact "N running · M pending" from a snapshot's jobs - every distinct state present, most
 *  populous first, so a long tail of one-off states doesn't bump a state with real counts out of
 *  view on a narrow card or table column. */
export function jobSummary(snapshot: SchedulerSnapshot): string {
  if (snapshot.jobs.length === 0) return 'No jobs'
  const counts = new Map<string, number>()
  for (const job of snapshot.jobs) counts.set(job.state, (counts.get(job.state) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => `${count} ${state.toLowerCase()}`)
    .join(' · ')
}

/** Running+pending job counts across every cluster with a cached snapshot - for the Overview's
 *  fleet-wide summary. Never fetches anything itself: snapshots only exist for clusters that have
 *  been opened or are background-watched (see SPEC.md §3.10), so this is display-only, not a new
 *  polling path. */
export function fleetJobTotals(snapshots: Record<string, SchedulerSnapshot>): {
  running: number
  pending: number
} {
  let running = 0
  let pending = 0
  for (const snapshot of Object.values(snapshots)) {
    for (const job of snapshot.jobs) {
      if (job.state === 'RUNNING') running++
      else if (job.state === 'PENDING') pending++
    }
  }
  return { running, pending }
}
