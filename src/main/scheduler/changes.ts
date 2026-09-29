import type { SlurmJob, SlurmNodeIssue } from '../../shared/types'
import type { SlurmData } from './slurm'

// What changed between two Slurm snapshots that's worth a notification: the user's own jobs
// finishing or starting, and nodes newly down or drained. Pure, so the monitor stays about timing
// and scripts/slurm.checks.ts can cover this directly. A burst (a job array's tasks, a rack going
// down) becomes one summary notification rather than dozens.

export interface SchedulerChange {
  severity: 'info' | 'warning'
  message: string
}

export type FinalStates = Map<string, { state: string; exitCode: string }>

/** Past this many of one kind of change, one summary replaces the individual notifications. */
const SUMMARY_THRESHOLD = 3

/** Collapsed array rows (`123_[4-200]`) change id as tasks start, so they're never compared. */
function comparable(job: SlurmJob, user?: string): boolean {
  return !job.id.includes('[') && (job.user === undefined || job.user === user)
}

/** Jobs in `before` that are gone from `after` - finished, failed or cancelled. Empty when either
 *  snapshot was truncated, since a missing row then doesn't mean the job left. */
export function finishedJobs(before: SlurmData, after: SlurmData, user?: string): SlurmJob[] {
  if (before.truncated || after.truncated) return []
  const now = new Set(after.jobs.map((job) => job.id))
  return before.jobs.filter((job) => comparable(job, user) && !now.has(job.id))
}

function label(job: SlurmJob): string {
  return job.name ? `Job ${job.id} (${job.name})` : `Job ${job.id}`
}

function outcome(state: string | undefined): { text: string; ok: boolean } {
  const base = state?.split(' ')[0]
  switch (base) {
    case 'COMPLETED':
      return { text: 'completed', ok: true }
    case 'FAILED':
      return { text: 'failed', ok: false }
    case 'TIMEOUT':
      return { text: 'hit its time limit', ok: false }
    case 'CANCELLED':
      return { text: 'was cancelled', ok: false }
    case 'OUT_OF_MEMORY':
      return { text: 'ran out of memory', ok: false }
    case 'NODE_FAIL':
      return { text: 'failed because a node failed', ok: false }
    case 'PREEMPTED':
      return { text: 'was preempted', ok: false }
    case undefined:
      return { text: 'left the queue', ok: true }
    default:
      return { text: `finished (${base.toLowerCase()})`, ok: true }
  }
}

function summarize<T>(
  items: T[],
  one: (item: T) => SchedulerChange,
  many: (items: T[]) => SchedulerChange
): SchedulerChange[] {
  if (items.length === 0) return []
  return items.length > SUMMARY_THRESHOLD ? [many(items)] : items.map(one)
}

export function describeChanges(
  before: SlurmData,
  after: SlurmData,
  finalStates: FinalStates | null,
  user?: string
): SchedulerChange[] {
  const finished = finishedJobs(before, after, user)
  const pendingBefore = new Map(before.jobs.map((job) => [job.id, job.state]))
  const started = after.jobs.filter(
    (job) =>
      comparable(job, user) &&
      job.state === 'RUNNING' &&
      (pendingBefore.get(job.id) ?? 'PENDING') === 'PENDING'
  )
  const known = new Set(before.nodeIssues.map((issue) => `${issue.nodes}|${issue.state}`))
  const issues = after.nodeIssues.filter((issue) => !known.has(`${issue.nodes}|${issue.state}`))

  const finalOf = (job: SlurmJob): { text: string; ok: boolean; exitCode?: string } => {
    const final = finalStates?.get(job.id)
    return { ...outcome(final?.state), exitCode: final?.exitCode }
  }

  return [
    ...summarize(
      finished,
      (job) => {
        const result = finalOf(job)
        const exit = !result.ok && result.exitCode && result.exitCode !== '0:0'
        return {
          severity: result.ok ? 'info' : 'warning',
          message: `${label(job)} ${result.text}${exit ? ` (exit code ${result.exitCode})` : ''}`
        }
      },
      (jobs) => {
        const counts = new Map<string, number>()
        let failed = false
        for (const job of jobs) {
          const result = finalOf(job)
          failed ||= !result.ok
          counts.set(result.text, (counts.get(result.text) ?? 0) + 1)
        }
        const detail = [...counts].map(([text, count]) => `${count} ${text}`).join(', ')
        return {
          severity: failed ? 'warning' : 'info',
          message: `${jobs.length} jobs finished: ${detail}`
        }
      }
    ),
    ...summarize(
      started,
      (job) => ({ severity: 'info', message: `${label(job)} started on ${job.reason}` }),
      (jobs) => ({ severity: 'info', message: `${jobs.length} jobs started` })
    ),
    ...summarize(
      issues,
      (issue: SlurmNodeIssue) => ({
        severity: 'warning',
        message: `Nodes ${issue.nodes} are ${issue.state.replace(/[^a-z]+$/i, '')}: ${issue.reason}`
      }),
      (list) => ({
        severity: 'warning',
        message: `${list.length} sets of nodes went down or were drained, e.g. ${list[0].nodes}: ${list[0].reason}`
      })
    )
  ]
}
