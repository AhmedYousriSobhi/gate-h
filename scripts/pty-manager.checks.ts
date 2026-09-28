// Checks for src/main/pty/manager.ts and the Teleport PTY session, run by test-pty-manager.mjs
// under Electron's own Node, so node-pty is loaded as the Electron-ABI build the app uses. No
// window is needed.
//
// Set TELEPORT_LAB_PROXY (plus TELEPORT_LAB_NODE, TELEPORT_LAB_LOGIN, TELEPORT_LAB_USER) to also
// run a real `tsh ssh` session through resources/teleport.sh. That needs a valid tsh session for
// the proxy already, since nobody is there to answer a login prompt.

import { PtyManager, type PtyExit } from '../src/main/pty/manager'
import { TeleportPreflight, teleportSshCommand } from '../src/main/teleport/session'
import type { ClusterSummary } from '../src/shared/types'

const manager = new PtyManager()
let failures = 0

function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}

interface Run {
  id: string
  output: () => string
  exited: Promise<PtyExit>
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<boolean>
}

function run(file: string, args: string[], size?: { cols: number; rows: number }): Run {
  let output = ''
  const waiters: Array<() => void> = []
  let resolveExit!: (exit: PtyExit) => void
  const exited = new Promise<PtyExit>((resolve) => (resolveExit = resolve))
  const id = manager.spawn(
    { file, args, ...size },
    {
      onData: (chunk) => {
        output += chunk
        waiters.forEach((w) => w())
      },
      onExit: resolveExit
    }
  )
  return {
    id,
    output: () => output,
    exited,
    waitFor: (pattern, timeoutMs = 10000) =>
      new Promise((resolve) => {
        const check = (): void => {
          if (pattern.test(output)) resolve(true)
        }
        waiters.push(check)
        check()
        setTimeout(() => resolve(false), timeoutMs)
      })
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([promise, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])
}

async function local(): Promise<void> {
  console.log('-- PtyManager')
  {
    const r = run('bash', ['-c', 'echo "size=$(tput cols)x$(tput lines) term=$TERM"'], {
      cols: 100,
      rows: 30
    })
    await r.exited
    report(
      /size=100x30 term=xterm-256color/.test(r.output()),
      'spawns at the requested size, with TERM set',
      r.output()
    )
  }
  {
    const r = run('bash', [
      '-c',
      'trap \'echo "winch=$(tput cols)x$(tput lines)"\' WINCH; echo ready; while :; do sleep 0.1; done'
    ])
    await r.waitFor(/ready/)
    manager.resize(r.id, 132, 43)
    report(
      await r.waitFor(/winch=132x43/),
      'resize reaches the process (SIGWINCH + new size)',
      r.output()
    )
    manager.resize(r.id, 0, 0)
    report(
      await r.waitFor(/winch=2x1/),
      'a 0x0 resize is clamped instead of zeroing the terminal',
      r.output()
    )
    manager.kill(r.id)
    await r.exited
  }
  {
    const r = run('bash', ['-c', 'read -r line; echo "got:$line"'])
    await new Promise((res) => setTimeout(res, 200))
    manager.write(r.id, 'hello pty\r')
    report(
      await r.waitFor(/got:hello pty/),
      'input written to the PTY reaches the process',
      r.output()
    )
    await r.exited
  }
  {
    const r = run('bash', ['-c', 'printf "\\033[31mred\\033[0m\\n"; exit 3'])
    const exit = await r.exited
    report(exit.exitCode === 3, 'exit code is reported', JSON.stringify(exit))
    report(r.output().includes('\x1b[31mred'), 'color escape sequences pass through untouched')
    report(!manager.has(r.id), 'an exited session is forgotten')
    manager.resize(r.id, 80, 24)
    manager.write(r.id, 'x')
    manager.kill(r.id)
    report(true, 'write/resize/kill after exit are harmless no-ops')
  }
  {
    const r = run('bash', ['-c', 'echo ready; while :; do sleep 0.1; done'])
    await r.waitFor(/ready/)
    manager.kill(r.id)
    const exit = await withTimeout(r.exited, 2000)
    report(
      exit !== 'timeout' && exit.signal === 1,
      'kill hangs up the process (SIGHUP)',
      JSON.stringify(exit)
    )
  }
  {
    const r = run('bash', ['-c', 'trap "" HUP; echo ready; while :; do sleep 0.1; done'])
    await r.waitFor(/ready/)
    const started = Date.now()
    manager.kill(r.id)
    const exit = await withTimeout(r.exited, 6000)
    report(
      exit !== 'timeout' && exit.signal === 9 && Date.now() - started >= 2500,
      'a process ignoring SIGHUP is SIGKILLed after the grace period',
      JSON.stringify(exit)
    )
  }
  {
    let threw = ''
    let exit: PtyExit | 'timeout' | null = null
    try {
      const r = run('/nonexistent/gate-h-binary', [])
      exit = await withTimeout(r.exited, 3000)
    } catch (err) {
      threw = (err as Error).message
    }
    report(
      threw !== '' || (exit !== null && exit !== 'timeout' && exit.exitCode !== 0),
      'a missing executable fails the spawn instead of hanging',
      threw || JSON.stringify(exit)
    )
  }
  {
    const r = run('bash', ['-c', 'echo "a=$(printf "\\xc3")$(printf "\\xa9")"'])
    await r.exited
    report(
      r.output().includes('a=é'),
      'multi-byte UTF-8 split across writes is decoded whole',
      JSON.stringify(r.output())
    )
  }

  console.log('-- TeleportPreflight')
  {
    const p = new TeleportPreflight()
    p.feed('STATUS check Checking\r\nSTATUS er')
    p.feed('ror Teleport proxy x is unreachable\r\n')
    report(
      p.error === 'Teleport proxy x is unreachable',
      'reads an error line split across chunks',
      String(p.error)
    )
  }
  {
    const p = new TeleportPreflight()
    p.feed('STATUS valid Logged in\r\n')
    p.feed('STATUS error printed by the remote shell\r\n')
    report(p.error === null, 'ignores everything after the session check passes')
  }
  {
    // Port 1 on localhost refuses at once. Without tsh installed this exits 3 instead of 6 -
    // either way the session must fail with the wrapper's reason recorded.
    const cluster = {
      name: 'unreachable',
      connection: { host: 'node', username: 'user' },
      teleport: { proxy: '127.0.0.1:1' }
    } as unknown as ClusterSummary
    const command = teleportSshCommand(cluster)
    const p = new TeleportPreflight()
    const r = run(command.file, command.args)
    const exit = await withTimeout(r.exited, 30000)
    p.feed(r.output())
    report(
      exit !== 'timeout' && exit.exitCode !== 0 && p.error !== null,
      'a session that fails its check exits non-zero with the reason recorded',
      `${JSON.stringify(exit)} error=${p.error}`
    )
  }
}

async function lab(): Promise<void> {
  const proxy = process.env.TELEPORT_LAB_PROXY
  if (!proxy) {
    console.log('-- Teleport lab: skipped (TELEPORT_LAB_PROXY not set)')
    return
  }
  console.log(`-- Teleport lab (${proxy})`)
  const cluster = {
    name: 'lab',
    connection: {
      host: process.env.TELEPORT_LAB_NODE ?? 'compute-node',
      username: process.env.TELEPORT_LAB_LOGIN ?? 'vagrant'
    },
    teleport: { proxy, user: process.env.TELEPORT_LAB_USER }
  } as unknown as ClusterSummary
  const command = teleportSshCommand(cluster)
  const r = run(command.file, command.args, { cols: 120, rows: 30 })
  const preflight = new TeleportPreflight()
  report(
    await r.waitFor(/STATUS valid/, 20000),
    'wrapper session check passes inside the PTY',
    r.output()
  )
  report(
    await r.waitFor(/\$ $/m, 20000),
    'tsh ssh hands over to a remote shell prompt',
    r.output().slice(-300)
  )
  manager.write(r.id, 'echo "remote=$(hostname) $(tput cols)x$(tput lines)"\r')
  report(
    await r.waitFor(/remote=\S+ 120x30/),
    'remote shell sees the PTY size',
    r.output().slice(-300)
  )
  manager.resize(r.id, 150, 45)
  await new Promise((res) => setTimeout(res, 1000))
  manager.write(r.id, 'echo "resized=$(tput cols)x$(tput lines)"\r')
  report(
    await r.waitFor(/resized=150x45/),
    'a resize reaches the remote shell through tsh',
    r.output().slice(-300)
  )
  manager.write(r.id, 'exit 0\r')
  const exit = await withTimeout(r.exited, 10000)
  report(
    exit !== 'timeout' && exit.exitCode === 0,
    'exiting the remote shell ends the session with 0',
    JSON.stringify(exit)
  )
  preflight.feed(r.output())
  report(preflight.error === null, 'no pre-flight error recorded')

  const k = run(command.file, command.args)
  await k.waitFor(/\$ $/m, 20000)
  manager.kill(k.id)
  const killed = await withTimeout(k.exited, 5000)
  report(
    killed !== 'timeout',
    'killing a live tsh session ends it promptly',
    JSON.stringify(killed)
  )
}

local()
  .then(lab)
  .then(() => {
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
    process.exit(failures ? 1 : 0)
  })
