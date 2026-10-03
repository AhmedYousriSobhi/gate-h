// Checks for src/main/scheduler/exec.ts, run by test-pty-manager.mjs with the session lookups
// stubbed (see the runner's stub-exec-deps plugin): output and exit codes over a fake ssh2
// channel and a local process, the timeout and output cap, one command at a time per cluster, and
// that nothing runs without a live session. Takes ~15s: the timeout checks wait out the real one.

import { EventEmitter } from 'events'
import {
  asLoginShell,
  NoSessionError,
  runOnCluster,
  sshHopCommand
} from '../src/main/scheduler/exec'

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
  stdin: string | null = null
  end(data?: string): void {
    this.stdin = data ?? ''
  }
  close(): void {
    this.closed = true
    this.emit('close')
  }
}
/** An ssh2 Client stand-in: each exec() plays the next script on a fresh channel. */
function fakeClient(scripts: Script[]): {
  exec: unknown
  end: () => void
  ended: boolean
  commands: string[]
  channels: FakeChannel[]
  open: () => number
  maxOpen: number
} {
  const state = {
    commands: [] as string[],
    channels: [] as FakeChannel[],
    maxOpen: 0,
    ended: false,
    end: () => {
      state.ended = true
    },
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
const throws = (fn: () => unknown): boolean => {
  try {
    fn()
    return false
  } catch {
    return true
  }
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
const sshWithExecTarget = (id: string, execTarget: { host: string; port?: number }): never =>
  ({
    id,
    name: id,
    teleport: null,
    connection: { host: 'login', port: 22, username: 'u', authMethod: 'agent' },
    scheduler: {
      kind: 'slurm',
      scope: 'mine',
      partitions: [],
      intervalSec: 60,
      autoRefresh: true,
      execTarget
    }
  }) as never
const teleportWithExecTarget = (id: string, execTarget: { host: string; port?: number }): never =>
  ({
    id,
    name: id,
    teleport: { proxy: 'tp.example.com' },
    connection: { host: 'primary-node', port: 22, username: 'u', authMethod: 'agent' },
    scheduler: {
      kind: 'slurm',
      scope: 'mine',
      partitions: [],
      intervalSec: 60,
      autoRefresh: true,
      execTarget
    }
  }) as never

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
  report(
    client.commands[0] === asLoginShell('squeue'),
    'runs the exact command on the existing connection'
  )
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
  const withInput = fakeClient([finish('4242\n')])
  g.__clients = { c2: withInput }
  await runOnCluster(ssh('c2'), 'sbatch --parsable', '#!/bin/bash\necho hi\n')
  report(
    withInput.channels[0].stdin === '#!/bin/bash\necho hi\n',
    'stdin is written to the channel and closed'
  )
  report(
    client.channels.every((c) => c.stdin === null),
    'without stdin, nothing is written'
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
  const piped = await runOnCluster(teleport('tp'), 'cat', 'script body\n')
  report(piped.stdout === 'script body\n', 'stdin reaches the Teleport process')
  const noInput = await runOnCluster(teleport('tp'), 'cat')
  report(
    noInput.stdout === '' && noInput.exitCode === 0,
    'without stdin, it reads end-of-file at once'
  )
  const noLogin = await rejection(runOnCluster(teleport('tp'), 'exit 4'))
  report(
    noLogin instanceof NoSessionError,
    "the wrapper's no-session exit code maps to NoSessionError"
  )

  console.log('-- Slurm execTarget')
  const primary = fakeClient([finish('nodes\n')])
  g.__clients = { et1: primary }
  const etResult = await runOnCluster(
    sshWithExecTarget('et1', { host: 'slurm-ctl', port: 2222 }),
    'sinfo'
  )
  report(etResult.stdout === 'nodes\n', 'runs through ssh from the connected node')
  report(
    primary.commands[0] ===
      `ssh -o BatchMode=yes -o ConnectTimeout=10 -p 2222 -- slurm-ctl '${asLoginShell('sinfo').replace(/'/g, `'\\''`)}'`,
    'the hop command is a non-interactive ssh to the target with the quoted command',
    primary.commands[0]
  )
  report(
    throws(() => sshHopCommand({ host: '-oProxyCommand=x' }, 'sinfo')) &&
      throws(() => sshHopCommand({ host: 'a b' }, 'sinfo')) &&
      throws(() => sshHopCommand({ host: 'node', port: 22.5 }, 'sinfo')),
    'a host that could read as an option or a bad port is refused'
  )

  g.__teleport = {
    ...g.__teleport,
    tp2: { clusterId: 'tp2', validUntil: new Date(Date.now() + 3_600_000).toISOString() }
  }
  const tpTarget = await runOnCluster(
    teleportWithExecTarget('tp2', { host: 'other-node' }),
    'echo hi'
  )
  report(
    /TARGET=other-node/.test(tpTarget.stderr),
    'a Teleport execTarget threads the target host through teleportExecCommand'
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
