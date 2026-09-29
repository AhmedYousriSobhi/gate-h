// Checks for src/main/scheduler/monitor.ts, run by test-pty-manager.mjs with the cluster store
// and the command runner stubbed (see the runner's stub-scheduler plugin). Covers what keeps load
// off slurmctld: nothing polls unless watched, manual refresh stays manual, backoff on failure,
// the manual-refresh throttle, and that unwatching leaves no timers behind.

import { live } from './resource-probe.checks'
import {
  fetchArrayTasks,
  refreshScheduler,
  setSchedulerBroadcaster,
  stopSchedulerMonitor,
  unwatchScheduler,
  watchScheduler
} from '../src/main/scheduler/monitor'
import type { SchedulerConfig, SchedulerSnapshot } from '../src/shared/types'

interface Globals {
  __clusters: Record<string, unknown>
  __run: (
    cluster: { id: string },
    command: string,
    noSession: new (m: string) => Error
  ) => Promise<unknown>
}
const g = globalThis as unknown as Globals

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const OUTPUT = '1|cpu|RUNNING|1:00|2:00|1|N/A|cpu01|job\n@@gateh@@\ncpu|up|4|idle\n@@gateh@@\n'
let runs = 0
let exitCode = 0
let session = true
g.__run = async (_cluster, _command, NoSessionError) => {
  if (!session) throw new NoSessionError('Waiting for a terminal session.')
  runs++
  return {
    exitCode,
    stdout: exitCode === 0 ? OUTPUT : '',
    stderr: 'squeue: error: Socket timed out'
  }
}
function config(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    kind: 'slurm',
    scope: 'mine',
    partitions: [],
    intervalSec: 30,
    autoRefresh: true,
    ...overrides
  }
}
g.__clusters = {
  auto: { id: 'auto', activeMonitoring: true, scheduler: config() },
  manual: { id: 'manual', activeMonitoring: true, scheduler: config({ autoRefresh: false }) },
  standby: { id: 'standby', activeMonitoring: false, scheduler: config() },
  none: { id: 'none', activeMonitoring: true, scheduler: null }
}
const snapshots: SchedulerSnapshot[] = []
setSchedulerBroadcaster((s) => snapshots.push(s))
const last = (id: string): SchedulerSnapshot | undefined =>
  [...snapshots].reverse().find((s) => s.clusterId === id)

async function main(): Promise<void> {
  const baseline = live.timers.size

  console.log('-- nothing runs unless watched')
  await sleep(50)
  report(runs === 0 && snapshots.length === 0, 'no runs and no broadcasts before any watch')
  watchScheduler('none')
  watchScheduler('standby')
  await sleep(50)
  report(runs === 0, 'a cluster without a scheduler, or in standby, never runs')
  unwatchScheduler('none')
  unwatchScheduler('standby')

  console.log('-- auto refresh')
  watchScheduler('auto')
  await sleep(50)
  report(runs === 1 && last('auto')?.status === 'ok', 'first watch runs once and publishes ok')
  report(
    last('auto')?.jobs.length === 1 && last('auto')?.nextRefreshAt !== null,
    'parsed jobs and a next refresh time'
  )
  refreshScheduler('auto')
  await sleep(50)
  report(runs === 1, 'manual refresh within 10s of the last run is ignored')
  unwatchScheduler('auto')
  watchScheduler('auto')
  await sleep(50)
  report(
    runs === 1 && last('auto')?.status === 'ok',
    'watching again within the interval reuses the cached snapshot'
  )
  unwatchScheduler('auto')

  console.log('-- manual refresh (Teleport default)')
  watchScheduler('manual')
  await sleep(50)
  report(
    runs === 2 && last('manual')?.nextRefreshAt === null,
    'first watch runs once, then nothing is scheduled'
  )
  unwatchScheduler('manual')
  watchScheduler('manual')
  await sleep(50)
  report(runs === 2, 'selecting the cluster again does not cost another run')
  unwatchScheduler('manual')

  console.log('-- waiting and failures')
  g.__clusters.auto = { id: 'auto', activeMonitoring: true, scheduler: config({ intervalSec: 31 }) }
  session = false
  watchScheduler('auto')
  await sleep(50)
  report(
    runs === 2 && last('auto')?.status === 'waiting',
    'no live session: waits without running anything'
  )
  session = true
  exitCode = 1
  unwatchScheduler('auto')
  watchScheduler('auto')
  await sleep(50)
  const failed = last('auto')
  report(runs === 3 && failed?.status === 'busy', 'a slurmctld timeout is reported as busy')
  const delay = failed?.nextRefreshAt ? Date.parse(failed.nextRefreshAt) - Date.now() : 0
  report(delay > 60_000, 'a failure backs off beyond the normal interval', `next in ${delay}ms`)
  unwatchScheduler('auto')

  console.log('-- array tasks')
  exitCode = 0
  const before = runs
  const [a, b] = await Promise.all([fetchArrayTasks('auto', '1'), fetchArrayTasks('auto', '1')])
  await fetchArrayTasks('auto', '1')
  report(
    runs === before + 1 && a.length === 1 && b === a,
    'expanding an array again within 30s reuses the result'
  )
  await fetchArrayTasks('auto', '2')
  report(runs === before + 2, 'a different array runs its own query')

  console.log('-- idle cost')
  await sleep(50)
  report(
    live.timers.size === baseline,
    'unwatching every cluster leaves no timers',
    `${live.timers.size} live, ${baseline} before`
  )
  stopSchedulerMonitor()
}

main()
  .catch((err) => {
    console.error(err)
    failures++
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
    process.exit(failures ? 1 : 0)
  })
