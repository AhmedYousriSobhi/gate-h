import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { getCluster, getClusterSecrets } from '../clusters'
import { addNotification } from '../notifications/store'
import { checkKnownHost } from './knownHosts'
import { ensureTunnel, stopTunnel } from '../azure/tunnel'
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
// forwardOut, per the standard ssh2 jump-host pattern), opens an interactive shell channel, and
// streams its output to the renderer over IPC. Sessions live only in memory for this process.
// Teleport clusters are the exception: their session is `tsh ssh` on a local PTY (see
// openTeleportSession), behind the same session ids and ssh:* events, so the renderer drives
// both kinds identically.

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

function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path
}

interface HostContext {
  clusterId: string
  clusterName: string
  /** How this host is described in a mismatch notification, e.g. "login node" or "jump host". */
  role: string
}

/** Trust-on-first-use host key verification (see `../ssh/knownHosts.ts`) plus SSH-level keepalive.
 *  ssh2 sends no keepalive and does no host verification by default - both matter specifically
 *  for HPC clusters: login nodes are frequently reached over a VPN or through firewalls/NAT that
 *  silently drop idle connections (keepalive lets the client detect that instead of sitting in a
 *  falsely "connected" state), and a cluster's public-facing login node is exactly the kind of
 *  target worth pinning a host key for. */
function buildConnectConfig(
  profile: ConnectionProfile,
  secret: string | null,
  hostContext: HostContext,
  /** Where to actually dial, when that's a local tunnel end rather than `profile.host` - the host
   *  key stays pinned under `profile`'s host:port, the machine it really belongs to. */
  dial?: { host: string; port: number }
): ConnectConfig {
  const config: ConnectConfig = {
    host: dial?.host ?? profile.host,
    port: dial?.port ?? profile.port,
    username: profile.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    hostHash: 'sha256',
    hostVerifier: (fingerprint: string) => {
      const result = checkKnownHost(profile.host, profile.port, fingerprint)
      if (result === 'mismatch') {
        addNotification({
          clusterId: hostContext.clusterId,
          clusterName: hostContext.clusterName,
          kind: 'ssh',
          severity: 'warning',
          message:
            `Host key for the ${hostContext.role} (${profile.host}:${profile.port}) changed ` +
            `since the last connection - refused to connect. This happens after a legitimate ` +
            `reinstall, but can also mean someone is intercepting the connection; verify with ` +
            `whoever administers the cluster before trusting the new key.`
        })
        return false
      }
      return true
    }
  }

  if (profile.authMethod === 'password') {
    config.password = secret ?? undefined
  } else if (profile.authMethod === 'private-key') {
    if (!profile.privateKeyPath) {
      throw new Error(`Private key path is required for host ${profile.host}`)
    }
    config.privateKey = readFileSync(expandHome(profile.privateKeyPath))
    if (secret) config.passphrase = secret
  } else if (profile.authMethod === 'agent') {
    config.agent = process.env.SSH_AUTH_SOCK
  }

  return config
}

function connectClient(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const onConnectError = (err: Error): void => reject(err)
    client.once('ready', () => {
      // Drop the connect-time rejection handler now that the promise has settled - otherwise it
      // stays attached for the life of the connection, silently swallowing any later 'error'
      // (calling reject() after a promise has settled is a no-op) instead of letting the caller's
      // own post-connect listener see it.
      client.removeListener('error', onConnectError)
      resolve(client)
    })
    client.on('error', onConnectError)
    client.connect(config)
  })
}

/** Sends only if the renderer's WebContents is still alive - a session's streams can keep
 *  emitting events after the window that owns them has been destroyed (e.g. app quit while a
 *  session was mid-teardown), and calling `send` on a destroyed WebContents throws. */
function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function openForward(
  jumpClient: Client,
  targetHost: string,
  targetPort: number
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    jumpClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
      if (err) reject(err)
      else resolve(stream)
    })
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
  const secrets = getClusterSecrets(clusterId)
  const tunnel = cluster.azureTunnel

  if (tunnel) {
    if (cluster.connection.jumpHost) {
      throw new Error('A cluster can connect through a jump host or an Azure tunnel, not both.')
    }
    await ensureTunnel(cluster)
  }

  let jumpClient: Client | null = null
  let targetConfig = buildConnectConfig(
    cluster.connection,
    secrets.connectionSecret,
    { clusterId, clusterName: cluster.name, role: 'login node' },
    tunnel ? { host: '127.0.0.1', port: tunnel.localPort } : undefined
  )

  if (cluster.connection.jumpHost) {
    const jump = cluster.connection.jumpHost
    // Note (v1 limitation): the jump host reuses the cluster's connection secret only when it
    // shares the same auth method; a passworded jump host with a different password than the
    // target is not yet supported - it needs its own stored secret. Tracked for a follow-up.
    const jumpSecret =
      jump.authMethod === cluster.connection.authMethod ? secrets.connectionSecret : null
    jumpClient = await connectClient(
      buildConnectConfig(
        {
          host: jump.host,
          port: jump.port,
          username: jump.username,
          authMethod: jump.authMethod,
          privateKeyPath: jump.privateKeyPath
        },
        jumpSecret,
        { clusterId, clusterName: cluster.name, role: 'jump host' }
      )
    )
    // Once connected, connectClient's own error listener is gone (see its comment) - without a
    // replacement, an error on this client (e.g. the jump host drops mid-session) would be an
    // unhandled 'error' event, which crashes the whole main process. The forwarded stream closing
    // already surfaces "session closed unexpectedly" to the user (below), so this just needs to
    // exist and not crash - the exact reason still goes to the console for debugging.
    jumpClient.on('error', (err: Error) => {
      console.error(`[gate-h] jump host ${jump.host}:${jump.port} error:`, err.message)
    })
    const forwardStream = await openForward(
      jumpClient,
      cluster.connection.host,
      cluster.connection.port
    )
    targetConfig = { ...targetConfig, sock: forwardStream }
  }

  let client: Client
  try {
    client = await connectClient(targetConfig)
  } catch (err) {
    // A Bastion tunnel can hang with its local port still listening (azure-cli#28367), so `up`
    // would keep reusing it; tearing it down makes the Terminal's next retry open a fresh one.
    if (tunnel) await stopTunnel(clusterId)
    throw err
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
