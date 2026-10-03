import { app } from 'electron'
import { execFile, spawn, type ChildProcess, type ExecFileException } from 'child_process'
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
import scriptPath from '../../../resources/azure-tunnel.sh?asset&asarUnpack'
import { listClusters } from '../clusters'
import { checkTcpReachable } from '../monitor/reachability'
import type {
  AzureAuthState,
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

// Every tenant gets its own Azure CLI profile (config dir + MSAL token cache), because the CLI's
// default one is machine-wide: signing into tenant B there replaces tenant A's active session, and
// concurrent `az` processes can corrupt each other's token cache writes (Microsoft's own guidance
// is one AZURE_CONFIG_DIR per concurrent context). Clusters in the same tenant share a profile, so
// it's one sign-in per tenant. Passed through the spawned process's `env` only - never written to
// `process.env`, which would leak into every other `az`/ssh child this app (or the user's shell
// tooling) spawns. A cluster with no tenant keeps the CLI's default profile, unchanged.
const TENANT_PATTERN = /^[A-Za-z0-9.-]+$/

/** `execFile('az', ...)` with stdin closed straight away: execFile leaves it as an open pipe, so an
 *  unexpected prompt would otherwise sit there until the timeout instead of failing at once. */
function execAz(
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv; maxBuffer?: number },
  callback: (error: ExecFileException | null, stdout: string) => void
): ChildProcess {
  const child = execFile('az', args, options, (err, stdout) => callback(err, stdout))
  child.stdin?.end()
  return child
}

function profilesRoot(): string {
  return join(app.getPath('userData'), 'azure')
}

function profileDir(tenant: string): string {
  return join(profilesRoot(), tenant.toLowerCase())
}

/** Owner-only on the profile dir and everything in it (the CLI keeps tokens there as a plaintext
 *  file on Linux/macOS). `mkdirSync`'s mode only applies on creation and the CLI's own files take
 *  whatever umask it runs under, so this is re-applied rather than assumed. */
function lockDown(path: string): void {
  try {
    chmodSync(path, 0o700)
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) lockDown(child)
      else chmodSync(child, 0o600)
    }
  } catch {
    // Best effort (e.g. a file vanishing mid-walk, or Windows where chmod is mostly a no-op).
  }
}

function azureEnv(tenant?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The CLI >= 2.61 subscription picker waits on stdin, which none of our spawns provide.
    AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off'
  }
  if (tenant && TENANT_PATTERN.test(tenant)) {
    const dir = profileDir(tenant)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(profilesRoot(), 0o700)
    lockDown(dir)
    env.AZURE_CONFIG_DIR = dir
  }
  return env
}

/** Deletes a tenant's profile - i.e. signs it out. Only ever the app's own directory under
 *  userData, never the CLI's default `~/.azure`. */
function removeProfile(tenant: string): void {
  if (TENANT_PATTERN.test(tenant)) rmSync(profileDir(tenant), { recursive: true, force: true })
}

/** Drops profiles no cluster's tunnel refers to any more (cluster removed, or its tenant
 *  changed), so signed-in state doesn't pile up on disk for tenants that are no longer used. Not
 *  tied to a session closing - that would force a fresh sign-in on every reconnect. */
export function pruneUnusedAzureProfiles(): void {
  const used = new Set(
    listClusters().flatMap((c) =>
      c.azureTunnel?.tenant ? [c.azureTunnel.tenant.toLowerCase()] : []
    )
  )
  let dirs: string[]
  try {
    dirs = readdirSync(profilesRoot())
  } catch {
    return
  }
  for (const name of dirs) if (!used.has(name)) removeProfile(name)
}

function runUp(cluster: ClusterSummary): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath, ...upArgs(cluster)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: azureEnv(cluster.azureTunnel?.tenant)
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

const AUTH_CHECK_TIMEOUT_MS = 10_000

/** The local Azure CLI's cached sign-in state, scoped to `tenant` when given - mirrors the
 *  script's own `ensure_login` check (resources/azure-tunnel.sh) but run directly so a caller can
 *  tell "no valid session" apart *before* the script's `az login` fallback would kick in and
 *  start an unannounced device-code wait. Two clusters in different tenants need two separate
 *  sign-ins (same Outlook account, different `az login --tenant`); without `tenant`, a valid
 *  session for one tenant would read as "valid" for the other too, since `az account show` with
 *  no filter just reports whichever account is currently active CLI-wide. `az account list` is
 *  used instead of `account show` so a cached-but-inactive tenant still resolves instead of only
 *  ever reporting the active one. */
// TENANT_PATTERN (above) also keeps the tenant safe to interpolate into the JMESPath query below.

export function checkAzureAuth(tenant?: string): Promise<AzureAuthState> {
  return new Promise((resolve) => {
    const scopedTenant = tenant && TENANT_PATTERN.test(tenant) ? tenant : undefined
    const listArgs = scopedTenant
      ? [
          'account',
          'list',
          '--only-show-errors',
          '--query',
          `[?tenantId=='${scopedTenant}'].user.name | [0]`,
          '--output',
          'tsv'
        ]
      : ['account', 'show', '--only-show-errors', '--query', 'user.name', '--output', 'tsv']
    const env = azureEnv(scopedTenant)
    execAz(listArgs, { timeout: AUTH_CHECK_TIMEOUT_MS, env }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ status: 'cli-missing' })
        return
      }
      const account = err ? undefined : stdout.trim() || undefined
      if (!account) {
        resolve({ status: 'signed-out' })
        return
      }
      const tokenArgs = ['account', 'get-access-token', '--only-show-errors', '--output', 'none']
      if (scopedTenant) tokenArgs.push('--tenant', scopedTenant)
      execAz(tokenArgs, { timeout: AUTH_CHECK_TIMEOUT_MS, env }, (tokenErr) =>
        resolve({ status: tokenErr ? 'expired' : 'valid', account })
      )
    })
  })
}

/** A headless Linux box has no browser to hand `az login` off to - same check as the script's
 *  `is_interactive`/`ensure_login` (resources/azure-tunnel.sh). macOS/Windows always have one. */
function needsDeviceCode(): boolean {
  return process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
}

/** Runs `az login`, broadcasting every line of its progress (device-code prompt, desktop-browser
 *  status, or its eventual error) through the same `azure:status` channel a tunnel pre-flight uses
 *  - see TerminalPanel's "Authenticate" action. Only ever started from that explicit click, never
 *  automatically. */
const LOGIN_TIMEOUT_MS = 10 * 60_000

export function loginAzure(cluster: ClusterSummary, deviceCode = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['login', '--only-show-errors', '--output', 'none']
    // Device-code login never touches the browser's cached SSO, so it's also how the user picks
    // exactly which account signs in (they open the code page in whichever browser profile they like).
    if (deviceCode || needsDeviceCode()) args.push('--use-device-code')
    const tenant = cluster.azureTunnel?.tenant
    if (tenant) args.push('--tenant', tenant)

    // Capped: a device-code login the user walks away from would otherwise wait forever.
    const child = spawn('az', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: azureEnv(tenant),
      timeout: LOGIN_TIMEOUT_MS
    })
    let lastError = ''

    createInterface({ input: child.stdout }).on('line', (line) => {
      broadcast?.({ clusterId: cluster.id, phase: 'auth', message: line.trim() })
    })
    createInterface({ input: child.stderr }).on('line', (line) => {
      const trimmed = line.trim()
      // Forward every line live (not just the device-code prompt) - `az login`'s own progress and
      // its eventual ERROR, if any, are the only way to tell "stuck silently" apart from "browser
      // opened but picked the wrong cached account for this tenant" apart from "actually working".
      if (trimmed) broadcast?.({ clusterId: cluster.id, phase: 'auth', message: trimmed })
      if (/^ERROR:/i.test(trimmed)) lastError = trimmed
    })

    child.on('error', (err) => {
      reject(new Error(`Could not run the Azure CLI (is 'az' installed?): ${err.message}`))
    })
    child.on('close', (code) => {
      if (code === 0) {
        if (tenant && TENANT_PATTERN.test(tenant)) lockDown(profileDir(tenant))
        broadcast?.({ clusterId: cluster.id, phase: 'auth', message: 'Logged in to Azure' })
        resolve()
        return
      }
      reject(
        new Error(
          lastError ||
            (code === null
              ? 'az login timed out - start again with Authenticate'
              : `az login failed (exit code ${code})`)
        )
      )
    })
  })
}

/** Signs a cluster's tenant out by deleting its app-owned Azure CLI profile - only that tenant, so
 *  other clusters' sessions are untouched. Needed because the browser's own Microsoft SSO session
 *  silently reuses whatever account is cached, so a wrong-account sign-in can only be redone from a
 *  clean slate. A cluster with no tenant has no profile of its own, so it falls back to
 *  `az account clear` on the CLI's default one. Only ever started from the user's explicit "Clear
 *  cached sign-in" action. */
export function clearAzureAuth(cluster: ClusterSummary): Promise<void> {
  const tenant = cluster.azureTunnel?.tenant
  if (tenant && TENANT_PATTERN.test(tenant)) {
    removeProfile(tenant)
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    execAz(['account', 'clear', '--only-show-errors'], { timeout: 20_000 }, (err) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error("Could not run the Azure CLI (is 'az' installed?)"))
        return
      }
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve()
    })
  })
}

// How long to wait for a live SSH banner after the script reports the tunnel's local port
// listening, before treating the attempt as a stale/slow relay and trying again. An IP-based
// Bastion connection in particular can take considerably longer than a few seconds to actually
// start relaying traffic after its local port opens.
const BANNER_WAIT_MS = 30_000
// One retry, with a fresh tunnel, before giving up - closes the azure-cli#28367 stale-port race
// (a dead relay whose local port stays listening) automatically instead of requiring the user to
// notice the failure and manually reconnect. Real-world testing against an IP-based Bastion target
// showed the *first* attempt after a cold tunnel start occasionally outliving one 30s window even
// though the relay was otherwise healthy - a second attempt on a fresh tunnel has so far always
// succeeded well inside its own window, so this is a liveness retry, not a longer single wait.
const BANNER_WAIT_ATTEMPTS = 2

/** Stage 2: the cluster's configured subscription must be visible to the account signed in for its
 *  tenant. Checked here, scoped per call (`--subscription`, never `az account set`), so a wrong or
 *  missing subscription fails with a clear message instead of a raw error from deep inside the
 *  tunnel script. */
function checkSubscription(cluster: ClusterSummary, account?: string): Promise<string> {
  const tunnel = cluster.azureTunnel
  return new Promise((resolve, reject) => {
    execAz(
      [
        'account',
        'show',
        '--only-show-errors',
        '--subscription',
        tunnel?.subscription ?? '',
        '--query',
        'name',
        '--output',
        'tsv'
      ],
      { timeout: AUTH_CHECK_TIMEOUT_MS, env: azureEnv(tunnel?.tenant) },
      (err, stdout) => {
        const name = err ? '' : stdout.trim()
        if (name) {
          resolve(name)
          return
        }
        reject(
          new Error(
            `Signed in${account ? ` as ${account}` : ''}, but subscription '${tunnel?.subscription}' ` +
              `isn't available${tunnel?.tenant ? ` in tenant ${tunnel.tenant}` : ''} - check the ` +
              "cluster's Azure subscription and tenant settings."
          )
        )
      }
    )
  })
}

/** Runs strictly in order, each stage gated on the previous one fully succeeding: (1) Azure
 *  sign-in for the cluster's tenant, (2) the configured subscription is available, (3) the tunnel
 *  opens (target resolved, local port listening), (4) a live SSH banner arrives through it.
 *
 *  Resolves once the cluster's tunnel is listening *and* actually carries traffic - reusing the
 *  tunnel if it's already up (the script's `up` is idempotent). Fails fast on a missing/expired
 *  Azure sign-in instead of falling through to the script's own `az login` fallback, which would
 *  otherwise start an unannounced device-code wait on every connect attempt - signing in is only
 *  ever started by the user's explicit "Authenticate" action (see loginAzure).
 *
 *  The script's own readiness check only waits for the *local* port to start listening, which can
 *  happen before Azure Bastion's backend relay to the target has actually finished establishing -
 *  connecting through it that early gets a TCP accept but no SSH banner ever arrives (the same
 *  azure-cli#28367 symptom `verifyTunnel` already checks for, here closing the race instead of
 *  just diagnosing it after the fact). Waiting here is cheap on an already-warm, reused tunnel
 *  (its banner arrives near-instantly) and only adds real latency in the exact case being fixed.
 *  If the banner still hasn't shown up after a full wait, tears the tunnel down and tries once
 *  more on a fresh one before surfacing an error - see BANNER_WAIT_ATTEMPTS. */
export function ensureTunnel(cluster: ClusterSummary): Promise<void> {
  const pending = pendingUps.get(cluster.id)
  if (pending) return pending
  const run = (async () => {
    const auth = await checkAzureAuth(cluster.azureTunnel?.tenant)
    if (auth.status !== 'valid') {
      throw new Error(
        auth.status === 'cli-missing'
          ? "Azure CLI ('az') not found on PATH."
          : auth.account
            ? `Azure sign-in for ${auth.account} has expired - authenticate and retry.`
            : 'No Azure sign-in found - authenticate and retry.'
      )
    }
    broadcast?.({
      clusterId: cluster.id,
      phase: 'auth',
      message: `Step 1/4: signed in${auth.account ? ` as ${auth.account}` : ''}`
    })
    const subscriptionName = await checkSubscription(cluster, auth.account)
    broadcast?.({
      clusterId: cluster.id,
      phase: 'subscription',
      message: `Step 2/4: subscription '${subscriptionName}' available`
    })
    const tunnel = cluster.azureTunnel
    for (let attempt = 1; attempt <= BANNER_WAIT_ATTEMPTS; attempt++) {
      broadcast?.({
        clusterId: cluster.id,
        phase: 'tunnel',
        message: 'Step 3/4: opening the tunnel'
      })
      await runUp(cluster)
      if (!tunnel) return
      broadcast?.({
        clusterId: cluster.id,
        phase: 'tunnel',
        message:
          attempt === 1
            ? 'Step 4/4: waiting for a live SSH banner through the tunnel'
            : 'Still no banner - opened a fresh tunnel, waiting again'
      })
      const bannerReceived = await checkTcpReachable('127.0.0.1', tunnel.localPort, BANNER_WAIT_MS)
      if (bannerReceived) return
      if (attempt === BANNER_WAIT_ATTEMPTS) {
        throw new Error(
          `Tunnel opened on port ${tunnel.localPort} but no SSH banner arrived within ` +
            `${BANNER_WAIT_MS / 1000}s, across ${BANNER_WAIT_ATTEMPTS} attempts on fresh tunnels - ` +
            'the relay to the target may not be reachable at all (not just slow). Check the ' +
            "target's Bastion IP-based connection setting and NSG rules."
        )
      }
      await stopTunnel(cluster.id)
    }
  })().finally(() => pendingUps.delete(cluster.id))
  pendingUps.set(cluster.id, run)
  return run
}

/** On-demand self-check: opens (or reuses) the cluster's real tunnel - the same one a real connect
 *  would use, so a user can run it before opening a terminal. `ensureTunnel` itself already waits
 *  for a live SSH banner (not just the local port listening, which a known az CLI bug can leave
 *  true even after the session itself has silently died - azure-cli#28367), so a successful
 *  resolve here already proves the tunnel carries traffic end to end. */
export async function verifyTunnel(cluster: ClusterSummary): Promise<AzureTunnelVerifyResult> {
  if (!cluster.azureTunnel) throw new Error(`${cluster.name} has no Azure tunnel configured`)
  const startedAt = Date.now()
  try {
    await ensureTunnel(cluster)
  } catch (err) {
    return { tunnelOpened: false, tunnelError: err instanceof Error ? err.message : String(err) }
  }
  return { tunnelOpened: true, latencyMs: Date.now() - startedAt }
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
    execAz(
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
    execAz(
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
