import { execFile, spawn } from 'child_process'
import { createInterface } from 'readline'
import scriptPath from '../../../resources/azure-tunnel.sh?asset&asarUnpack'
import { checkTcpReachable } from '../monitor/reachability'
import type {
  AzureSubscription,
  AzureTunnelPhase,
  AzureTunnelStatusEvent,
  AzureTunnelVerifyResult,
  AzureVmMatch,
  ClusterSummary
} from '../../shared/types'

// Drives resources/azure-tunnel.sh for clusters with an Azure tunnel configured. The script owns
// the actual tunnel process (detached, in its own process group, tracked by a state file), so a
// tunnel outlives any one SSH session: once opened it stays up until the app quits, the cluster
// is edited/removed/put in standby, or an SSH connect through it fails (see stopTunnel callers).
// That keeps a flaky shell from also paying a full Azure re-auth + tunnel setup on every
// reconnect, and keeps the tunnel's health a meaningful reachability signal.

const PHASES = new Set<string>([
  'auth',
  'subscription',
  'tunnel',
  'active',
  'degraded',
  'down',
  'error'
] satisfies AzureTunnelPhase[])

let broadcast: ((event: AzureTunnelStatusEvent) => void) | null = null
// One in-flight `up` per cluster: a Terminal reconnect and another tab's session can ask
// at the same moment, and two concurrent `up`s would race for the same local port.
const pendingUps = new Map<string, Promise<void>>()
const openedTunnels = new Set<string>()

export function setAzureStatusBroadcaster(fn: (event: AzureTunnelStatusEvent) => void): void {
  broadcast = fn
}

function tunnelName(clusterId: string): string {
  return `gateh-${clusterId}`
}

function upArgs(cluster: ClusterSummary): string[] {
  const tunnel = cluster.azureTunnel
  if (!tunnel) throw new Error(`${cluster.name} has no Azure tunnel configured`)
  // With a jump host configured, the tunnel's far end is the jump host - a further ssh2
  // `forwardOut` hop (see ssh/manager.ts) reaches `cluster.connection` from there. Without one,
  // the tunnel's far end is `cluster.connection` itself, unchanged from before jump hosts composed
  // with Azure tunnels.
  const near = cluster.connection.jumpHost ?? cluster.connection
  const args = [
    'up',
    '--non-interactive',
    '--name',
    tunnelName(cluster.id),
    '--mode',
    tunnel.mode,
    '--resource-group',
    tunnel.resourceGroup,
    '--subscription',
    tunnel.subscription,
    '--local-port',
    String(tunnel.localPort),
    '--remote-port',
    String(tunnel.remotePort ?? near.port)
  ]
  if (tunnel.tenant) args.push('--tenant', tunnel.tenant)
  // Missing mode-specific values are left out rather than passed empty, so the script reports
  // which one is required instead of a generic "needs a value".
  if (tunnel.mode === 'bastion') {
    if (tunnel.bastionName) args.push('--bastion', tunnel.bastionName)
    if (tunnel.targetResourceId) args.push('--target-id', tunnel.targetResourceId)
    else if (tunnel.vmName) args.push('--vm', tunnel.vmName)
    else if (tunnel.targetIpAddress) args.push('--target-ip', tunnel.targetIpAddress)
  } else {
    if (tunnel.vmName) args.push('--vm', tunnel.vmName)
    args.push('--remote-host', near.host)
    if (tunnel.localUser) args.push('--local-user', tunnel.localUser)
  }
  return args
}

function runUp(cluster: ClusterSummary): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath, ...upArgs(cluster)], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let lastError = ''
    const stderrTail: string[] = []

    createInterface({ input: child.stdout }).on('line', (line) => {
      const match = /^STATUS (\S+) (.*)$/.exec(line)
      if (!match || !PHASES.has(match[1])) return
      const phase = match[1] as AzureTunnelPhase
      if (phase === 'error') lastError = match[2]
      broadcast?.({ clusterId: cluster.id, phase, message: match[2] })
    })
    createInterface({ input: child.stderr }).on('line', (line) => {
      // With no terminal attached, the script falls back to device-code login, and az prints the
      // "open https://microsoft.com/devicelogin and enter the code ..." instruction on stderr -
      // the user can't finish logging in unless it's surfaced.
      if (/devicelogin|enter the code/i.test(line)) {
        broadcast?.({ clusterId: cluster.id, phase: 'auth', message: line.trim() })
      }
      stderrTail.push(line)
      if (stderrTail.length > 20) stderrTail.shift()
    })

    child.on('error', (err) => {
      reject(
        new Error(`Could not run the Azure tunnel script (is bash installed?): ${err.message}`)
      )
    })
    child.on('close', (code) => {
      if (code === 0) {
        openedTunnels.add(cluster.id)
        resolve()
        return
      }
      console.error(`[gate-h] azure tunnel for ${cluster.name} failed:\n${stderrTail.join('\n')}`)
      const summary = lastError || `Azure tunnel failed to start (exit code ${code})`
      // `az`'s own failure reason (its stderr, conventionally "ERROR: ...") only reaches this far -
      // our own die() message above is just a generic wrapper ("exited before it started
      // listening") that doesn't say why. Fold the real reason in so it reaches the notification
      // feed instead of only the main process's console/log file.
      const azError = [...stderrTail].reverse().find((line) => /^ERROR:/i.test(line.trim()))
      reject(new Error(azError ? `${summary} - ${azError.trim()}` : summary))
    })
  })
}

/** Resolves once the cluster's tunnel is listening - reusing it if it's already up (the script's
 *  `up` is idempotent), otherwise authenticating and opening it. */
export function ensureTunnel(cluster: ClusterSummary): Promise<void> {
  const pending = pendingUps.get(cluster.id)
  if (pending) return pending
  const run = runUp(cluster).finally(() => pendingUps.delete(cluster.id))
  pendingUps.set(cluster.id, run)
  return run
}

/** On-demand self-check: opens (or reuses) the cluster's real tunnel, then confirms it actually
 *  carries traffic by waiting for a live SSH banner through it - not just that its local port is
 *  listening, which a known az CLI bug can leave true even after the session itself has silently
 *  died (azure-cli#28367, see the comment on `stopTunnel`'s caller in ssh/manager.ts). This is the
 *  same tunnel a real connect would use, so a user can run it before opening a terminal, or to
 *  tell apart "the tunnel itself is broken" from "something past the tunnel is." */
export async function verifyTunnel(cluster: ClusterSummary): Promise<AzureTunnelVerifyResult> {
  const tunnel = cluster.azureTunnel
  if (!tunnel) throw new Error(`${cluster.name} has no Azure tunnel configured`)
  try {
    await ensureTunnel(cluster)
  } catch (err) {
    return {
      tunnelOpened: false,
      tunnelError: err instanceof Error ? err.message : String(err),
      bannerReceived: false
    }
  }
  const startedAt = Date.now()
  // Longer than the reachability monitor's default: this is a deliberate, one-off check the user
  // is actively waiting on, not a frequent background poll, so it's worth giving a slow Bastion
  // relay more room before calling it dead.
  const bannerReceived = await checkTcpReachable('127.0.0.1', tunnel.localPort, 10_000)
  return {
    tunnelOpened: true,
    bannerReceived,
    latencyMs: bannerReceived ? Date.now() - startedAt : undefined
  }
}

/** Tears the tunnel down. Spawned detached so it still completes when called on app quit. */
export function stopTunnel(clusterId: string): Promise<void> {
  openedTunnels.delete(clusterId)
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath, 'down', '--name', tunnelName(clusterId)], {
      detached: true,
      stdio: 'ignore'
    })
    child.on('error', () => resolve())
    child.on('close', () => resolve())
  })
}

export function stopAllTunnels(): void {
  for (const clusterId of Array.from(openedTunnels)) void stopTunnel(clusterId)
}

/** True if the tunnel process is alive and its local port is listening. */
export function isTunnelUp(clusterId: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('bash', [scriptPath, 'status', '--name', tunnelName(clusterId)], (err) =>
      resolve(!err)
    )
  })
}

/** Reads the Azure CLI's cached subscription list directly rather than via the script, whose
 *  `subscriptions` command would start an (invisible, blocking) device-code login if the CLI
 *  isn't logged in yet. */
export function listSubscriptions(): Promise<AzureSubscription[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'az',
      [
        'account',
        'list',
        '--only-show-errors',
        '--output',
        'json',
        '--query',
        "[?state=='Enabled'].{id:id, name:name, isDefault:isDefault}"
      ],
      { timeout: 20_000 },
      (err, stdout) => {
        if (err) {
          reject(
            new Error(
              (err as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'Azure CLI (az) is not installed or not on PATH.'
                : 'Could not list subscriptions - run `az login` in a terminal first.'
            )
          )
          return
        }
        let subscriptions: AzureSubscription[]
        try {
          subscriptions = JSON.parse(stdout) as AzureSubscription[]
        } catch {
          reject(new Error('Unexpected output from `az account list`.'))
          return
        }
        if (subscriptions.length === 0) {
          reject(new Error('No subscriptions found - run `az login` in a terminal first.'))
          return
        }
        resolve(subscriptions)
      }
    )
  })
}

// Azure VM names are restricted to these characters; this also keeps the name safe to interpolate
// into the JMESPath --query below (a quote in it would break the query, not just be a bad name).
const VM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function vmsNamed(name: string, subscription: AzureSubscription): Promise<AzureVmMatch[]> {
  return new Promise((resolve) => {
    execFile(
      'az',
      [
        'vm',
        'list',
        '--only-show-errors',
        '--subscription',
        subscription.id,
        '--query',
        `[?name=='${name}'].{resourceGroup:resourceGroup, id:id}`,
        '--output',
        'json'
      ],
      // A subscription that hangs (a stale token quietly retrying, an unreachable management
      // endpoint) must not hang the whole search - bound it so one bad subscription can't sit
      // there forever with the button stuck on "Searching...".
      { timeout: 20_000 },
      (err, stdout) => {
        // A subscription this account can't list VMs in (RBAC), or one that timed out, shouldn't
        // sink the whole search - it's just one of potentially many subscriptions being checked.
        if (err) {
          resolve([])
          return
        }
        try {
          const matches = JSON.parse(stdout) as { resourceGroup: string; id: string }[]
          resolve(
            matches.map((m) => ({
              subscriptionId: subscription.id,
              subscriptionName: subscription.name,
              resourceGroup: m.resourceGroup,
              id: m.id
            }))
          )
        } catch {
          resolve([])
        }
      }
    )
  })
}

/** Searches every enabled subscription this account can see for a VM by name, concurrently -
 *  there's no single `az` command for "which subscription is this VM in". Lets the cluster form
 *  fill in Subscription/Resource group (and, for Bastion, the target resource ID) from a VM name
 *  alone, instead of the user hunting through subscriptions by hand or in the portal. */
export async function findVm(vmName: string): Promise<AzureVmMatch[]> {
  const name = vmName.trim()
  if (!VM_NAME_PATTERN.test(name)) {
    throw new Error('VM name may only use letters, digits, and . _ -')
  }
  const subscriptions = await listSubscriptions()
  const perSubscription = await Promise.all(
    subscriptions.map((subscription) => vmsNamed(name, subscription))
  )
  return perSubscription.flat()
}
