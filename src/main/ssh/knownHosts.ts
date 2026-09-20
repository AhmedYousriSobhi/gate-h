import { getDb } from '../db'

// Trust-on-first-use host key pinning, the same model OpenSSH's known_hosts file uses: the first
// time we connect to a given host:port we record the SHA-256 fingerprint of its presented host
// key, and every connection after that must present the same key. ssh2 has no verification at all
// by default (it will happily complete a handshake with any host key), so without this, Gate-H
// would be silently exposed to a man-in-the-middle presenting a different key - something every
// real SSH client (OpenSSH, PuTTY) refuses by default.

interface KnownHostRow {
  host_port: string
  fingerprint: string
}

function keyFor(host: string, port: number): string {
  return `${host}:${port}`
}

export type HostKeyCheck = 'trusted-first-use' | 'match' | 'mismatch'

/** Checks a presented host key fingerprint against the stored one for `host:port`, trusting and
 *  recording it if this is the first time we've seen this host. Returns which case applied so the
 *  caller can decide whether to notify the user (only 'mismatch' should block the connection). */
export function checkKnownHost(host: string, port: number, fingerprint: string): HostKeyCheck {
  const db = getDb()
  const key = keyFor(host, port)
  const row = db.prepare('SELECT * FROM known_hosts WHERE host_port = ?').get(key) as
    KnownHostRow | undefined

  if (!row) {
    db.prepare('INSERT INTO known_hosts (host_port, fingerprint, created_at) VALUES (?, ?, ?)').run(
      key,
      fingerprint,
      new Date().toISOString()
    )
    return 'trusted-first-use'
  }

  return row.fingerprint === fingerprint ? 'match' : 'mismatch'
}

/** Forgets a host's pinned key - used when the user explicitly confirms a host key change was
 *  expected (e.g. the cluster's login node was reimaged), so the next connection re-trusts it. */
export function forgetKnownHost(host: string, port: number): void {
  getDb().prepare('DELETE FROM known_hosts WHERE host_port = ?').run(keyFor(host, port))
}
