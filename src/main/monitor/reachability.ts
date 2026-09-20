import { connect } from 'net'

/**
 * Checks whether a cluster's SSH endpoint is actually up - not just whether its TCP port opens.
 *
 * This deliberately waits for the server's "SSH-2.0-..." identification banner and replies with
 * our own (as any real SSH client does) before closing, rather than connecting and immediately
 * hanging up. A bare connect-then-disconnect makes sshd log "Did not receive identification
 * string from <ip>" - the exact fingerprint fail2ban/sshguard and most HPC-center intrusion
 * detection watch for - so polling that way on a short interval can get a user's own IP
 * rate-limited or banned from their own cluster's login node (this happened during testing: the
 * first connection worked, then later real connection attempts started timing out during the SSH
 * handshake after the monitor had been probing every 20s for a while). This "connect, read the
 * banner, reply, disconnect" pattern is the same one monitoring tools like Nagios/Icinga's
 * check_ssh use, and is recognized as benign SSH-aware monitoring rather than a port scan.
 */
export function checkTcpReachable(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const socket = connect({ host, port, timeout: timeoutMs })

    const finish = (result: boolean, graceful = false): void => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      if (graceful) socket.end()
      else socket.destroy()
      resolve(result)
    }

    socket.once('data', (chunk: Buffer) => {
      const isSshBanner = chunk.toString('latin1', 0, 4) === 'SSH-'
      if (isSshBanner) {
        // Behave like a real client: reply with our own identification string before closing,
        // instead of just vanishing once we've seen what we came for.
        socket.write('SSH-2.0-GateH_HealthCheck\r\n')
      }
      finish(isSshBanner, true)
    })

    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}
