import { connect } from 'net'
import { request } from 'https'

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

function pingProxy(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({
      host,
      port,
      path: '/webapi/ping',
      method: 'GET',
      timeout: timeoutMs,
      // Liveness only: no credentials are sent and the response isn't trusted or read, so a
      // private-CA or self-signed proxy certificate (which tsh itself may be configured to trust)
      // shouldn't make a reachable proxy look offline. tsh verifies the certificate when it
      // actually connects.
      rejectUnauthorized: false
    })
    req.once('response', (res) => {
      res.resume()
      resolve(true)
    })
    req.once('timeout', () => req.destroy())
    req.once('error', () => resolve(false))
    req.end()
  })
}

/** Checks whether a Teleport proxy answers, via its unauthenticated /webapi/ping endpoint - the
 *  same first request tsh makes. The SSH-banner check above doesn't work here: the proxy's
 *  multiplexed port waits for the client to speak first. With no port given, tries 443 and then
 *  3080, the two ports tsh tries. */
export async function checkTeleportProxyReachable(
  proxy: string,
  timeoutMs = 5000
): Promise<boolean> {
  const address = proxy.replace(/^[a-z]+:\/\//i, '').split('/')[0]
  const match = /^(.*):(\d+)$/.exec(address)
  if (match) return pingProxy(match[1], Number(match[2]), timeoutMs)
  return (await pingProxy(address, 443, timeoutMs)) || pingProxy(address, 3080, timeoutMs)
}
