import {
  MAX_SLURM_JOBS,
  SLURM_PARTITION_PATTERN,
  type SchedulerConfig,
  type SchedulerStatus,
  type SlurmGres,
  type SlurmHistoryJob,
  type SlurmJob,
  type SlurmNode,
  type SlurmNodeIssue,
  type SlurmPartition
} from '../../shared/types'

// The fixed Slurm commands Gate-H runs, and parsers for their output. Pure functions, no I/O - see
// scripts/slurm.checks.ts. Output is delimited `--format` text rather than `--json`, which needs
// Slurm 21.08+ built with a data-parser plugin. Free-text fields (job name, drain reason) go last
// and may contain the delimiter, so lines are split on the first N-1 delimiters only.

export interface SlurmData {
  jobs: SlurmJob[]
  truncated: boolean
  partitions: SlurmPartition[]
  nodeIssues: SlurmNodeIssue[]
  nodes: SlurmNode[]
}

const SECTION_MARKER = '@@gateh@@'
const MINE_JOB_FORMAT = '%i|%P|%T|%M|%l|%D|%S|%R|%j'
const PARTITION_JOB_FORMAT = '%i|%P|%u|%T|%M|%l|%D|%S|%R|%j'
// --parsable2 separates with | and doesn't end lines with one; JobName is free text, so last.
const HISTORY_FORMAT =
  'JobID,User,Partition,State,ExitCode,Elapsed,Start,End,TotalCPU,AllocCPUS,JobName'
export const HISTORY_DAYS = [1, 7, 30]

function partitionArg(config: SchedulerConfig): string {
  for (const name of config.partitions) {
    if (!SLURM_PARTITION_PATTERN.test(name)) throw new Error(`Invalid partition name: ${name}`)
  }
  return config.partitions.length ? ` '--partition=${config.partitions.join(',')}'` : ''
}

function jobsCommand(config: SchedulerConfig, extra = ''): string {
  // `--user` rather than `--me`, which needs Slurm 20.11+.
  const who = config.scope === 'mine' ? ' --user="$(id -un)"' : ''
  const format = config.scope === 'mine' ? MINE_JOB_FORMAT : PARTITION_JOB_FORMAT
  return `LC_ALL=C squeue${who}${extra} --noheader '--format=${format}'`
}

/** One refresh: jobs, per-partition node states, down/drained nodes, and the full node inventory,
 *  chained into a single exec so it costs one channel. The partition filter narrows only the jobs;
 *  node health is always cluster-wide, since a down node matters whatever partition it is in. `&&` so the exit status is the first
 *  failure's.
 *
 *  ASSUMPTION: `%C`/`%m`/`%G` are standard, stable `sinfo` format letters (CPU state as
 *  `alloc/idle/other/total`, memory in MiB, and GRES) across the Slurm versions already targeted
 *  by this file's other commands. EVIDENCE: documented in Slurm's `sinfo` man page, unchanged
 *  since well before the oldest Slurm version this app already assumes (its delimited-format
 *  commands already avoid `--json`, which needs 21.08+). DECISION: parse defensively (`parseNodes`
 *  below skips a row whose `%C` doesn't split into exactly 4 numbers rather than guessing) and
 *  flag this for validation against a real cluster before relying on it further (see
 *  docs/architecture/roadmap.md Phase 2). */
export function snapshotCommand(config: SchedulerConfig): string {
  const partitions = partitionArg(config)
  return [
    jobsCommand(config, partitions),
    `echo '${SECTION_MARKER}'`,
    `LC_ALL=C sinfo --noheader '--format=%R|%a|%D|%T'`,
    `echo '${SECTION_MARKER}'`,
    `LC_ALL=C sinfo --noheader --list-reasons '--format=%N|%T|%E'`,
    `echo '${SECTION_MARKER}'`,
    `LC_ALL=C sinfo -N --noheader '--format=%N|%R|%T|%C|%m|%G|%E'`
  ].join(' && ')
}

/** The tasks of one collapsed job array (`123_[1-500]` -> `123`). */
export function arrayTasksCommand(config: SchedulerConfig, arrayJobId: string): string {
  if (!/^\d+$/.test(arrayJobId)) throw new Error(`Invalid job array id: ${arrayJobId}`)
  return jobsCommand(config, ` --array --jobs=${arrayJobId}`)
}

/** The SSH user's finished and running allocations (no job steps) over the last `days` days,
 *  newest first. sacct reads slurmdbd, not slurmctld, and is only ever run on request. */
export function historyCommand(days: number, allUsers = false): string {
  if (!HISTORY_DAYS.includes(days)) throw new Error(`Unsupported history range: ${days} days`)
  return (
    `LC_ALL=C sacct ${allUsers ? '--allusers' : '--user="$(id -un)"'} --allocations --noheader --parsable2 ` +
    `--starttime=now-${days}days '--format=${HISTORY_FORMAT}'`
  )
}

/** Final states of jobs that just left the queue, for notifications. */
export function finalStatesCommand(jobIds: string[]): string {
  const bad = jobIds.find((id) => !/^\d+(_\d+)?$/.test(id))
  if (bad !== undefined) throw new Error(`Invalid job id: ${bad}`)
  return (
    `LC_ALL=C sacct --jobs=${jobIds.join(',')} --allocations --noheader --parsable2 ` +
    `'--format=JobID,State,ExitCode'`
  )
}

export function parseFinalStates(text: string): Map<string, { state: string; exitCode: string }> {
  const states = new Map<string, { state: string; exitCode: string }>()
  for (const row of lines(text)) {
    const f = splitFields(row, 3)
    if (f) states.set(f[0], { state: f[1], exitCode: f[2] })
  }
  return states
}

function splitFields(line: string, count: number): string[] | null {
  const fields: string[] = []
  let rest = line
  for (let i = 0; i < count - 1; i++) {
    const at = rest.indexOf('|')
    if (at === -1) return null
    fields.push(rest.slice(0, at))
    rest = rest.slice(at + 1)
  }
  fields.push(rest)
  return fields
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '')
}

function slurmTime(value: string): string | null {
  return value === 'N/A' || value === 'Unknown' || value === 'None' ? null : value
}

export function parseJobs(
  text: string,
  scope: SchedulerConfig['scope']
): { jobs: SlurmJob[]; truncated: boolean } {
  const rows = lines(text)
  const withUser = scope === 'partitions'
  const jobs: SlurmJob[] = []
  for (const row of rows.slice(0, MAX_SLURM_JOBS)) {
    const f = splitFields(row, withUser ? 10 : 9)
    if (!f) continue
    const [id, partition, ...rest] = f
    const user = withUser ? rest.shift() : undefined
    const [state, elapsed, timeLimit, nodes, start, reason, name] = rest
    const job: SlurmJob = {
      id,
      partition,
      state,
      elapsed,
      timeLimit,
      nodes: Number(nodes) || 0,
      start: slurmTime(start),
      reason,
      name
    }
    if (user !== undefined) job.user = user
    jobs.push(job)
  }
  return { jobs, truncated: rows.length > MAX_SLURM_JOBS }
}

/** Parses Slurm's `[DD-[HH:]]MM:SS[.ms]` duration format (seen in Elapsed/TotalCPU) into seconds.
 *  Null for anything that doesn't match - an empty/missing field, or `INVALID`. */
function parseSlurmDuration(value: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) return null
  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3])
  const seconds = Number(match[4])
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}

/** CPU time actually used (TotalCPU) as a percentage of what was reserved (AllocCPUS x Elapsed) -
 *  the same thing `seff` reports, computed from fields already in the same sacct row instead of a
 *  second query against job steps. Null whenever any input doesn't parse, or elapsed/CPUs are
 *  zero (a job that never started) - better to show nothing than a divide-by-zero or nonsense
 *  number. */
function cpuEfficiencyPct(totalCpu: string, allocCpus: string, elapsed: string): number | null {
  const cpuSeconds = parseSlurmDuration(totalCpu)
  const elapsedSeconds = parseSlurmDuration(elapsed)
  const cpus = Number(allocCpus)
  if (
    cpuSeconds === null ||
    elapsedSeconds === null ||
    !Number.isFinite(cpus) ||
    cpus <= 0 ||
    elapsedSeconds <= 0
  ) {
    return null
  }
  return Math.round((cpuSeconds / (elapsedSeconds * cpus)) * 100)
}

/** Newest first: sacct lists oldest first, and the recent failures are what people look for. */
export function parseHistory(text: string): SlurmHistoryJob[] {
  const jobs: SlurmHistoryJob[] = []
  for (const row of lines(text).slice(-MAX_SLURM_JOBS)) {
    const f = splitFields(row, 11)
    if (!f) continue
    const [id, user, partition, state, exitCode, elapsed, start, end, totalCpu, allocCpus, name] = f
    jobs.push({
      id,
      user,
      partition,
      state,
      exitCode,
      elapsed,
      start: slurmTime(start),
      end: slurmTime(end),
      name,
      cpuEfficiencyPct: cpuEfficiencyPct(totalCpu, allocCpus, elapsed)
    })
  }
  return jobs.reverse()
}

/** sinfo prints one row per partition and node state; this folds them into one per partition.
 *  State flags (`down*` = not responding, `idle~` = powered down, ...) are dropped. */
export function parsePartitions(text: string): SlurmPartition[] {
  const byName = new Map<string, SlurmPartition>()
  for (const row of lines(text)) {
    const f = splitFields(row, 4)
    if (!f) continue
    const [name, available, count, rawState] = f
    const nodes = Number(count) || 0
    const state = rawState.toLowerCase().replace(/[^a-z]+$/, '')
    const partition = byName.get(name) ?? { name, available, totalNodes: 0, nodesByState: {} }
    partition.totalNodes += nodes
    partition.nodesByState[state] = (partition.nodesByState[state] ?? 0) + nodes
    byName.set(name, partition)
  }
  return [...byName.values()]
}

export function parseNodeIssues(text: string): SlurmNodeIssue[] {
  const issues: SlurmNodeIssue[] = []
  for (const row of lines(text)) {
    const f = splitFields(row, 3)
    if (f) issues.push({ nodes: f[0], state: f[1], reason: f[2] })
  }
  return issues
}

/** Parses a GRES string like `gpu:4`, `gpu:a100:4`, or several comma-separated entries, into GPU
 *  type+count pairs. `(null)` (no GRES configured) and non-GPU entries (e.g. `license:foo:2`)
 *  parse to nothing rather than a guess. */
export function parseGres(raw: string): SlurmGres[] {
  if (!raw || raw === '(null)') return []
  const out: SlurmGres[] = []
  for (const entry of raw.split(',')) {
    const parts = entry.split(':')
    if (parts[0] !== 'gpu') continue
    const count = Number(parts[parts.length - 1])
    if (!Number.isInteger(count) || count <= 0) continue
    const type = parts.length > 2 ? parts.slice(1, -1).join(':') : 'gpu'
    out.push({ type, count })
  }
  return out
}

/** sinfo -N prints one row per (node, partition) pair; this folds them into one SlurmNode per
 *  unique node name, with every partition it belongs to. A row whose %C doesn't split into
 *  exactly 4 numbers (alloc/idle/other/total) is kept with null CPU fields rather than dropped -
 *  see the ASSUMPTION note on snapshotCommand. */
export function parseNodes(text: string): SlurmNode[] {
  const byName = new Map<string, SlurmNode>()
  for (const row of lines(text)) {
    const f = splitFields(row, 7)
    if (!f) continue
    const [name, partition, rawState, cpuField, memField, gresField, reason] = f
    const existing = byName.get(name)
    if (existing) {
      if (!existing.partitions.includes(partition)) existing.partitions.push(partition)
      continue
    }
    const cpuParts = cpuField.split('/')
    const cpuNumbers = cpuParts.length === 4 ? cpuParts.map(Number) : null
    const cpusValid = cpuNumbers?.every(Number.isFinite) ?? false
    const mem = Number(memField)
    byName.set(name, {
      name,
      partitions: [partition],
      state: rawState.toLowerCase().replace(/[^a-z]+$/, ''),
      cpusAllocated: cpusValid ? (cpuNumbers as number[])[0] : null,
      cpusTotal: cpusValid ? (cpuNumbers as number[])[3] : null,
      memTotalMiB: Number.isFinite(mem) ? mem : null,
      gpus: parseGres(gresField),
      reason: reason.trim() === 'none' ? '' : reason.trim()
    })
  }
  return [...byName.values()]
}

/** Total configured GPU capacity across the inventory - a static figure from Slurm's own GRES
 *  config, not a live reading. Fills the gap flagged in docs/architecture/current-state.md §4:
 *  there was previously no way to answer "how many GPUs does this cluster have" at all, only
 *  "which GPUs belong to one running job" (GpuSample). Deliberately does not attempt a GPU
 *  *allocation* (in-use) figure here - that needs either a validated squeue GRES-per-job format
 *  or `scontrol show node`'s AllocTRES, neither verified against real output yet (see
 *  docs/architecture/roadmap.md Phase 2). */
export function totalGpuCapacity(nodes: SlurmNode[]): number {
  return nodes.reduce((sum, node) => sum + node.gpus.reduce((s, g) => s + g.count, 0), 0)
}

export function parseSnapshot(stdout: string, scope: SchedulerConfig['scope']): SlurmData {
  const sections = stdout.split(`${SECTION_MARKER}\n`)
  if (sections.length !== 4) throw new Error('Unexpected output from squeue/sinfo.')
  return {
    ...parseJobs(sections[0], scope),
    partitions: parsePartitions(sections[1]),
    nodeIssues: parseNodeIssues(sections[2]),
    nodes: parseNodes(sections[3])
  }
}

/** Maps a failed run to what the user sees - a missing squeue, or an overloaded slurmctld (which
 *  should back off), rather than raw stderr. */
export function classifyFailure(
  exitCode: number | null,
  stderr: string
): { status: Exclude<SchedulerStatus, 'ok' | 'waiting'>; message: string } {
  if (exitCode === 127 || /command not found|No such file/i.test(stderr)) {
    return {
      status: 'no-slurm',
      message: "squeue/sinfo aren't on the login node's PATH for non-interactive shells."
    }
  }
  if (/timed out|rate.?limit|Unable to contact slurm controller|try again/i.test(stderr)) {
    return { status: 'busy', message: 'The Slurm controller is busy or unreachable.' }
  }
  const last = lines(stderr).pop()
  return {
    status: 'error',
    message: last ? last.trim() : `squeue/sinfo exited with status ${exitCode ?? 'unknown'}.`
  }
}
