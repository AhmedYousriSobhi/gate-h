// Checks for src/main/files/sftp.ts, run by test-pty-manager.mjs with the cluster store and live
// connections stubbed (see the runner's stub-sftp-deps plugin), over a fake ssh2 SFTP channel:
// no new connection or Teleport, one channel per connection (reopened after it closes), listing
// order, and transfer progress/completion/failure events.

import { EventEmitter } from 'events'
import { listDirectory, remoteExists, transfer } from '../src/main/files/sftp'
import type { FileTransferEvent } from '../src/shared/types'

interface Globals {
  __clusters: Record<string, unknown>
  __clients: Record<string, unknown>
}
const g = globalThis as unknown as Globals

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}
async function rejection(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (err) {
    return (err as Error).message
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const attrs = (dir: boolean, size = 0): object => ({
  size,
  mtime: 1727600000,
  isDirectory: () => dir,
  isSymbolicLink: () => false
})
class FakeSftp extends EventEmitter {
  realpath(path: string, cb: (e: Error | undefined, p: string) => void): void {
    cb(undefined, path === '.' ? '/home/me' : path)
  }
  readdir(_path: string, cb: (e: Error | undefined, list: unknown[]) => void): void {
    cb(undefined, [
      { filename: '.', attrs: attrs(true) },
      { filename: 'zeta.log', attrs: attrs(false, 10) },
      { filename: 'jobs', attrs: attrs(true) },
      { filename: 'alpha.sh', attrs: attrs(false, 5) },
      { filename: '..', attrs: attrs(true) }
    ])
  }
  stat(path: string, cb: (e: Error | undefined) => void): void {
    cb(path === '/home/me/alpha.sh' ? undefined : new Error('No such file'))
  }
  fastGet(
    remote: string,
    _local: string,
    opts: { step: (t: number, c: number, total: number) => void },
    cb: (e?: Error) => void
  ): void {
    let sent = 0
    const tick = setInterval(() => {
      sent += 100
      opts.step(sent, 100, 1000)
      if (sent >= 1000) {
        clearInterval(tick)
        cb(remote.endsWith('broken') ? new Error('Permission denied') : undefined)
      }
    }, 30)
  }
  fastPut(_local: string, _remote: string, _opts: unknown, cb: (e?: Error) => void): void {
    setTimeout(() => cb(), 10)
  }
}
let opened = 0
let current: FakeSftp | null = null
const client = {
  sftp: (cb: (e: Error | undefined, s: FakeSftp) => void) => {
    opened++
    current = new FakeSftp()
    cb(undefined, current)
  }
}

async function main(): Promise<void> {
  g.__clusters = {
    c: { id: 'c', teleport: null },
    tp: { id: 'tp', teleport: { proxy: 'tp.example.com' } },
    idle: { id: 'idle', teleport: null }
  }
  g.__clients = { c: client }

  console.log('-- sessions')
  report(
    /Teleport/.test((await rejection(listDirectory('tp'))) ?? ''),
    'Teleport clusters are refused'
  )
  report(
    /terminal session/.test((await rejection(listDirectory('idle'))) ?? ''),
    'no live connection: nothing opens'
  )

  console.log('-- listing')
  const home = await listDirectory('c')
  report(home.path === '/home/me', 'defaults to the remote home directory')
  report(
    home.entries.map((e) => e.name).join(',') === 'jobs,alpha.sh,zeta.log',
    'folders first, then by name, without . and ..',
    home.entries.map((e) => e.name).join(',')
  )
  await listDirectory('c', '/scratch')
  report(opened === 1, 'one SFTP channel per connection, reused')
  current?.emit('close')
  await listDirectory('c')
  report(opened === 2, 'a closed channel is reopened on next use')
  report(
    (await remoteExists('c', '/home/me/alpha.sh')) && !(await remoteExists('c', '/home/me/new')),
    'checks whether a file exists'
  )

  console.log('-- transfers')
  const events: FileTransferEvent[] = []
  await transfer('c', 'download', '/home/me/zeta.log', '/tmp/zeta.log', (e) => events.push(e))
  report(
    events[0]?.transferred === 0 && !events[0].done && events[0].name === 'zeta.log',
    'announces the transfer when it starts'
  )
  const progress = events.filter((e) => !e.done && e.transferred > 0)
  report(
    progress.length >= 1 && progress.length < 10,
    `progress is throttled (${progress.length} of 10 steps sent)`
  )
  report(
    events[events.length - 1]?.done === true && !events[events.length - 1].error,
    'ends with a done event'
  )
  const failed: FileTransferEvent[] = []
  const error = await rejection(
    transfer('c', 'download', '/home/me/broken', '/tmp/x', (e) => failed.push(e))
  )
  report(
    error === 'Permission denied' && failed[failed.length - 1]?.error === 'Permission denied',
    'a failure is reported and rejects'
  )
  await sleep(10)
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
