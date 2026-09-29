// Checks for src/main/scheduler/slurm.ts, run by test-pty-manager.mjs: the fixed squeue/sinfo
// commands, and parsing their output as real sites print it (free-text fields containing the
// delimiter, collapsed job arrays, sinfo state flags, error classification).

import {
  arrayTasksCommand,
  classifyFailure,
  historyCommand,
  parseHistory,
  parseJobs,
  parseNodeIssues,
  parsePartitions,
  parseSnapshot,
  snapshotCommand
} from '../src/main/scheduler/slurm'
import { MAX_SLURM_JOBS, type SchedulerConfig } from '../src/shared/types'

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}
function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

const mine: SchedulerConfig = {
  kind: 'slurm',
  scope: 'mine',
  partitions: [],
  intervalSec: 60,
  autoRefresh: true
}
const byPartition: SchedulerConfig = { ...mine, scope: 'partitions', partitions: ['gpu', 'cpu'] }

console.log('-- commands')
const mineCmd = snapshotCommand(mine)
report(mineCmd.includes('squeue --user="$(id -un)"'), "scope 'mine' limits squeue to the SSH user")
report(!mineCmd.includes('--partition'), 'no partition filter when none is configured')
report(
  (mineCmd.match(/ && /g) ?? []).length === 4,
  'one chained exec with the first failure as its status'
)
const partCmd = snapshotCommand(byPartition)
report(
  !partCmd.includes('--user') && (partCmd.match(/'--partition=gpu,cpu'/g) ?? []).length === 3,
  "scope 'partitions' shows every user's jobs, but only in the named partitions",
  partCmd
)
report(
  throws(() => snapshotCommand({ ...byPartition, partitions: [] })),
  "scope 'partitions' refuses to run without a partition (no whole-queue scope)"
)
report(
  throws(() => snapshotCommand({ ...mine, partitions: ["gpu'; rm -rf ~; '"] })),
  'rejects a partition name that could break out of the quoting'
)
report(
  arrayTasksCommand(mine, '123').includes('--array --jobs=123'),
  'expands one job array on request'
)
report(
  throws(() => arrayTasksCommand(mine, '123;id')),
  'array id must be digits only'
)

console.log('-- squeue')
const squeueMine = [
  '4242|gpu|RUNNING|1:02:03|1-00:00:00|2|2026-09-29T08:00:00|gpu[01-02]|train|resnet|v2',
  '4250_[3-500]|cpu|PENDING|0:00|4:00:00|1|N/A|(QOSMaxJobsPerUserLimit)|sweep',
  '4250_1|cpu|RUNNING|5:00|4:00:00|1|2026-09-29T09:00:00|cpu17|sweep',
  ''
].join('\n')
const { jobs, truncated } = parseJobs(squeueMine, 'mine')
report(jobs.length === 3 && !truncated, 'parses every row, skipping blank lines')
report(jobs[0].name === 'train|resnet|v2', 'a job name containing | stays whole', jobs[0].name)
report(jobs[0].nodes === 2 && jobs[0].reason === 'gpu[01-02]', 'node count and node list')
report(
  jobs[1].id === '4250_[3-500]' && jobs[1].start === null,
  'collapsed array row, N/A start -> null'
)
report(jobs[0].user === undefined, "no user field for scope 'mine'")
const withUser = parseJobs(
  '77|gpu|alice|PENDING|0:00|1:00:00|1|2026-09-30T01:00:00|(Priority)|x',
  'partitions'
)
report(
  withUser.jobs[0].user === 'alice' && withUser.jobs[0].state === 'PENDING',
  "user field for scope 'partitions'"
)
const many = Array.from(
  { length: MAX_SLURM_JOBS + 5 },
  (_, i) => `${i}|cpu|PENDING|0:00|1:00|1|N/A|(Priority)|j`
)
const big = parseJobs(many.join('\n'), 'mine')
report(
  big.jobs.length === MAX_SLURM_JOBS && big.truncated,
  `caps parsing at ${MAX_SLURM_JOBS} jobs`
)

console.log('-- sinfo')
const partitions = parsePartitions(
  [
    'gpu|up|6|mixed',
    'gpu|up|2|drained*',
    'gpu|up|1|down*',
    'cpu|up|40|idle~',
    'cpu|up|8|allocated'
  ].join('\n')
)
const gpu = partitions.find((p) => p.name === 'gpu')
report(
  partitions.length === 2 && gpu?.totalNodes === 9,
  'folds per-state rows into one per partition'
)
report(gpu?.nodesByState.drained === 2 && gpu?.nodesByState.down === 1, 'drops state flags (* ~)')
const issues = parseNodeIssues('gpu07|drained|GPU XID 79 | reboot pending\n')
report(
  issues.length === 1 && issues[0].reason === 'GPU XID 79 | reboot pending',
  'drain reason containing | stays whole'
)

console.log('-- snapshot')
const snapshot = parseSnapshot(`${squeueMine}@@gateh@@\ngpu|up|6|mixed\n@@gateh@@\n`, 'mine')
report(
  snapshot.jobs.length === 3 &&
    snapshot.partitions.length === 1 &&
    snapshot.nodeIssues.length === 0,
  'splits the three sections'
)
report(
  throws(() => parseSnapshot('motd noise only', 'mine')),
  'refuses output without the section markers'
)

console.log('-- sacct')
const hist = historyCommand(7)
report(
  hist.includes('--user="$(id -un)"') &&
    hist.includes('--starttime=now-7days') &&
    hist.includes('--allocations'),
  "history is the user's own allocations over the range"
)
report(
  throws(() => historyCommand(30)) && throws(() => historyCommand(1.5)),
  'only the offered ranges are accepted'
)
const history = parseHistory(
  [
    '100|cpu|COMPLETED|0:0|00:10:00|2026-09-28T08:00:00|2026-09-28T08:10:00|prep',
    '101|gpu|CANCELLED by 1234|0:15|00:01:00|2026-09-28T09:00:00|2026-09-28T09:01:00|a|b',
    '102|gpu|RUNNING|0:0|00:05:00|2026-09-29T09:00:00|Unknown|train'
  ].join('\n')
)
report(history.length === 3 && history[0].id === '102', 'newest first')
report(
  history[0].end === null && history[2].end === '2026-09-28T08:10:00',
  'a running job has no end time'
)
report(
  history[1].state === 'CANCELLED by 1234' && history[1].name === 'a|b',
  'keeps the state suffix and a name containing |'
)

console.log('-- failures')
report(
  classifyFailure(127, 'bash: squeue: command not found').status === 'no-slurm',
  'missing squeue'
)
report(
  classifyFailure(1, 'squeue: error: Socket timed out on send/recv operation').status === 'busy',
  'slurmctld timeout backs off as busy'
)
const other = classifyFailure(1, 'first\nsqueue: error: Invalid user: nobody\n')
report(
  other.status === 'error' && other.message === 'squeue: error: Invalid user: nobody',
  'other errors show the last stderr line'
)

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
