import { spawn } from 'child_process'
import type { Client } from 'ssh2'
import { getClusterSecrets } from '../clusters'
import { buildConnectConfig, connectClient, openForward } from '../ssh/connect'
import { getLiveClient } from '../ssh/manager'
import { getTeleportSessions } from '../teleport/sessionState'
import { EXIT_NO_SESSION, teleportExecCommand } from '../teleport/session'
import type { ClusterSummary } from '../../shared/types'

// Runs one fixed scheduler command (built in ./slurm.ts, never text from the renderer) on a
// session the user already has open. It never opens a connection or logs in: an ssh2 cluster
// gets an extra channel on its terminal's connection, which also covers jump hosts and Azure
// tunnels, and a bare Teleport cluster (no jump host) gets a `tsh ssh --no-login`, only while its
// tsh session is valid. When `scheduler.execTarget` is set, the command instead runs on that
// internal node - one more forwarded ssh2 hop for an already-live client, or `tsh ssh --no-login`
// to that node for a bare Teleport cluster. Runs for one cluster are queued, so a cluster never
// has more than one scheduler channel open, and OpenSSH's MaxSessions (10 by default) is left to
// the terminal tabs.

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

/** Runs on one more ssh2 `forwardOut` hop from the cluster's already-live client to
 *  `scheduler.execTarget` - same identity/credentials as `cluster.connection`, since the target is
 *  just a different node reachable through the same already-authenticated chain. Opened and closed
 *  per run, same per-run cost as execOverTeleport's fresh `tsh` spawn - not worth caching for a
 *  30-second-minimum poll interval. */
async function execViaForward(
  client: Client,
  cluster: ClusterSummary,
  target: { host: string; port?: number },
  command: string,
  stdin?: string
): Promise<ExecResult> {
  const secrets = getClusterSecrets(cluster.id)
  const forwardStream = await openForward(
    client,
    target.host,
    target.port ?? cluster.connection.port
  )
  const targetClient = await connectClient({
    ...buildConnectConfig(
      {
        host: target.host,
        port: target.port ?? cluster.connection.port,
        username: cluster.connection.username,
        authMethod: cluster.connection.authMethod,
        privateKeyPath: cluster.connection.privateKeyPath
      },
      secrets.connectionSecret,
      { clusterId: cluster.id, clusterName: cluster.name, role: 'Slurm execution target' }
    ),
    sock: forwardStream
  })
  try {
    return await execOverSsh(targetClient, command, stdin)
  } finally {
    targetClient.end()
  }
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

function runNow(cluster: ClusterSummary, command: string, stdin?: string): Promise<ExecResult> {
  const execTarget = cluster.scheduler?.execTarget
  // A bare Teleport cluster (no jump host) has no ssh2 client - it needs its own tsh invocation.
  // One with a jump host already has a real live client (see ssh/manager.ts), so it's handled by
  // the ssh2 path below like Direct/Azure, gaining execTarget support for free.
  if (cluster.teleport && !cluster.connection.jumpHost) {
    if (!hasTeleportSession(cluster.id)) {
      return Promise.reject(new NoSessionError('Waiting for a Teleport login.'))
    }
    return execOverTeleport(cluster, command, stdin, execTarget?.host)
  }
  const client = getLiveClient(cluster.id)
  if (!client) return Promise.reject(new NoSessionError('Waiting for a terminal session.'))
  if (execTarget) return execViaForward(client, cluster, execTarget, command, stdin)
  return execOverSsh(client, command, stdin)
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
