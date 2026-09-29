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

export function adoptLoginShellPath(): void {
  if (process.platform !== 'darwin') return
  const fromShell = loginShellPath(process.env.SHELL || '/bin/zsh')
  process.env.PATH = mergePaths(fromShell, process.env.PATH, FALLBACK_DIRS.join(':'))
}
