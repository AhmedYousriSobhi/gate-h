// Checks for src/main/scheduler/slurm.ts, run by test-pty-manager.mjs: the fixed squeue/sinfo
// commands, and parsing their output as real sites print it (free-text fields containing the
// delimiter, collapsed job arrays, sinfo state flags, error classification).

import {
  arrayTasksCommand,
  classifyFailure,
  historyCommand,
  parseGres,
  parseHistory,
  parseJobs,
  parseNodeIssues,
  parseNodes,
  parsePartitions,
  parseSnapshot,
  snapshotCommand,
  totalGpuCapacity,
  type SlurmData
} from '../src/main/scheduler/slurm'
import { describeChanges } from '../src/main/scheduler/changes'
import { MAX_SLURM_JOBS, type SchedulerConfig, type SlurmJob } from '../src/shared/types'

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
  (mineCmd.match(/ && /g) ?? []).length === 6,
  'one chained exec with the first failure as its status'
)
const partCmd = snapshotCommand(byPartition)
report(
  !partCmd.includes('--user') && (partCmd.match(/'--partition=gpu,cpu'/g) ?? []).length === 1,
  "scope 'partitions' shows every user's jobs, but only in the named partitions - sinfo stays cluster-wide",
  partCmd
)
report(
  !throws(() => snapshotCommand({ ...byPartition, partitions: [] })),
  "scope 'partitions' with no partition lists the whole queue"
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

console.log('-- node inventory')
const gresGpu = parseGres('gpu:a100:4')
report(
  gresGpu.length === 1 && gresGpu[0].type === 'a100' && gresGpu[0].count === 4,
  'gpu:<model>:<count> parses to type+count'
)
report(parseGres('gpu:2')[0].type === 'gpu', 'gpu:<count> with no model defaults the type to gpu')
report(parseGres('(null)').length === 0, 'no GRES configured parses to nothing')
report(parseGres('license:matlab:2').length === 0, 'a non-GPU GRES entry is skipped, not guessed')
const nodes = parseNodes(
  [
    'gpu01|gpu|idle|0/64/0/64|257542|gpu:a100:4|none',
    'gpu01|debug|idle|0/64/0/64|257542|gpu:a100:4|none',
    'cpu01|cpu|mixed|12/52/0/64|128771|(null)|none',
    'bad01|cpu|idle|not-four-slashes|128771|(null)|none'
  ].join('\n')
)
report(nodes.length === 3, 'one SlurmNode per unique node name')
const gpu01 = nodes.find((n) => n.name === 'gpu01')
report(
  gpu01?.partitions.length === 2 &&
    gpu01.partitions.includes('gpu') &&
    gpu01.partitions.includes('debug'),
  'a node in several partitions keeps all of them, once'
)
report(
  gpu01?.cpusAllocated === 0 && gpu01?.cpusTotal === 64 && gpu01?.gpus[0]?.count === 4,
  'parses CPU alloc/total and GPU GRES'
)
const down01 = parseNodes('dn01|cpu|drained*|0/0/64/64|1|(null)|NHC: GPU-0 has | to be reset')[0]
report(
  down01?.reason === 'NHC: GPU-0 has | to be reset',
  'keeps a drain reason that itself contains the delimiter'
)
const bad01 = nodes.find((n) => n.name === 'bad01')
report(
  bad01?.cpusAllocated === null && bad01?.cpusTotal === null,
  "a %C field that isn't alloc/idle/other/total gives null CPU counts, not a crash"
)
report(
  totalGpuCapacity(nodes) === 4,
  'total GPU capacity sums every node once, not once per partition row'
)

console.log('-- snapshot')
const nodeRow = 'cpu01|cpu|idle|0/4/0/4|8192|(null)|none'
const snapshot = parseSnapshot(
  `${squeueMine}@@gateh@@\ngpu|up|6|mixed\n@@gateh@@\n@@gateh@@\n${nodeRow}\n`,
  'mine'
)
report(
  snapshot.jobs.length === 3 &&
    snapshot.partitions.length === 1 &&
    snapshot.nodeIssues.length === 0 &&
    snapshot.nodes.length === 1,
  'splits the four sections'
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
  historyCommand(1, true).includes('--allusers') && !historyCommand(1, true).includes('--user'),
  'all-users history drops the user filter'
)
report(
  throws(() => historyCommand(30)) && throws(() => historyCommand(1.5)),
  'only the offered ranges are accepted'
)
const history = parseHistory(
  [
    '100|alice|cpu|COMPLETED|0:0|00:10:00|2026-09-28T08:00:00|2026-09-28T08:10:00|00:05:00|2|prep',
    '101|bob|gpu|CANCELLED by 1234|0:15|00:01:00|2026-09-28T09:00:00|2026-09-28T09:01:00||1|a|b',
    '102|alice|gpu|RUNNING|0:0|00:05:00|2026-09-29T09:00:00|Unknown|00:20:00|4|train'
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
report(
  history[2].id === '100' && history[2].cpuEfficiencyPct === 25,
  '300s of 600s x 2 CPUs is 25% efficiency',
  JSON.stringify(history[2])
)
report(
  history[1].cpuEfficiencyPct === null,
  'an empty TotalCPU (job cancelled before it ran) gives null, not 0%',
  JSON.stringify(history[1])
)
report(
  history[0].cpuEfficiencyPct === 100,
  '1200s of 300s x 4 CPUs (still running) is 100% efficiency',
  JSON.stringify(history[0])
)

console.log('-- changes')
const job = (id: string, state = 'RUNNING', user?: string): SlurmJob => ({
  id,
  partition: 'cpu',
  ...(user && { user }),
  state,
  elapsed: '1:00',
  timeLimit: '2:00',
  nodes: 1,
  start: null,
  reason: 'cpu01',
  name: `j${id}`
})
const data = (jobs: SlurmJob[], extra: Partial<SlurmData> = {}): SlurmData => ({
  jobs,
  truncated: false,
  partitions: [],
  nodeIssues: [],
  nodes: [],
  ...extra
})
const burst = describeChanges(
  data(['1', '2', '3', '4', '5'].map((id) => job(id))),
  data([]),
  new Map([
    ['1', { state: 'COMPLETED', exitCode: '0:0' }],
    ['2', { state: 'COMPLETED', exitCode: '0:0' }],
    ['3', { state: 'FAILED', exitCode: '1:0' }]
  ])
)
report(
  burst.length === 1 &&
    burst[0].severity === 'warning' &&
    burst[0].message === '5 jobs finished: 2 completed, 1 failed, 2 left the queue',
  'a burst of finished jobs becomes one summary',
  JSON.stringify(burst)
)
report(
  describeChanges(data([job('1')]), data([], { truncated: true }), null).length === 0,
  'a truncated snapshot never reports jobs as finished'
)
report(
  describeChanges(data([job('9_[2-50]', 'PENDING')]), data([job('9_[3-50]', 'PENDING')]), null)
    .length === 0,
  'collapsed array rows changing id are not reported'
)
report(
  describeChanges(
    data([job('7', 'PENDING', 'alice')]),
    data([job('7', 'RUNNING', 'alice')]),
    null,
    'me'
  ).length === 0,
  "other users' jobs (partition scope) are never reported"
)
const cancelled = describeChanges(
  data([job('8')]),
  data([]),
  new Map([['8', { state: 'CANCELLED by 1234', exitCode: '0:15' }]])
)
report(
  cancelled[0]?.message === 'Job 8 (j8) was cancelled (exit code 0:15)',
  'a cancelled job',
  cancelled[0]?.message
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
