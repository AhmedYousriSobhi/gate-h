import { execFileSync } from 'child_process'

// A macOS app started from Finder or the Dock gets launchd's minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), not the one the user's shell sets up - so `tsh`, `az`, and a
// Homebrew bash would all be "not found" even though they work in Terminal. This adopts the login
// shell's PATH once at startup (the same approach as the widely used fix-path/shell-path
// packages), plus Homebrew's default prefixes in case the shell can't be read.

const MARKER = '__GATEH_PATH__'
const FALLBACK_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']

/** The PATH `shell` reports as an interactive login shell, or null if it can't be read in time. */
export function loginShellPath(shell: string): string | null {
  try {
    const out = execFileSync(shell, ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return new RegExp(`${MARKER}(.*)${MARKER}`).exec(out)?.[1] || null
  } catch {
    return null
  }
}

/** Joins PATH lists in order of preference, dropping empty and repeated entries. */
export function mergePaths(...lists: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  for (const list of lists) {
    for (const dir of (list ?? '').split(':')) if (dir) seen.add(dir)
  }
  return [...seen].join(':')
}

/** SSL_CERT_FILE/SSL_CERT_DIR as the login shell would export them, or null for either that isn't
 *  set (or if the shell can't be read in time) - one combined invocation rather than two, since a
 *  login shell can take a moment to start. Needed for exactly the same reason PATH is: `tsh`
 *  verifying a Teleport proxy behind an internal CA reads these, and a Finder/Dock/`open`-launched
 *  app doesn't have either unless something adopts them the same way PATH is adopted below. */
export function loginShellSslCertEnv(shell: string): { file: string | null; dir: string | null } {
  try {
    const out = execFileSync(
      shell,
      [
        '-ilc',
        `printf '${MARKER}%s${MARKER}' "\${SSL_CERT_FILE:-}"; ` +
          `printf '${MARKER}%s${MARKER}' "\${SSL_CERT_DIR:-}"`
      ],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const matches = [...out.matchAll(new RegExp(`${MARKER}(.*?)${MARKER}`, 'g'))]
    return { file: matches[0]?.[1] || null, dir: matches[1]?.[1] || null }
  } catch {
    return { file: null, dir: null }
  }
}

export function adoptLoginShellPath(): void {
  if (process.platform !== 'darwin') return
  const shell = process.env.SHELL || '/bin/zsh'
  const fromShell = loginShellPath(shell)
  process.env.PATH = mergePaths(fromShell, process.env.PATH, FALLBACK_DIRS.join(':'))

  // Only filling in what's missing (not merging, unlike PATH) keeps an explicit
  // `SSL_CERT_FILE=... open ...`-style launch - which already reaches process.env normally -
  // taking priority over whatever the login shell's own profile sets.
  if (!process.env.SSL_CERT_FILE || !process.env.SSL_CERT_DIR) {
    const fromShellCerts = loginShellSslCertEnv(shell)
    if (!process.env.SSL_CERT_FILE && fromShellCerts.file) {
      process.env.SSL_CERT_FILE = fromShellCerts.file
    }
    if (!process.env.SSL_CERT_DIR && fromShellCerts.dir) {
      process.env.SSL_CERT_DIR = fromShellCerts.dir
    }
  }
}
