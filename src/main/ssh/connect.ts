import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { addNotification } from '../notifications/store'
import { checkKnownHost } from './knownHosts'
import type { ConnectionProfile } from '../../shared/types'

// Shared by ssh/manager.ts (Direct/Azure sessions and jump-host chaining) and scheduler/exec.ts
// (an extra forwarded hop to a Slurm execution target) - the one place that dials an ssh2.Client
// and pins its host key.

export interface HostContext {
  clusterId: string
  clusterName: string
  /** How this host is described in a mismatch notification, e.g. "login node" or "jump host". */
  role: string
}

function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path
}

/** Trust-on-first-use host key verification (see `./knownHosts.ts`) plus SSH-level keepalive.
 *  ssh2 sends no keepalive and does no host verification by default - both matter specifically
 *  for HPC clusters: login nodes are frequently reached over a VPN or through firewalls/NAT that
 *  silently drop idle connections (keepalive lets the client detect that instead of sitting in a
 *  falsely "connected" state), and a cluster's public-facing login node is exactly the kind of
 *  target worth pinning a host key for. */
export function buildConnectConfig(
  profile: ConnectionProfile,
  secret: string | null,
  hostContext: HostContext,
  /** Where to actually dial, when that's a local tunnel end rather than `profile.host` - the host
   *  key stays pinned under `profile`'s host:port, the machine it really belongs to. When set,
   *  `profile.host` is just a label (not a routable address), so different clusters can
   *  legitimately declare the same one for different real machines reached through different
   *  tunnels - the pin is scoped per-cluster in that case to keep those from colliding. */
  dial?: { host: string; port: number }
): ConnectConfig {
  const pinHost = dial ? `${profile.host}#${hostContext.clusterId}` : profile.host
  const config: ConnectConfig = {
    host: dial?.host ?? profile.host,
    port: dial?.port ?? profile.port,
    username: profile.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    hostHash: 'sha256',
    hostVerifier: (fingerprint: string) => {
      const result = checkKnownHost(pinHost, profile.port, fingerprint)
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

export function connectClient(config: ConnectConfig): Promise<Client> {
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

export function openForward(
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
