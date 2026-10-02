const FAILED_STATES = ['FAILED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY', 'BOOT_FAIL', 'DEADLINE']

/** The status-pill class for a Slurm job state - squeue's (`RUNNING`) or sacct's, which can carry
 *  a suffix (`CANCELLED by 1234`). */
export function stateClass(state: string): string {
  const base = state.split(' ')[0]
  if (base === 'RUNNING' || base === 'COMPLETING') return 'issue-status-active'
  if (base === 'COMPLETED') return 'issue-status-done'
  if (FAILED_STATES.includes(base)) return 'slurm-state-failed'
  return 'issue-status-todo'
}

/** `2026-09-29T14:05:00` -> `09-29 14:05`. Slurm prints the cluster's local time with no zone, so
 *  it's shortened as text rather than parsed into this machine's time zone. */
export function shortTime(value: string): string {
  const match = /^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
  return match ? `${match[1]} ${match[2]}` : value
}

/** A SlurmNode.state is already flag-stripped (see its own doc comment), so this only needs to
 *  match base state words, not sinfo's `down*`/`drain$` suffix notation. */
export function nodeIsDown(state: string): boolean {
  return /^(down|drain|fail)/i.test(state)
}

export function nodeStateClass(state: string): string {
  if (nodeIsDown(state)) return 'slurm-state-failed'
  if (/^(alloc|mixed)/i.test(state)) return 'issue-status-active'
  if (/^idle/i.test(state)) return 'issue-status-done'
  return 'issue-status-todo'
}
