import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClusterSummary } from '../../../../shared/types'
// The shared modal styles (.modal-overlay, .modal, .modal-actions) live with the cluster form.
import '../clusters/clusters.css'

interface TeleportLoginDialogProps {
  cluster: ClusterSummary
  /** Replace a still-valid session instead of reusing it (the Renew action). */
  renew: boolean
  onClose: () => void
}

type LoginState = 'running' | 'failed'

/** Runs the Teleport login on its own PTY, in a small terminal: the password/OTP prompts are
 *  answered here, or tsh opens the browser for SSO. Kept apart from the cluster's terminal, so
 *  renewing never touches a shell that's still in use. Closes itself on success - every terminal
 *  on the same proxy then resumes from the session update (see TerminalPanel). */
export default function TeleportLoginDialog({
  cluster,
  renew,
  onClose
}: TeleportLoginDialogProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<LoginState>('running')
  const [attempt, setAttempt] = useState(0)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false
    let sessionId: string | null = null
    setState('running')

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      theme: { background: '#0a0a0c', cursor: '#3b7cf6' }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (sessionId) window.api.ssh.resize(sessionId, term.cols, term.rows)
    })
    resizeObserver.observe(containerRef.current)
    const offData = window.api.ssh.onData((event) => {
      if (event.sessionId === sessionId) term.write(event.chunk)
    })
    const offClosed = window.api.ssh.onClosed((event) => {
      if (event.sessionId !== sessionId || disposed) return
      sessionId = null
      if (event.exitCode === 0) onCloseRef.current()
      else setState('failed')
    })
    const input = term.onData((data) => {
      if (sessionId) window.api.ssh.write(sessionId, data)
    })

    window.api.teleport
      .login(cluster.id, { renew })
      .then((result) => {
        if (disposed) {
          window.api.ssh.disconnect(result.sessionId)
          return
        }
        sessionId = result.sessionId
        window.api.ssh.resize(sessionId, term.cols, term.rows)
        term.focus()
      })
      .catch((err: Error) => {
        term.write(`\r\n${err.message}\r\n`)
        setState('failed')
      })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      offData()
      offClosed()
      input.dispose()
      // Closing the dialog mid-login cancels it.
      if (sessionId) window.api.ssh.disconnect(sessionId)
      term.dispose()
    }
  }, [cluster.id, renew, attempt])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal teleport-login">
        <h2>{renew ? 'Renew Teleport login' : 'Log in to Teleport'}</h2>
        <p className="hint">
          {cluster.teleport?.proxy}
          {cluster.teleport?.user && ` as ${cluster.teleport.user}`}. Answer the prompts below, or
          finish signing in in the browser window that opens.
          {renew && ' Renewing signs out of this proxy first; open terminals keep running.'}
        </p>
        <div className="teleport-login-terminal" ref={containerRef} />
        {state === 'failed' && (
          <p className="hint">Login didn&apos;t complete - the output above shows why.</p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {state === 'failed' ? 'Close' : 'Cancel'}
          </button>
          {state === 'failed' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
