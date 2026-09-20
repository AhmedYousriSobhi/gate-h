import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { getCluster, getClusterSecrets } from '../clusters'
import { addNotification } from '../notifications/store'
import type { ConnectionProfile } from '../../shared/types'

// Manages live SSH sessions: connects (optionally chained through a jump/bastion host via
// forwardOut, per the standard ssh2 jump-host pattern), opens an interactive shell channel, and
// streams its output to the renderer over IPC. Sessions live only in memory for this process.

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

function buildConnectConfig(profile: ConnectionProfile, secret: string | null): ConnectConfig {
  const config: ConnectConfig = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 20000
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
    client.on('ready', () => resolve(client))
    client.on('error', reject)
    client.connect(config)
  })
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
  const secrets = getClusterSecrets(clusterId)

  let jumpClient: Client | null = null
  let targetConfig = buildConnectConfig(cluster.connection, secrets.connectionSecret)

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
        jumpSecret
      )
    )
    const forwardStream = await openForward(
      jumpClient,
      cluster.connection.host,
      cluster.connection.port
    )
    targetConfig = { ...targetConfig, sock: forwardStream }
  }

  const client = await connectClient(targetConfig)
  const stream = await openShell(client)

  const sessionId = randomUUID()
  sessions.set(sessionId, { clusterId, clusterName: cluster.name, jumpClient, client, stream })

  stream.on('data', (chunk: Buffer) => {
    sender.send('ssh:data', { sessionId, chunk: chunk.toString('utf8') })
  })
  stream.stderr.on('data', (chunk: Buffer) => {
    sender.send('ssh:data', { sessionId, chunk: chunk.toString('utf8') })
  })
  stream.on('close', () => {
    sender.send('ssh:closed', { sessionId })
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
    sender.send('ssh:error', { sessionId, message: err.message })
  })

  return { sessionId }
}

export function writeToSession(sessionId: string, data: string): void {
  sessions.get(sessionId)?.stream.write(data)
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.stream.setWindow(rows, cols, 0, 0)
}

export function closeSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  intentionalCloses.add(sessionId)
  session.stream.end()
  session.client.end()
  session.jumpClient?.end()
  sessions.delete(sessionId)
}

export function closeAllSessions(): void {
  for (const id of Array.from(sessions.keys())) closeSession(id)
}
