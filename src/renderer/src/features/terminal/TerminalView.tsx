import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClusterSummary } from '../../../../shared/types'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

interface TerminalViewProps {
  cluster: ClusterSummary
  onClose: () => void
}

export default function TerminalView({ cluster, onClose }: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed'>('connecting')

  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    let sessionId: string | null = null

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
  }, [cluster.id])

  return (
    <div className="terminal-page">
      <header className="terminal-header">
        <div>
          <strong>{cluster.name}</strong>
          <span className="terminal-status"> — {status}</span>
        </div>
        <button className="btn" onClick={onClose}>
          Back to clusters
        </button>
      </header>
      {connectError && (
        <div className="error-banner" style={{ margin: 16 }}>
          {connectError}
        </div>
      )}
      <div className="terminal-container" ref={containerRef} />
    </div>
  )
}
