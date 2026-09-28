// Checks for src/main/teleport/sessionState.ts, run by test-pty-manager.mjs with a fake `tsh` on
// PATH, HOME pointing at a scratch directory, and the cluster/notification stores stubbed (see
// the runner's stub plugin). Covers session matching, the 15-minute warning and expiry timers,
// the ~/.tsh watcher and its debounce, and that nothing keeps running once it's idle.

import { live } from './resource-probe.checks'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  findValidUntil,
  getTeleportSessions,
  refreshTeleportSessions,
  startTeleportSessionMonitor,
  stopTeleportSessionMonitor
} from '../src/main/teleport/sessionState'
import type { TeleportSessionInfo } from '../src/shared/types'

interface Stubs {
  __clusters: unknown[]
  __notifications: Array<{ clusterId: string; message: string }>
}
const stubs = globalThis as unknown as Stubs
const tshDir = join(homedir(), '.tsh')
const statusFile = join(homedir(), 'status.json')
const callsFile = join(homedir(), 'tsh-calls')

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const tshCalls = (): number => {
  try {
    return readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}
function profile(proxy: string, user: string, inMs: number): object {
  const at = new Date(Date.now() + inMs).toISOString().replace('Z', '123456Z')
  return { profile_url: `https://${proxy}:443`, username: user, valid_until: at }
}
function writeStatus(active: object | null, others: object[] = []): void {
  writeFileSync(statusFile, JSON.stringify({ active, profiles: others }))
}
function cluster(id: string, proxy: string, user?: string): object {
  return { id, name: id, teleport: { proxy, user } }
}

async function main(): Promise<void> {
  console.log('-- session matching')
  const status = {
    active: profile('other.example.com', 'bob', 3_600_000),
    profiles: [profile('tp.example.com', 'alice', 3_600_000)]
  }
  report(
    findValidUntil(status, 'tp.example.com:443') !== null,
    'finds a non-active profile by proxy host'
  )
  report(findValidUntil(status, 'https://TP.example.com') !== null, 'ignores scheme, port and case')
  report(
    findValidUntil(status, 'tp.example.com', 'carol') === null,
    'a different user has no session'
  )
  report(findValidUntil({}, 'tp.example.com') === null, 'no profiles at all means no session')

  console.log('-- monitor')
  mkdirSync(tshDir, { recursive: true })
  const broadcasts: Array<Record<string, TeleportSessionInfo>> = []
  stubs.__notifications = []

  stubs.__clusters = []
  startTeleportSessionMonitor((s) => broadcasts.push({ ...s }))
  await refreshTeleportSessions()
  report(tshCalls() === 0, 'with no Teleport clusters, tsh is never run')

  // a + b share a proxy and user, so they share one session; c is on another proxy.
  stubs.__clusters = [
    cluster('a', 'tp.example.com:443', 'alice'),
    cluster('b', 'tp.example.com', 'alice'),
    cluster('c', 'short.example.com:443', 'alice')
  ]
  // tp: 15 min + 2 s left, so the warning is due in ~2 s. short: 3 s left - already inside
  // the warning window, and expiring during the test.
  writeStatus(profile('tp.example.com', 'alice', 15 * 60_000 + 2000), [
    profile('short.example.com', 'alice', 3000)
  ])
  await refreshTeleportSessions()
  const s = getTeleportSessions()
  report(
    s.a?.validUntil !== null && s.a?.validUntil === s.b?.validUntil,
    'clusters sharing a proxy and user share one session',
    JSON.stringify(s)
  )
  const warnedNow = stubs.__notifications.filter((n) => /expires at/.test(n.message))
  report(
    warnedNow.length === 1 && warnedNow[0].clusterId === 'c',
    'a session already inside the 15-minute window is warned about once, right away',
    JSON.stringify(stubs.__notifications)
  )

  await sleep(3500)
  const warnings = stubs.__notifications.filter((n) => /expires at/.test(n.message))
  report(
    warnings.some((n) => n.clusterId === 'a') && !warnings.some((n) => n.clusterId === 'b'),
    'the warning timer fires at 15 minutes left, once per shared session',
    JSON.stringify(warnings)
  )
  report(
    stubs.__notifications.some((n) => n.clusterId === 'c' && /has expired/.test(n.message)),
    'the expiry timer announces an expiry that happens while running',
    JSON.stringify(stubs.__notifications)
  )
  const beforeRepeat = stubs.__notifications.length
  await refreshTeleportSessions()
  report(
    stubs.__notifications.length === beforeRepeat,
    're-reading the same state repeats no notification'
  )

  console.log('-- ~/.tsh watcher')
  const callsBefore = tshCalls()
  for (let i = 0; i < 5; i++) writeFileSync(join(tshDir, `profile-${i}.yaml`), String(i))
  await sleep(1500)
  const burst = tshCalls() - callsBefore
  report(
    burst === 1,
    'a burst of ~/.tsh writes (a login) triggers one tsh status run',
    `${burst} runs`
  )
  const lastBroadcast = broadcasts.length
  writeStatus(profile('tp.example.com', 'alice', 12 * 3_600_000))
  writeFileSync(join(tshDir, 'tp.example.com.yaml'), 'relogin')
  await sleep(1500)
  report(
    broadcasts.length > lastBroadcast && getTeleportSessions().a?.validUntil !== s.a?.validUntil,
    'a login in any terminal is picked up and broadcast',
    JSON.stringify(getTeleportSessions())
  )

  console.log('-- idle cost')
  const idleCalls = tshCalls()
  const idleBroadcasts = broadcasts.length
  await sleep(3000)
  report(
    tshCalls() === idleCalls && broadcasts.length === idleBroadcasts,
    'idle: no tsh runs and no broadcasts (nothing polls)'
  )
  // The only live session timer should be the tp session's warning + expiry pair (short's has
  // expired); a timer per sweep or per broadcast would show up here as growth.
  report(
    live.timers.size === 2 && live.watchers.size === 1,
    'idle: exactly one warning + one expiry timer per live session, and one ~/.tsh watcher',
    `${live.timers.size} timers, ${live.watchers.size} watchers`
  )
  stopTeleportSessionMonitor()
  report(
    live.timers.size === 0 && live.watchers.size === 0,
    'stop releases every timer and the watcher',
    `${live.timers.size} timers, ${live.watchers.size} watchers`
  )

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
  process.exit(failures ? 1 : 0)
}

void main()
