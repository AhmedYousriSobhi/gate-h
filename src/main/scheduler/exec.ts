import { spawn } from 'child_process'
import type { Client } from 'ssh2'
import { getLiveClient } from '../ssh/manager'
import { getTeleportSessions } from '../teleport/sessionState'
import { EXIT_NO_SESSION, teleportExecCommand } from '../teleport/session'
import type { ClusterSummary } from '../../shared/types'

// Runs one fixed scheduler command (built in ./slurm.ts, never text from the renderer) on a
// session the user already has open. It never opens a connection or logs in: an ssh2 cluster
// gets an extra channel on its terminal's connection, which also covers jump hosts and Azure
// tunnels, and a Teleport cluster gets a `tsh ssh --no-login`, only while its tsh session is
// valid. When `scheduler.execTarget` is set, the command instead runs on that internal node - an
// `ssh <node>` run from the connected node for an already-live client, or `tsh ssh --no-login` to
// that node for a Teleport cluster. Runs for one cluster are queued, so a cluster never has more than one
// scheduler channel open, and OpenSSH's MaxSessions (10 by default) is left to the terminal tabs.

const TIMEOUT_MS = 15_000
const MAX_OUTPUT_BYTES = 1024 * 1024

export interface ExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** There's no live session to run on - not a failure, so it doesn't count toward backoff. */
export class NoSessionError extends Error {}

const queues = new Map<string, Promise<unknown>>()

/** Collects a command's output up to MAX_OUTPUT_BYTES and TIMEOUT_MS, calling `abort` past
 *  either so a hung slurmctld or a runaway listing can't hold the channel open. */
function collector(
  abort: () => void,
  resolve: (result: ExecResult) => void,
  reject: (err: Error) => void
): {
  stdout: (chunk: Buffer) => void
  stderr: (chunk: Buffer) => void
  done: (exitCode: number | null) => void
  fail: (err: Error) => void
} {
  const out: Buffer[] = []
  const err: Buffer[] = []
  let size = 0
  let settled = false
  const settle = (fn: () => void): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    fn()
  }
  const timer = setTimeout(() => {
    settle(() => reject(new Error(`No answer within ${TIMEOUT_MS / 1000}s.`)))
    abort()
  }, TIMEOUT_MS)
  const push = (into: Buffer[]) => (chunk: Buffer) => {
    if (settled) return
    size += chunk.length
    if (size > MAX_OUTPUT_BYTES) {
      settle(() => reject(new Error('Output exceeded 1 MiB.')))
      abort()
      return
    }
    into.push(chunk)
  }
  return {
    stdout: push(out),
    stderr: push(err),
    done: (exitCode) =>
      settle(() =>
        resolve({
          exitCode,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8')
        })
      ),
    fail: (e) => settle(() => reject(e))
  }
}

function execOverSsh(client: Client, command: string, stdin?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err)
      let exitCode: number | null = null
      const c = collector(() => stream.close(), resolve, reject)
      if (stdin !== undefined) stream.end(stdin)
      stream.on('data', c.stdout)
      stream.stderr.on('data', c.stderr)
      stream.on('exit', (code: number | null) => {
        exitCode = code
      })
      stream.on('close', () => c.done(exitCode))
      stream.on('error', c.fail)
    })
  })
}

/** Hostnames only: the value lands in a shell command on the login node, and must never read as
 *  an ssh option. */
const EXEC_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Runs the command on `scheduler.execTarget` the way a person would: from the connected node,
 *  `ssh <node> <command>`. It uses that node's own keys, agent and ssh config, so it needs
 *  passwordless ssh between the two - BatchMode makes a missing key fail at once with ssh's own
 *  message, instead of hanging on a password prompt nobody can answer. */
export function sshHopCommand(target: { host: string; port?: number }, command: string): string {
  if (!EXEC_HOST_PATTERN.test(target.host)) throw new Error(`Invalid node name: ${target.host}`)
  const { port } = target
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`Invalid port: ${port}`)
  }
  const escaped = command.replace(/'/g, `'\\''`)
  return `ssh -o BatchMode=yes -o ConnectTimeout=10${port === undefined ? '' : ` -p ${port}`} -- ${target.host} '${escaped}'`
}

function execOverTeleport(
  cluster: ClusterSummary,
  command: string,
  stdin?: string,
  targetHost?: string
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const { file, args } = teleportExecCommand(cluster, command, targetHost)
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const c = collector(() => child.kill('SIGTERM'), resolve, reject)
    // Closed straight away without input, as /dev/null would be.
    child.stdin.end(stdin)
    child.stdout.on('data', c.stdout)
    child.stderr.on('data', c.stderr)
    child.on('error', c.fail)
    child.on('close', (code) => {
      if (code === EXIT_NO_SESSION) c.fail(new NoSessionError('Waiting for a Teleport login.'))
      else c.done(code)
    })
  })
}

function hasTeleportSession(clusterId: string): boolean {
  const validUntil = getTeleportSessions()[clusterId]?.validUntil
  return Boolean(validUntil && Date.parse(validUntil) > Date.now())
}

/** An ssh2/Teleport `exec` runs the command via the user's shell non-interactively *and*
 *  non-login, which on many HPC login nodes skips exactly where Slurm's PATH gets set up
 *  (`/etc/profile.d/*.sh`, environment modules, etc. - all sourced by a login shell, none of them
 *  by a bare non-interactive one). Running it one layer inside `bash -lc` instead forces a login
 *  shell for just this command, picking up that setup without needing any change to the cluster's
 *  own shell config. */
export function asLoginShell(command: string): string {
  const escaped = command.replace(/'/g, `'\\''`)
  return `bash -lc '${escaped}'`
}

function runNow(cluster: ClusterSummary, command: string, stdin?: string): Promise<ExecResult> {
  const execTarget = cluster.scheduler?.execTarget
  const wrapped = asLoginShell(command)
  if (cluster.teleport) {
    if (!hasTeleportSession(cluster.id)) {
      return Promise.reject(new NoSessionError('Waiting for a Teleport login.'))
    }
    return execOverTeleport(cluster, wrapped, stdin, execTarget?.host)
  }
  const client = getLiveClient(cluster.id)
  if (!client) return Promise.reject(new NoSessionError('Waiting for a terminal session.'))
  return execOverSsh(client, execTarget ? sshHopCommand(execTarget, wrapped) : wrapped, stdin)
}

/** Whether an ssh2 cluster has a terminal connection a command could run on right now. */
export function hasLiveConnection(clusterId: string): boolean {
  return getLiveClient(clusterId) !== null
}

/** `stdin`, when given, is written to the command's standard input and then closed - e.g. a
 *  batch script for `sbatch` to read. */
export function runOnCluster(
  cluster: ClusterSummary,
  command: string,
  stdin?: string
): Promise<ExecResult> {
  const previous = queues.get(cluster.id) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(() => runNow(cluster, command, stdin))
  queues.set(cluster.id, run)
  void run
    .catch(() => undefined)
    .finally(() => {
      if (queues.get(cluster.id) === run) queues.delete(cluster.id)
    })
  return run
}
