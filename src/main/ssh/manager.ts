import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { getCluster, getClusterSecrets } from '../clusters'
import { addNotification } from '../notifications/store'
import { buildConnectConfig, connectClient, openForward, type HostContext } from './connect'
import { ensureTunnel, stopTunnel } from '../azure/tunnel'
import { refreshCluster } from '../monitor/clusterMonitor'
import { ptyManager } from '../pty/manager'
import {
  EXIT_NO_SESSION,
  TeleportPreflight,
  teleportLoginCommand,
  teleportSshCommand
} from '../teleport/session'
import { refreshTeleportSessions } from '../teleport/sessionState'
import type { ClusterSummary, ConnectionProfile } from '../../shared/types'

// Manages live SSH sessions: connects (optionally chained through a jump/bastion host via
// forwardOut, per the standard ssh2 jump-host pattern - composable with Direct or an Azure
// tunnel, see openSshSession below), opens an interactive shell channel, and streams its output
// to the renderer over IPC. Sessions live only in memory for this process. Teleport clusters are
// the exception: their session is `tsh ssh` on a local PTY (see openTeleportSession), behind the
// same session ids and ssh:* events, so the renderer drives both kinds identically. A jump host
// can't be layered on a Teleport session: every node Teleport can route to presents a
// certificate-format host key, which the `ssh2` package this app uses cannot verify at all (see
// docs/STATUS.md).

interface Session {
  clusterId: string
  clusterName: string
  jumpClient: Client | null
  client: Client
  stream: ClientChannel
}

const sessions = new Map<string, Session>()
// Session ids whose closure was requested by the app (switching clusters, quitting, etc.) rather
// than the remote end hanging up on its own - used to avoid notifying on every routine disconnect.
const intentionalCloses = new Set<string>()

/** Sends only if the renderer's WebContents is still alive - a session's streams can keep
 *  emitting events after the window that owns them has been destroyed (e.g. app quit while a
 *  session was mid-teardown), and calling `send` on a destroyed WebContents throws. */
function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

/** Records a connect-step failure (tunnel, jump host, or target) to the cross-cluster
 *  notification feed - the Terminal's own error banner clears on every retry and eventually
 *  gives way to a generic paused message, so this is the only place the reason survives to be
 *  read after the fact. */
function notifyConnectFailure(
  clusterId: string,
  clusterName: string,
  err: unknown,
  fallbackMessage: string
): void {
  addNotification({
    clusterId,
    clusterName,
    kind: 'ssh',
    severity: 'warning',
    message: err instanceof Error ? err.message : fallbackMessage
  })
}

function openShell(client: Client): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell({ term: 'xterm-256color' }, (err, stream) => {
      if (err) reject(err)
      else resolve(stream)
    })
  })
}

export async function openSshSession(
  clusterId: string,
  sender: WebContents
): Promise<{ sessionId: string }> {
  const cluster = getCluster(clusterId)
  if (!cluster) throw new Error('Cluster not found')
  if (cluster.teleport) return openTeleportSession(cluster, sender)
  const jump = cluster.connection.jumpHost
  const secrets = getClusterSecrets(clusterId)
  const tunnel = cluster.azureTunnel

  if (tunnel) {
    try {
      await ensureTunnel(cluster)
      // A Bastion-mode reachability reading only ever reflects whether the tunnel is up (see
      // clusterMonitor's isReachable) - without this, the LED would sit on its last ("offline")
      // reading for up to a full sweep interval after the tunnel the Terminal is already using
      // just came up, instead of catching up immediately the way it does after an edit.
      refreshCluster(cluster)
    } catch (err) {
      notifyConnectFailure(
        clusterId,
        cluster.name,
        err,
        `Could not open the Azure tunnel for ${cluster.name}`
      )
      throw err
    }
  }

  // The near hop: what the base method (Direct or Azure tunnel) actually reaches first. Without a
  // jump host this is the cluster's own target - today's no-jump behavior, unchanged. With one,
  // the base method reaches the jump host instead, and a `forwardOut` below completes the trip to
  // `cluster.connection`, whose meaning as the final interactive target never changes.
  const nearProfile: ConnectionProfile = jump
    ? {
        host: jump.host,
        port: jump.port,
        username: jump.username,
        authMethod: jump.authMethod,
        privateKeyPath: jump.privateKeyPath
      }
    : cluster.connection
  const nearRole = jump ? 'jump host' : 'login node'
  const nearContext: HostContext = { clusterId, clusterName: cluster.name, role: nearRole }
  // Note (v1 limitation for the fallback): a jump host with no stored secret of its own reuses
  // the cluster's connection secret only when it shares the same auth method.
  const nearSecret = jump
    ? (secrets.jumpHostSecret ??
      (jump.authMethod === cluster.connection.authMethod ? secrets.connectionSecret : null))
    : secrets.connectionSecret

  let nearClient: Client
  try {
    nearClient = await connectClient(
      buildConnectConfig(
        nearProfile,
        nearSecret,
        nearContext,
        tunnel ? { host: '127.0.0.1', port: tunnel.localPort } : undefined
      )
    )
  } catch (err) {
    // A Bastion tunnel can hang with its local port still listening (azure-cli#28367), so `up`
    // would keep reusing it; tearing it down makes the Terminal's next retry open a fresh one.
    if (tunnel) await stopTunnel(clusterId)
    notifyConnectFailure(
      clusterId,
      cluster.name,
      err,
      jump
        ? `Could not connect to the jump host for ${cluster.name}`
        : `Could not connect to ${cluster.name}`
    )
    throw err
  }

  let jumpClient: Client | null = null
  let client: Client
  if (jump) {
    jumpClient = nearClient
    // Once connected, connectClient's own error listener is gone (see its comment) - without a
    // replacement, an error on this client (e.g. the jump host drops mid-session) would be an
    // unhandled 'error' event, which crashes the whole main process. The forwarded stream closing
    // already surfaces "session closed unexpectedly" to the user (below), so this just needs to
    // exist and not crash - the exact reason still goes to the console for debugging.
    jumpClient.on('error', (err: Error) => {
      console.error(`[gate-h] jump host ${jump.host}:${jump.port} error:`, err.message)
    })
    let targetConfig: ConnectConfig
    try {
      const forwardStream = await openForward(
        jumpClient,
        cluster.connection.host,
        cluster.connection.port
      )
      targetConfig = {
        ...buildConnectConfig(cluster.connection, secrets.connectionSecret, {
          clusterId,
          clusterName: cluster.name,
          role: 'login node'
        }),
        sock: forwardStream
      }
    } catch (err) {
      jumpClient.end()
      notifyConnectFailure(
        clusterId,
        cluster.name,
        err,
        `Could not open a forwarded connection through the jump host for ${cluster.name}`
      )
      throw err
    }
    try {
      client = await connectClient(targetConfig)
    } catch (err) {
      jumpClient.end()
      notifyConnectFailure(clusterId, cluster.name, err, `Could not connect to ${cluster.name}`)
      throw err
    }
  } else {
    client = nearClient
  }

  const stream = await openShell(client)

  const sessionId = randomUUID()
  sessions.set(sessionId, { clusterId, clusterName: cluster.name, jumpClient, client, stream })

  stream.on('data', (chunk: Buffer) => {
    safeSend(sender, 'ssh:data', { sessionId, chunk: chunk.toString('utf8') })
  })
  stream.stderr.on('data', (chunk: Buffer) => {
    safeSend(sender, 'ssh:data', { sessionId, chunk: chunk.toString('utf8') })
  })
  stream.on('close', () => {
    safeSend(sender, 'ssh:closed', { sessionId })
    if (!intentionalCloses.has(sessionId)) {
      addNotification({
        clusterId,
        clusterName: cluster.name,
        kind: 'ssh',
        severity: 'warning',
        message: `SSH session to ${cluster.name} was closed unexpectedly`
      })
    }
    intentionalCloses.delete(sessionId)
    closeSession(sessionId)
  })
  client.on('error', (err: Error) => {
    safeSend(sender, 'ssh:error', { sessionId, message: err.message })
  })

  return { sessionId }
}

function openTeleportSession(cluster: ClusterSummary, sender: WebContents): { sessionId: string } {
  if (cluster.azureTunnel || cluster.connection.jumpHost) {
    throw new Error(
      'A Teleport cluster connects through its proxy only - remove the jump host or Azure tunnel.'
    )
  }
  const preflight = new TeleportPreflight()
  // The PTY only emits data/exit asynchronously, so this is assigned before either can fire.
  let sessionId = ''
  sessionId = ptyManager.spawn(teleportSshCommand(cluster), {
    onData: (chunk) => {
      preflight.feed(chunk)
      safeSend(sender, 'ssh:data', { sessionId, chunk })
    },
    onExit: ({ exitCode, signal }) => {
      const intentional = intentionalCloses.delete(sessionId)
      if (!intentional && exitCode === EXIT_NO_SESSION && !signal) {
        // Not a failure to report: the terminal needs the user to log in. The session monitor
        // already announces expiry once per proxy, rather than once per open cluster.
        void refreshTeleportSessions()
        safeSend(sender, 'ssh:closed', { sessionId, exitCode, authRequired: true })
        return
      }
      // Exit 0 is the user typing `exit` (or tsh ending the remote shell normally) - not worth a
      // notification, unlike the wrapper's non-zero codes or tsh dying on a dropped connection.
      if (!intentional && (exitCode !== 0 || signal)) {
        if (preflight.error) {
          safeSend(sender, 'ssh:error', { sessionId, message: preflight.error })
        }
        addNotification({
          clusterId: cluster.id,
          clusterName: cluster.name,
          kind: 'ssh',
          severity: 'warning',
          message: preflight.error
            ? `Teleport session to ${cluster.name} failed: ${preflight.error}`
            : `SSH session to ${cluster.name} was closed unexpectedly`
        })
      }
      safeSend(sender, 'ssh:closed', { sessionId, exitCode })
    }
  })
  return { sessionId }
}

/** The user-started Teleport login (see teleportLoginCommand), streamed over the same ssh:*
 *  events as a terminal so the login dialog can reuse them. */
export function openTeleportLogin(
  clusterId: string,
  renew: boolean,
  sender: WebContents
): { sessionId: string } {
  const cluster = getCluster(clusterId)
  if (!cluster?.teleport) throw new Error('This cluster is not set up for Teleport')
  let sessionId = ''
  sessionId = ptyManager.spawn(teleportLoginCommand(cluster, renew), {
    onData: (chunk) => safeSend(sender, 'ssh:data', { sessionId, chunk }),
    onExit: ({ exitCode }) => {
      intentionalCloses.delete(sessionId)
      // Refresh before reporting, so every terminal on this proxy hears about the new session
      // by the time the dialog closes.
      void refreshTeleportSessions().finally(() =>
        safeSend(sender, 'ssh:closed', { sessionId, exitCode })
      )
    }
  })
  return { sessionId }
}

/** The connection behind one of this cluster's open terminal sessions, if any - scheduler
 *  commands run on it as extra channels (see ../scheduler/exec.ts) instead of logging in again.
 *  Always null for Teleport clusters, whose terminals are PTYs. */
export function getLiveClient(clusterId: string): Client | null {
  for (const session of sessions.values()) {
    if (session.clusterId === clusterId) return session.client
  }
  return null
}

export function writeToSession(sessionId: string, data: string): void {
  if (ptyManager.has(sessionId)) ptyManager.write(sessionId, data)
  else sessions.get(sessionId)?.stream.write(data)
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  if (ptyManager.has(sessionId)) ptyManager.resize(sessionId, cols, rows)
  else sessions.get(sessionId)?.stream.setWindow(rows, cols, 0, 0)
}

export function closeSession(sessionId: string): void {
  if (ptyManager.has(sessionId)) {
    intentionalCloses.add(sessionId)
    ptyManager.kill(sessionId)
    return
  }
  const session = sessions.get(sessionId)
  if (!session) return
  intentionalCloses.add(sessionId)
  session.stream.end()
  session.client.end()
  session.jumpClient?.end()
  sessions.delete(sessionId)
}

export function closeAllSessions(): void {
  for (const id of [...sessions.keys(), ...ptyManager.ids()]) closeSession(id)
}
