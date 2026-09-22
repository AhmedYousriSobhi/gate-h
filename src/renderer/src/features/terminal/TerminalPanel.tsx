import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RefreshCw } from 'lucide-react'
import type { ClusterSummary } from '../../../../shared/types'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

interface TerminalPanelProps {
  cluster: ClusterSummary
  /** Bumped by AppShell whenever this specific cluster's reachability flips offline -> online
   *  (e.g. the user just reconnected their VPN) - if the session is sitting paused/closed, this
   *  resets the backoff window and retries immediately, instead of waiting out the rest of it. */
  reconnectSignal: number
  onStatusChange?: (status: SessionStatus) => void
}

export type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'paused'

// Bounded, backoff-based retry policy: at most MAX_RECONNECT_ATTEMPTS auto-retries within a
// rolling RECONNECT_WINDOW_MS window, each spaced out exponentially with jitter, then the session
// pauses entirely rather than hammering the cluster's SSH daemon - a login node that's actually
// down (vs. transiently flaky) shouldn't see a retry storm that risks tripping fail2ban or similar.
const MAX_RECONNECT_ATTEMPTS = 2
const RECONNECT_WINDOW_MS = 2 * 60_000
const BASE_RECONNECT_DELAY_MS = 5_000
const RECONNECT_JITTER_MS = 1_000

export default function TerminalPanel({
  cluster,
  reconnectSignal,
  onStatusChange
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [connectNonce, setConnectNonce] = useState(0)
  const statusRef = useRef<SessionStatus>(status)
  useEffect(() => {
    statusRef.current = status
    onStatusChange?.(status)
  }, [status, onStatusChange])

  // 0 rather than Date.now() (an impure call not allowed during render) - the first failure will
  // always see the window as expired and reset it, which is the correct behavior anyway.
  const windowStartRef = useRef(0)
  const attemptsRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastHandledReconnectSignal = useRef(reconnectSignal)

  function clearRetryTimer(): void {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  /** Called whenever a connection attempt fails or an established session drops. Schedules a
   *  backed-off retry if the rolling window still has attempts left, otherwise pauses. */
  const scheduleReconnectOrPause = useCallback((): void => {
    const now = Date.now()
    if (now - windowStartRef.current > RECONNECT_WINDOW_MS) {
      windowStartRef.current = now
      attemptsRef.current = 0
    }

    if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('paused')
      return
    }

    attemptsRef.current += 1
    setRetryAttempt(attemptsRef.current)
    setStatus('reconnecting')
    const delay =
      BASE_RECONNECT_DELAY_MS * 2 ** (attemptsRef.current - 1) + Math.random() * RECONNECT_JITTER_MS
    clearRetryTimer()
    retryTimerRef.current = setTimeout(() => setConnectNonce((n) => n + 1), delay)
  }, [])

  /** Manual "Reconnect" click, or a reachability recovery signal for this cluster - both reset
   *  the backoff window so a fresh burst of attempts is available rather than inheriting whatever
   *  was left over from the failure that caused the pause. */
  const resetAndReconnectNow = useCallback((): void => {
    clearRetryTimer()
    windowStartRef.current = Date.now()
    attemptsRef.current = 0
    setRetryAttempt(0)
    setStatus('connecting')
    setConnectNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (reconnectSignal === lastHandledReconnectSignal.current) return
    lastHandledReconnectSignal.current = reconnectSignal
    // Only worth nudging if the session is sitting idle - if it's already connecting/connected/
    // retrying there's nothing to do.
    if (statusRef.current === 'paused') {
      resetAndReconnectNow()
    }
  }, [reconnectSignal, resetAndReconnectNow])

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
      if (event.sessionId === sessionId && !disposed) scheduleReconnectOrPause()
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
        windowStartRef.current = Date.now()
        attemptsRef.current = 0
        setRetryAttempt(0)
        setStatus('connected')
        window.api.ssh.resize(sessionId, term.cols, term.rows)
        term.focus()
      })
      .catch((err: Error) => {
        setConnectError(err.message)
        if (!disposed) scheduleReconnectOrPause()
      })

    return () => {
      disposed = true
      clearRetryTimer()
      resizeObserver.disconnect()
      offData()
      offClosed()
      offError()
      dataDisposable.dispose()
      if (sessionId) window.api.ssh.disconnect(sessionId)
      term.dispose()
    }
  }, [cluster.id, connectNonce, scheduleReconnectOrPause])

  const statusLabel =
    status === 'reconnecting'
      ? `reconnecting (attempt ${retryAttempt}/${MAX_RECONNECT_ATTEMPTS})`
      : status

  return (
    <div className="terminal-panel">
      <div className="terminal-statusbar">
        <span className="terminal-statusbar-label">
          <span className={`session-dot session-dot-${status}`} />
          <span className="mono">
            {cluster.connection.username}@{cluster.connection.host}
          </span>
          <span className="terminal-status-word">{statusLabel}</span>
        </span>
        {status === 'paused' && (
          <button className="btn btn-sm" onClick={resetAndReconnectNow}>
            <RefreshCw size={13} strokeWidth={2} />
            Reconnect
          </button>
        )}
      </div>
      {connectError && <div className="error-banner terminal-error">{connectError}</div>}
      <div className="terminal-container" ref={containerRef} />
    </div>
  )
}
