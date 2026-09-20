import { connect } from 'net'

/** Whether a TCP connection to host:port can be established within timeoutMs. Used as a cheap,
 *  privilege-free proxy for "is this cluster's SSH endpoint up" - unlike ICMP ping, it needs no
 *  raw sockets/root and reflects what actually matters here: can we SSH in right now. */
export function checkTcpReachable(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs })

    const finish = (result: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}
