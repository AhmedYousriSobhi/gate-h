import { spawn, type ChildProcess } from 'child_process'
import { Duplex } from 'stream'
import type { Client } from 'ssh2'
import scriptPath from '../../../resources/teleport.sh?asset&asarUnpack'
import { buildConnectConfig, connectClient, type HostContext } from '../ssh/connect'
import { teleportScopeArgs } from './session'
import type { ConnectionProfile, TeleportConfig } from '../../shared/types'

// A jump host reached through a Teleport proxy (composable jump host - see ssh/manager.ts).
// Instead of the bare `tsh ssh` PTY a Teleport terminal normally uses, this runs `tsh proxy ssh`
// (resources/teleport.sh's `proxy-ssh` subcommand), which speaks raw SSH protocol on stdio - the
// same contract OpenSSH's ProxyCommand expects - and wraps that as a duplex socket for a real
// ssh2.Client to authenticate over, exactly like a plain TCP dial would for a Direct or
// Azure-tunneled jump host.
//
// Flagged risk: this is the one part of the composable-jump-host feature that could not be
// exercised against a real Teleport proxy in development - there is no `tsh` binary or live proxy
// available in that environment. Whatever credentials the user configured for the jump host
// (JumpHostConfig) are what authenticate this hop, same as any other jump host. If the jump host
// is itself a Teleport-enrolled node that only accepts Teleport-issued certificates rather than a
// password/key, this will not authenticate - that's a materially different setup not handled here.
// Verify against a real proxy before relying on this in production.

/** Resolves once `tsh proxy ssh` has produced a usable duplex and ssh2 has authenticated over it -
 *  rejects with the pre-flight's own error (proxy unreachable, no session, etc.) otherwise. The
 *  caller owns `process` and must kill it when the connection is torn down. */
export function connectViaTeleportProxy(
  teleport: TeleportConfig,
  target: ConnectionProfile,
  secret: string | null,
  hostContext: HostContext
): Promise<{ client: Client; process: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      [
        scriptPath,
        'proxy-ssh',
        ...teleportScopeArgs(teleport),
        '--no-login',
        '--',
        `${target.username}@${target.host}:${target.port}`
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    let settled = false
    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000)
    })

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      child.kill()
      reject(err)
    }
    child.on('error', fail)
    // A close before ssh2 finishes authenticating means the pre-flight itself failed (no session,
    // proxy unreachable, tsh missing) - once authenticated, `settled` is already true and a later
    // close is an ordinary disconnect the ssh2 client's own listeners handle.
    child.once('close', (code) => {
      if (!settled) fail(new Error(stderrTail.trim() || `tsh proxy ssh exited with code ${code}`))
    })

    // Plain pipes, not a PTY: a PTY would mangle the binary SSH protocol bytes with line-ending
    // and echo processing, the same reason execOverTeleport avoids one for scheduler commands.
    const sock = Duplex.from({ readable: child.stdout, writable: child.stdin })

    connectClient({ ...buildConnectConfig(target, secret, hostContext), sock })
      .then((client) => {
        settled = true
        resolve({ client, process: child })
      })
      .catch(fail)
  })
}
