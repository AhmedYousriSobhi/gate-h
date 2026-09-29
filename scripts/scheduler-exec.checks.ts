// Checks for src/main/scheduler/exec.ts, run by test-pty-manager.mjs with the session lookups
// stubbed (see the runner's stub-exec-deps plugin): output and exit codes over a fake ssh2
// channel and a local process, the timeout and output cap, one command at a time per cluster, and
// that nothing runs without a live session. Takes ~15s: the timeout checks wait out the real one.

import { EventEmitter } from 'events'
import { NoSessionError, runOnCluster } from '../src/main/scheduler/exec'

interface Globals {
  __clients: Record<string, unknown>
  __teleport: Record<string, { clusterId: string; validUntil: string | null }>
}
const g = globalThis as unknown as Globals

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}

type Script = (stream: FakeChannel) => void
class FakeChannel extends EventEmitter {
  stderr = new EventEmitter()
  closed = false
  close(): void {
    this.closed = true
    this.emit('close')
  }
}
/** An ssh2 Client stand-in: each exec() plays the next script on a fresh channel. */
function fakeClient(scripts: Script[]): {
  exec: unknown
  commands: string[]
  channels: FakeChannel[]
  open: () => number
  maxOpen: number
} {
  const state = {
    commands: [] as string[],
    channels: [] as FakeChannel[],
    maxOpen: 0,
    open: () => state.channels.filter((c) => !c.closed).length,
    exec: (command: string, cb: (err: Error | undefined, stream: FakeChannel) => void) => {
      state.commands.push(command)
      const channel = new FakeChannel()
      channel.once('close', () => (channel.closed = true))
      state.channels.push(channel)
      state.maxOpen = Math.max(state.maxOpen, state.open())
      cb(undefined, channel)
      const script = scripts.shift()
      setImmediate(() => script?.(channel))
    }
  }
  return state
}
const finish =
  (stdout: string, stderr = '', code = 0, delay = 0): Script =>
  (ch) =>
    setTimeout(() => {
      if (stdout) ch.emit('data', Buffer.from(stdout))
      if (stderr) ch.stderr.emit('data', Buffer.from(stderr))
      ch.emit('exit', code)
      ch.emit('close')
    }, delay)

const ssh = (id: string): never => ({ id, name: id, teleport: null }) as never
const teleport = (id: string): never =>
  ({ id, name: id, teleport: { proxy: 'tp.example.com' } }) as never

async function rejection(p: Promise<unknown>): Promise<Error | null> {
  try {
    await p
    return null
  } catch (err) {
    return err as Error
  }
}

async function main(): Promise<void> {
  g.__teleport = {}
  console.log('-- ssh2 channel')
  const client = fakeClient([
    finish('out\n', 'warn\n', 0),
    finish('', 'squeue: error\n', 1),
    finish('a', '', 0, 50),
    finish('b', '', 0, 0)
  ])
  g.__clients = { c1: client }
  const ok = await runOnCluster(ssh('c1'), 'squeue')
  report(
    ok.exitCode === 0 && ok.stdout === 'out\n' && ok.stderr === 'warn\n',
    'collects stdout, stderr and the exit code'
  )
  report(client.commands[0] === 'squeue', 'runs the exact command on the existing connection')
  const failed = await runOnCluster(ssh('c1'), 'squeue')
  report(
    failed.exitCode === 1,
    'a failing command resolves with its exit code rather than throwing'
  )
  const [first, second] = await Promise.all([
    runOnCluster(ssh('c1'), 'one'),
    runOnCluster(ssh('c1'), 'two')
  ])
  report(first.stdout === 'a' && second.stdout === 'b', 'queued runs each get their own output')
  report(
    client.maxOpen === 1,
    'never more than one scheduler channel open per cluster',
    `max ${client.maxOpen}`
  )

  console.log('-- no session')
  g.__clients = {}
  const none = await rejection(runOnCluster(ssh('gone'), 'squeue'))
  report(none instanceof NoSessionError, 'no live terminal session: NoSessionError, nothing runs')
  g.__teleport = { tp: { clusterId: 'tp', validUntil: new Date(Date.now() - 1000).toISOString() } }
  const expired = await rejection(runOnCluster(teleport('tp'), 'echo should-not-run'))
  report(
    expired instanceof NoSessionError,
    'expired Teleport session: NoSessionError without spawning'
  )

  console.log('-- teleport process')
  g.__teleport = {
    tp: { clusterId: 'tp', validUntil: new Date(Date.now() + 3_600_000).toISOString() }
  }
  const tp = await runOnCluster(teleport('tp'), 'echo hello; echo oops >&2; exit 3')
  report(
    tp.exitCode === 3 && tp.stdout === 'hello\n' && tp.stderr === 'oops\n',
    'runs the command, with output and exit code'
  )
  const noLogin = await rejection(runOnCluster(teleport('tp'), 'exit 4'))
  report(
    noLogin instanceof NoSessionError,
    "the wrapper's no-session exit code maps to NoSessionError"
  )

  console.log('-- limits')
  const big = fakeClient([
    (ch) => {
      ch.emit('data', Buffer.alloc(600 * 1024, 97))
      ch.emit('data', Buffer.alloc(600 * 1024, 97))
    },
    () => undefined
  ])
  g.__clients = { big, hung: fakeClient([() => undefined]) }
  const capped = await rejection(runOnCluster(ssh('big'), 'squeue'))
  report(
    /1 MiB/.test(capped?.message ?? '') && big.channels[0].closed,
    'output over 1 MiB fails and closes the channel'
  )
  const started = Date.now()
  const [sshHung, tpHung] = await Promise.all([
    rejection(runOnCluster(ssh('hung'), 'squeue')),
    rejection(runOnCluster(teleport('tp'), 'sleep 60'))
  ])
  const took = Date.now() - started
  report(
    /No answer/.test(sshHung?.message ?? '') && took < 16_500,
    'a hung channel times out at 15s',
    `${took}ms`
  )
  report(/No answer/.test(tpHung?.message ?? ''), 'a hung Teleport process times out and is killed')
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
