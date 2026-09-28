import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { LogIn, RefreshCw, Search, X } from 'lucide-react'
import type {
  ClusterReachability,
  ClusterSummary,
  TeleportSessionInfo
} from '../../../../shared/types'
import TeleportLoginDialog from './TeleportLoginDialog'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

interface TerminalPanelProps {
  cluster: ClusterSummary
  /** This cluster's live reachability reading, pushed by the main process roughly every 60s (see
   *  src/main/monitor/clusterMonitor.ts) as well as right after focus/edit events - a *new object*
   *  each time, even when the status value repeats. Read directly (not diffed against the
   *  previous reading) so a session sitting `paused` gets re-checked on every one of those pushes,
   *  not just the specific moment reachability flips offline -> online - the cluster can come back
   *  online (or already be online at mount) with no such flip ever being observed here. */
  reachability?: ClusterReachability
  onStatusChange?: (status: SessionStatus) => void
  /** Ctrl/Cmd+Tab (+Shift to reverse) cycles the enclosing tab strip - forwarded up rather than
   *  handled here since this component has no notion of sibling tabs. */
  onCycleTab?: (direction: 1 | -1) => void
  /** Ctrl/Cmd+Shift+5 - splits this session, forwarded up for the same reason as onCycleTab. */
  onSplit?: () => void
}

/** `auth-required`: a Teleport terminal with no usable tsh session. Unlike `paused`, reachability
 *  never resumes it - the proxy being up doesn't make a login happen - only a session update
 *  (a login here, on another cluster sharing the proxy, or with tsh in any terminal) does. */
export type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'paused' | 'auth-required'

// Bounded, backoff-based retry policy: at most MAX_RECONNECT_ATTEMPTS auto-retries within a
// rolling RECONNECT_WINDOW_MS window, each spaced out exponentially with jitter, then the session
// pauses entirely rather than hammering the cluster's SSH daemon - a login node that's actually
// down (vs. transiently flaky) shouldn't see a retry storm that risks tripping fail2ban or similar.
const MAX_RECONNECT_ATTEMPTS = 2
const RECONNECT_WINDOW_MS = 2 * 60_000
const BASE_RECONNECT_DELAY_MS = 5_000
const RECONNECT_JITTER_MS = 1_000
// How long a session must stay up before it counts as a real connection and restores the retry
// budget. Resetting the moment connect() resolves isn't enough: a Teleport session "connects" as
// soon as its local PTY starts, and tsh can still fail to reach the proxy a moment later - so a
// down proxy would reset the budget on every attempt and retry forever.
const STABLE_SESSION_MS = 30_000
// Matches the session monitor's warning and teleport.sh's --min-ttl floor: with less than this
// left, a resume would only be turned away again.
const TELEPORT_WARN_MS = 15 * 60_000
const TELEPORT_MIN_TTL_MS = 5 * 60_000

function msLeft(info: TeleportSessionInfo | undefined): number {
  return info?.validUntil ? Date.parse(info.validUntil) - Date.now() : -Infinity
}

export default function TerminalPanel({
  cluster,
  reachability,
  onStatusChange,
  onCycleTab,
  onSplit
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // The connect effect below only re-runs on cluster.id/connectNonce changes, so it captures
  // onCycleTab once at setup time - kept fresh here instead of adding it to that effect's deps,
  // which would otherwise reconnect the SSH session whenever the callback identity changes.
  const onCycleTabRef = useRef(onCycleTab)
  useEffect(() => {
    onCycleTabRef.current = onCycleTab
  }, [onCycleTab])
  const onSplitRef = useRef(onSplit)
  useEffect(() => {
    onSplitRef.current = onSplit
  }, [onSplit])
  const [connectError, setConnectError] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [connectNonce, setConnectNonce] = useState(0)
  // Latest Azure pre-flight progress line ("Checking Azure CLI session", a device-code login
  // prompt, "Tunnel active on port X", ...) - shown while not connected.
  const [tunnelMessage, setTunnelMessage] = useState<string | null>(null)
  // Teleport only: expiry of this cluster's tsh session, and whether it's within the warning
  // window. Both come from session updates, which the main process also pushes at the warning
  // and expiry times, so no countdown timer is needed here.
  const [teleportExpiry, setTeleportExpiry] = useState<{
    at: string
    soon: boolean
    expired: boolean
  } | null>(null)
  const [loginDialog, setLoginDialog] = useState<{ renew: boolean } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
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
    // Re-checked on every reachability push for this cluster (roughly every 60s, same cadence the
    // reachability sweep itself uses - frequent enough to notice the node coming back, restrained
    // enough not to look like abuse), not just on a detected offline -> online flip - only worth
    // acting on when the session is actually sitting paused; a connecting/connected/retrying
    // session has nothing to nudge.
    if (reachability?.status === 'online' && statusRef.current === 'paused') {
      resetAndReconnectNow()
    }
  }, [reachability, resetAndReconnectNow])

  useEffect(
    () =>
      window.api.azure.onStatus((event) => {
        if (event.clusterId === cluster.id) setTunnelMessage(event.message)
      }),
    [cluster.id]
  )

  const isTeleport = Boolean(cluster.teleport)
  useEffect(() => {
    if (!isTeleport) return
    let disposed = false
    const apply = (sessions: Record<string, TeleportSessionInfo>): void => {
      if (disposed) return
      const info = sessions[cluster.id]
      const left = msLeft(info)
      // Past expiry the chip stays: an open shell may keep running, but new connections won't.
      setTeleportExpiry(
        info?.validUntil
          ? { at: info.validUntil, soon: left < TELEPORT_WARN_MS, expired: left <= 0 }
          : null
      )
      if (statusRef.current === 'auth-required' && left > TELEPORT_MIN_TTL_MS) {
        resetAndReconnectNow()
      }
    }
    void window.api.teleport.sessions().then(apply)
    const off = window.api.teleport.onSessions(apply)
    return () => {
      disposed = true
      off()
    }
  }, [cluster.id, isTeleport, resetAndReconnectNow])

  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    let sessionId: string | null = null
    let stableTimer: ReturnType<typeof setTimeout> | null = null
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
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    // Default handler (window.open) is already routed through shell.openExternal by the
    // app-wide setWindowOpenHandler in src/main/index.ts, so clicked links open safely without
    // a custom handler here.
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fitAddon.fit()

    // Intercepted before xterm turns them into control bytes for the shell, so Ctrl+F opens the
    // search bar instead of sending ACK, and Ctrl/Cmd+Shift+C/V copy/paste the OS clipboard
    // without touching Ctrl+C's SIGINT (which has no Shift and is left to the default handler).
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key === 'Tab') {
        event.preventDefault()
        onCycleTabRef.current?.(event.shiftKey ? -1 : 1)
        return false
      }
      // VS Code's split-terminal chord. `code`, not `key` - with Shift held, `key` is '%' on a
      // US layout and something else elsewhere.
      if (mod && event.shiftKey && event.code === 'Digit5') {
        event.preventDefault()
        onSplitRef.current?.()
        return false
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        return false
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        const selection = term.getSelection()
        if (selection) void navigator.clipboard.writeText(selection)
        return false
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'v') {
        // preventDefault matters here: without it, Chromium's own "paste without formatting"
        // shortcut (Ctrl+Shift+V) also fires on xterm's focused hidden textarea, so the browser
        // pastes natively into it on top of the clipboard write below - doubling the pasted text.
        event.preventDefault()
        void navigator.clipboard.readText().then((text) => {
          if (sessionId) window.api.ssh.write(sessionId, text)
        })
        return false
      }
      return true
    })

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
      if (stableTimer) clearTimeout(stableTimer)
      if (event.authRequired) {
        clearRetryTimer()
        setStatus('auth-required')
        return
      }
      scheduleReconnectOrPause()
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
        stableTimer = setTimeout(() => {
          windowStartRef.current = Date.now()
          attemptsRef.current = 0
          setRetryAttempt(0)
        }, STABLE_SESSION_MS)
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
      if (stableTimer) clearTimeout(stableTimer)
      resizeObserver.disconnect()
      offData()
      offClosed()
      offError()
      dataDisposable.dispose()
      if (sessionId) window.api.ssh.disconnect(sessionId)
      term.dispose()
      searchAddonRef.current = null
      setSearchOpen(false)
    }
  }, [cluster.id, connectNonce, scheduleReconnectOrPause])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const closeSearch = useCallback((): void => {
    setSearchOpen(false)
    searchAddonRef.current?.clearDecorations()
  }, [])

  const runSearch = useCallback(
    (direction: 'next' | 'previous'): void => {
      if (!searchQuery) return
      const addon = searchAddonRef.current
      if (direction === 'next') addon?.findNext(searchQuery)
      else addon?.findPrevious(searchQuery)
    },
    [searchQuery]
  )

  const statusLabel =
    status === 'reconnecting'
      ? `reconnecting (attempt ${retryAttempt}/${MAX_RECONNECT_ATTEMPTS})`
      : status === 'auth-required'
        ? 'login needed'
        : status

  return (
    <div className="terminal-panel">
      <div className="terminal-statusbar">
        <span className="terminal-statusbar-label">
          <span className={`session-dot session-dot-${status}`} />
          <span className="mono">
            {cluster.connection.username}@{cluster.connection.host}
            {cluster.azureTunnel && ` via Azure tunnel :${cluster.azureTunnel.localPort}`}
            {cluster.teleport && ` via Teleport ${cluster.teleport.proxy}`}
          </span>
          <span className="terminal-status-word">{statusLabel}</span>
        </span>
        {teleportExpiry?.soon && (
          <span className="terminal-statusbar-teleport">
            {teleportExpiry.expired
              ? 'Teleport login expired'
              : `Teleport login expires at ${new Date(teleportExpiry.at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}`}
            <button className="btn btn-sm" onClick={() => setLoginDialog({ renew: true })}>
              {teleportExpiry.expired ? 'Log in' : 'Renew'}
            </button>
          </span>
        )}
      </div>
      {connectError && <div className="error-banner terminal-error">{connectError}</div>}
      <div className="terminal-body">
        <div className="terminal-container" ref={containerRef} />
        {searchOpen && (
          <div className="terminal-search">
            <Search size={13} strokeWidth={2} />
            <input
              ref={searchInputRef}
              className="terminal-search-input"
              placeholder="Find in this session"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeSearch()
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  runSearch(e.shiftKey ? 'previous' : 'next')
                }
              }}
            />
            <button className="btn-icon" title="Close search" onClick={closeSearch}>
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        )}
        {/* Shades the (possibly stale) terminal buffer whenever there's no live session, so it's
            never mistaken for a connected, responsive prompt. */}
        {status !== 'connected' && (
          <div className="terminal-shade">
            {status === 'connecting' && <p>Connecting to {cluster.connection.host}...</p>}
            {status === 'reconnecting' && (
              <p>
                Reconnecting to {cluster.connection.host} (attempt {retryAttempt}/
                {MAX_RECONNECT_ATTEMPTS})...
              </p>
            )}
            {cluster.azureTunnel &&
              tunnelMessage &&
              (status === 'connecting' || status === 'reconnecting') && (
                <p className="terminal-shade-detail">{tunnelMessage}</p>
              )}
            {status === 'auth-required' && (
              <>
                <p className="terminal-shade-title">Teleport login needed</p>
                <p>
                  There&apos;s no valid Teleport session for {cluster.teleport?.proxy}. Log in once
                  and every cluster behind this proxy reconnects.
                </p>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => setLoginDialog({ renew: false })}
                >
                  <LogIn size={13} strokeWidth={2} />
                  Log in
                </button>
              </>
            )}
            {status === 'paused' && (
              <>
                <p className="terminal-shade-title">Not connected</p>
                <p>
                  {cluster.teleport
                    ? reachability?.status === 'offline'
                      ? `Waiting for the Teleport proxy ${cluster.teleport.proxy} to come back online - will reconnect automatically.`
                      : `Couldn't open a Teleport session to ${cluster.connection.host}.`
                    : cluster.azureTunnel
                      ? reachability?.status === 'offline'
                        ? `The Azure tunnel to ${cluster.connection.host} is down - Reconnect now re-opens it (signing in to Azure again if needed).`
                        : `Couldn't reach the SSH service on ${cluster.connection.host} through the Azure tunnel.`
                      : reachability?.status === 'offline'
                        ? `Waiting for ${cluster.connection.host} to come back online - will reconnect automatically.`
                        : `Couldn't reach the SSH service on ${cluster.connection.host}.`}
                </p>
                <button className="btn btn-sm" onClick={resetAndReconnectNow}>
                  <RefreshCw size={13} strokeWidth={2} />
                  Reconnect now
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {loginDialog && (
        <TeleportLoginDialog
          cluster={cluster}
          renew={loginDialog.renew}
          onClose={() => setLoginDialog(null)}
        />
      )}
    </div>
  )
}
