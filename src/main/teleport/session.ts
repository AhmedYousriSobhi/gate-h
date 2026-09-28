import scriptPath from '../../../resources/teleport.sh?asset&asarUnpack'
import type { ClusterSummary } from '../../shared/types'
import type { PtySpawnOptions } from '../pty/manager'

// A Teleport cluster's terminal is resources/teleport.sh running on a PTY: the script checks for
// a usable tsh session, logs in if there isn't one (the password/OTP prompts or SSO link show up
// in the terminal itself, where the user can answer them), then execs `tsh ssh`, which carries
// the shell for the rest of the session. Nothing is ever answered on the user's behalf, so no
// prompt can hang out of sight.

export function teleportSshCommand(cluster: ClusterSummary): PtySpawnOptions {
  const teleport = cluster.teleport
  if (!teleport) throw new Error(`${cluster.name} has no Teleport proxy configured`)
  const args = [scriptPath, 'ssh', '--proxy', teleport.proxy]
  if (teleport.cluster) args.push('--cluster', teleport.cluster)
  if (teleport.user) args.push('--user', teleport.user)
  if (teleport.authConnector) args.push('--auth', teleport.authConnector)
  args.push('--', `${cluster.connection.username}@${cluster.connection.host}`)
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
