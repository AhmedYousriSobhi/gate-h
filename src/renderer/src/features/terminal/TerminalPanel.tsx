import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClusterSummary } from '../../../../shared/types'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

interface TerminalPanelProps {
  cluster: ClusterSummary
}

type SessionStatus = 'connecting' | 'connected' | 'closed'

export default function TerminalPanel({ cluster }: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    let sessionId: string | null = null
    setStatus('connecting')
    setConnectError(null)

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      theme: { background: '#111318' }
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
      if (event.sessionId === sessionId) setStatus('closed')
    })
    const offError = window.api.ssh.onError((event) => {
      if (event.sessionId === sessionId) setConnectError(event.message)
    })

    const dataDisposable = term.onData((data) => {
      if (sessionId) window.api.ssh.write(sessionId, data)
    })

    window.api.ssh
      .connect(cluster.id)
      .then((result) => {
        if (disposed) {
          window.api.ssh.disconnect(result.sessionId)
          return
        }
        sessionId = result.sessionId
        setStatus('connected')
        window.api.ssh.resize(sessionId, term.cols, term.rows)
        term.focus()
      })
      .catch((err: Error) => {
        setConnectError(err.message)
        setStatus('closed')
      })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      offData()
      offClosed()
      offError()
      dataDisposable.dispose()
      if (sessionId) window.api.ssh.disconnect(sessionId)
      term.dispose()
    }
  }, [cluster.id, attempt])

  return (
    <div className="terminal-panel">
      <div className="terminal-statusbar">
        <span>
          {cluster.connection.username}@{cluster.connection.host} — {status}
        </span>
        {status === 'closed' && (
          <button className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>
            Reconnect
          </button>
        )}
      </div>
      {connectError && <div className="error-banner terminal-error">{connectError}</div>}
      <div className="terminal-container" ref={containerRef} />
    </div>
  )
}
