import scriptPath from '../../../resources/teleport.sh?asset&asarUnpack'
import type { ClusterSummary } from '../../shared/types'
import type { PtySpawnOptions } from '../pty/manager'

// A Teleport cluster's terminal is resources/teleport.sh running on a PTY: the script checks for
// a usable tsh session, then execs `tsh ssh`, which carries the shell for the rest of the
// session. The terminal never logs in by itself (`--no-login`): with no usable session it exits
// with EXIT_NO_SESSION, and the renderer shows a "Log in" action instead. Logging in is its own,
// user-started PTY (teleportLoginCommand), so a pinned cluster in the background, or a reconnect
// nobody is watching, can't open SSO browser tabs or sit on a password prompt out of sight.

/** teleport.sh's exit code for "no usable session and --no-login was given". */
export const EXIT_NO_SESSION = 4

function scopeArgs(cluster: ClusterSummary): string[] {
  const teleport = cluster.teleport
  if (!teleport) throw new Error(`${cluster.name} has no Teleport proxy configured`)
  const args = ['--proxy', teleport.proxy]
  if (teleport.cluster) args.push('--cluster', teleport.cluster)
  if (teleport.user) args.push('--user', teleport.user)
  if (teleport.authConnector) args.push('--auth', teleport.authConnector)
  return args
}

export function teleportSshCommand(cluster: ClusterSummary): PtySpawnOptions {
  return {
    file: 'bash',
    args: [
      scriptPath,
      'ssh',
      ...scopeArgs(cluster),
      '--no-login',
      '--',
      `${cluster.connection.username}@${cluster.connection.host}`
    ]
  }
}

/** The interactive login: password/OTP prompts in the PTY, or tsh opening the browser for SSO.
 *  `renew` replaces a still-valid session (see teleport.sh's `login --force`). */
export function teleportLoginCommand(cluster: ClusterSummary, renew: boolean): PtySpawnOptions {
  const args = [scriptPath, 'login', ...scopeArgs(cluster)]
  if (renew) args.push('--force')
  return { file: 'bash', args }
}

/** Follows the script's `STATUS <phase> <message>` lines in the PTY output until the session
 *  check passes, so a failed check (proxy unreachable, login failed, tsh missing) can be shown as
 *  the terminal's error instead of just scrolling past. Stops reading at `valid`: from then on the
 *  output is the remote shell's, which could contain anything. */
export class TeleportPreflight {
  private pending = ''
  private done = false
  error: string | null = null

  feed(chunk: string): void {
    if (this.done) return
    const lines = (this.pending + chunk).split('\n')
    this.pending = lines.pop() ?? ''
    for (const raw of lines) {
      const match = /^STATUS (\S+) (.*)$/.exec(raw.replace(/\r$/, ''))
      if (!match) continue
      if (match[1] === 'valid') {
        this.done = true
        this.error = null
        return
      }
      if (match[1] === 'error') this.error = match[2]
    }
  }
}
