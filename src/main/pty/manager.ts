import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'crypto'
import { homedir } from 'os'

// Runs local processes on a pseudo-terminal, for sessions that need a real TTY on this machine
// rather than an ssh2 channel - currently `tsh ssh` (see ../teleport/session.ts), whose Teleport
// certificate auth ssh2 can't do. A PTY is what makes interactive prompts (password/OTP), colors,
// full-screen tools and window resizes behave exactly as in a desktop terminal. Knows nothing
// about clusters or IPC: callers get output and exit through callbacks.

export interface PtySpawnOptions {
  file: string
  args: string[]
  cols?: number
  rows?: number
  env?: NodeJS.ProcessEnv
}

export interface PtyExit {
  exitCode: number
  /** Set when the process was killed by a signal. */
  signal?: number
}

export interface PtyHandlers {
  onData: (chunk: string) => void
  /** Called exactly once, however the process ends. */
  onExit: (exit: PtyExit) => void
}

interface PtySession {
  pty: IPty
  exited: boolean
  killTimer: ReturnType<typeof setTimeout> | null
}

// Guards resize() against a renderer sending a 0x0 size (a hidden or collapsed pane) or absurd
// values - the kernel accepts them, but a 0-column terminal breaks line editing on the far end.
const MIN_COLS = 2
const MIN_ROWS = 1
const MAX_DIMENSION = 1000
// How long a SIGHUP'd process gets to exit on its own before it's SIGKILLed.
const KILL_GRACE_MS = 3000

function clamp(value: number, min: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.floor(value), min), MAX_DIMENSION)
}

export class PtyManager {
  private readonly sessions = new Map<string, PtySession>()

  /** Starts `file args` on a new PTY and returns the session's id. A missing executable doesn't
   *  throw: node-pty forks first, so it shows up as an `execvp(3) failed` line in the output and
   *  an exit with code 1. Throws only if the PTY itself can't be created. */
  spawn(options: PtySpawnOptions, handlers: PtyHandlers): string {
    const id = randomUUID()
    let pty: IPty
    try {
      pty = spawn(options.file, options.args, {
        name: 'xterm-256color',
        cols: clamp(options.cols ?? 80, MIN_COLS),
        rows: clamp(options.rows ?? 24, MIN_ROWS),
        cwd: homedir(),
        env: {
          ...(options.env ?? process.env),
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`Could not start ${options.file}: ${reason}`)
    }

    const session: PtySession = { pty, exited: false, killTimer: null }
    this.sessions.set(id, session)

    pty.onData((chunk) => handlers.onData(chunk))
    pty.onExit(({ exitCode, signal }) => {
      session.exited = true
      if (session.killTimer) clearTimeout(session.killTimer)
      this.sessions.delete(id)
      handlers.onExit({ exitCode, signal: signal || undefined })
    })
    return id
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (session && !session.exited) session.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || session.exited) return
    try {
      session.pty.resize(clamp(cols, MIN_COLS), clamp(rows, MIN_ROWS))
    } catch (err) {
      // The process can exit between the check above and the ioctl; nothing left to resize.
      console.error('[gate-h] pty resize failed:', err instanceof Error ? err.message : err)
    }
  }

  /** Hangs up the session, as closing a terminal window does - shells and tsh exit cleanly on
   *  SIGHUP, and tsh closes its remote session on the way out. Escalates to SIGKILL if the
   *  process is still there after a grace period. The exit callback still fires. */
  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session || session.exited || session.killTimer) return
    try {
      session.pty.kill('SIGHUP')
    } catch {
      return
    }
    session.killTimer = setTimeout(() => {
      if (!session.exited) {
        try {
          session.pty.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      }
    }, KILL_GRACE_MS)
    // Don't hold the app open on quit just to wait out the grace period.
    session.killTimer.unref()
  }

  ids(): string[] {
    return Array.from(this.sessions.keys())
  }
}

export const ptyManager = new PtyManager()
