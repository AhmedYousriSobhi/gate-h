import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import {
  Eraser,
  FileCode2,
  History,
  LogIn,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Settings2,
  SquareSplitHorizontal,
  SquareSplitVertical,
  X
} from 'lucide-react'
import type {
  ClusterReachability,
  ClusterSummary,
  Snippet,
  TeleportSessionInfo
} from '../../../../shared/types'
import TeleportLoginDialog from './TeleportLoginDialog'
import SnippetsDialog from './SnippetsDialog'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'
import { isMac, SPLIT_SHORTCUT_LABEL } from '../../lib/platform'
import {
  MAX_RECONNECT_ATTEMPTS,
  STABLE_SESSION_MS,
  useTerminalAuth,
  type SessionStatus
} from './useTerminalAuth'

export type { SessionStatus } from './useTerminalAuth'

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
  /** Pressing on the header bar - lets the session be dragged by it, like its tab. */
  onHeaderPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  /** The window title the remote shell sets (typically `user@host: ~/dir`) - used as the tab's
   *  default label, the way VS Code names a terminal after what's running in it. */
  onTitleChange?: (title: string) => void
  /** Header toolbar: which way the split button splits (sets its icon), whether this session is
   *  maximized over its stack, and the maximize/close actions - close is omitted for sessions
   *  that can't be closed, maximize for ones not shown alongside others. */
  splitDirection?: 'horizontal' | 'vertical'
  maximized?: boolean
  onToggleMaximize?: () => void
  onClose?: () => void
  /** True while this session's cluster isn't the selected one. The session stays connected and
   *  keeps receiving output, but stops resizing the remote pty (the pane is `display: none`, so a
   *  fit would only measure nothing) and refits once when it comes back. A suspended session that
   *  drops pauses instead of retrying, and reconnects when its cluster is selected again - so a
   *  pile of open background clusters can't all be retrying against their login nodes at once. */
  suspended?: boolean
}

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
  onSplit,
  onHeaderPointerDown,
  onTitleChange,
  splitDirection = 'vertical',
  maximized = false,
  onToggleMaximize,
  onClose,
  suspended = false
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
  const onTitleChangeRef = useRef(onTitleChange)
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange
  }, [onTitleChange])
  const auth = useTerminalAuth({
    clusterId: cluster.id,
    suspended,
    reachability,
    onStatusChange
  })
  // Teleport only: expiry of this cluster's tsh session, and whether it's within the warning
  // window. Both come from session updates, which the main process also pushes at the warning
  // and expiry times, so no countdown timer is needed here.
  const [teleportExpiry, setTeleportExpiry] = useState<{
    at: string
    soon: boolean
    expired: boolean
  } | null>(null)
  const [loginDialog, setLoginDialog] = useState<{ renew: boolean } | null>(null)
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [manageSnippetsOpen, setManageSnippetsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const refitRef = useRef<(() => void) | null>(null)
  // Mirrors the connect effect's own local `sessionId` so inserting a snippet (triggered from the
  // header, outside that effect) can write to whatever session is currently live.
  const sessionIdRef = useRef<string | null>(null)

  // Refit the terminal once coming back from the background - split out from the pause/resume
  // effect that now lives in useTerminalAuth, since this part is about the xterm instance, not
  // reconnect state. See useTerminalAuth's comment on why this split doesn't change behavior.
  useEffect(() => {
    if (!suspended) refitRef.current?.()
  }, [suspended])

  // Reloaded whenever the management dialog closes too, so an edit there shows up in the insert
  // popover without needing to reopen this session.
  useEffect(() => {
    let cancelled = false
    window.api.snippets
      .list()
      .then((list) => {
        if (!cancelled) setSnippets(list)
      })
      .catch(() => {
        // Best-effort: an empty list just means the insert popover has nothing to show.
      })
    return () => {
      cancelled = true
    }
  }, [manageSnippetsOpen])

  function insertSnippet(body: string): void {
    if (sessionIdRef.current) window.api.ssh.write(sessionIdRef.current, body)
    setSnippetsOpen(false)
  }

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
      if (auth.statusRef.current === 'auth-required' && left > TELEPORT_MIN_TTL_MS) {
        auth.resetAndReconnectNow()
      }
    }
    void window.api.teleport.sessions().then(apply)
    const off = window.api.teleport.onSessions(apply)
    return () => {
      disposed = true
      off()
    }
    // `auth` itself is a new object every render (useTerminalAuth isn't memoized as a whole), so
    // listing it here would re-subscribe on every render; `auth.resetAndReconnectNow` (useCallback
    // inside the hook) and `auth.statusRef` (a ref, stable identity) are the two actually-stable
    // pieces this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id, isTeleport, auth.resetAndReconnectNow, auth.statusRef])

  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    let sessionId: string | null = null
    let stableTimer: ReturnType<typeof setTimeout> | null = null
    auth.beginConnectAttempt(cluster.connection.host)

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
    // search bar instead of sending ACK, and Ctrl+Shift+C/V copy/paste the OS clipboard without
    // touching Ctrl+C's SIGINT (which has no Shift and is left to the default handler). On macOS
    // the app's own shortcuts use Cmd, as in Terminal.app and VS Code, and plain Ctrl is left to
    // the shell entirely (Ctrl+F is readline's forward-char there too); Cmd+C/V need nothing
    // here, since the Edit menu's copy/paste roles reach xterm as native copy/paste events.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const mod = isMac ? event.metaKey : event.ctrlKey || event.metaKey
      // Ctrl+Tab everywhere: on macOS Cmd+Tab belongs to the system's app switcher.
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        onCycleTabRef.current?.(event.shiftKey ? -1 : 1)
        return false
      }
      // VS Code's split-terminal chord: Cmd+\ on macOS, Ctrl+Shift+5 elsewhere. `code`, not
      // `key` - with Shift held, `key` is '%' on a US layout and something else elsewhere.
      const split = isMac
        ? mod && !event.shiftKey && event.code === 'Backslash'
        : mod && event.shiftKey && event.code === 'Digit5'
      if (split) {
        event.preventDefault()
        onSplitRef.current?.()
        return false
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        return false
      }
      if (isMac) return true
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

    const refit = (): void => {
      fitAddon.fit()
      if (sessionId) window.api.ssh.resize(sessionId, term.cols, term.rows)
    }
    refitRef.current = refit
    const resizeObserver = new ResizeObserver(() => {
      if (!auth.suspendedRef.current) refit()
    })
    resizeObserver.observe(containerRef.current)

    const offData = window.api.ssh.onData((event) => {
      if (event.sessionId === sessionId) term.write(event.chunk)
    })
    const offClosed = window.api.ssh.onClosed((event) => {
      if (event.sessionId !== sessionId || disposed) return
      if (stableTimer) clearTimeout(stableTimer)
      if (event.authRequired) {
        auth.clearRetryTimer()
        auth.setStatus('auth-required')
        auth.logEvent('Teleport login needed')
        return
      }
      auth.logEvent('Session closed unexpectedly')
      auth.scheduleReconnectOrPause()
    })
    const offError = window.api.ssh.onError((event) => {
      if (event.sessionId !== sessionId) return
      auth.setConnectError(event.message)
      auth.logEvent(event.message)
    })

    const dataDisposable = term.onData((data) => {
      if (sessionId) window.api.ssh.write(sessionId, data)
    })
    const titleDisposable = term.onTitleChange((title) => onTitleChangeRef.current?.(title))

    const attemptConnect = (): void => {
      window.api.ssh
        .connect(cluster.id)
        .then((result) => {
          if (disposed) {
            window.api.ssh.disconnect(result.sessionId)
            return
          }
          sessionId = result.sessionId
          sessionIdRef.current = sessionId
          stableTimer = setTimeout(auth.markSessionStable, STABLE_SESSION_MS)
          auth.setStatus('connected')
          auth.logEvent('Connected')
          window.api.ssh.resize(sessionId, term.cols, term.rows)
          term.focus()
        })
        .catch((err: Error) => {
          if (disposed) return
          if (!cluster.azureTunnel) {
            auth.setConnectError(err.message)
            auth.logEvent(err.message)
            auth.scheduleReconnectOrPause()
            return
          }
          // The pre-flight check below already screens out a missing/expired sign-in before this
          // runs - re-checking here only catches a token that expired in the gap between the two,
          // so a connect failure is never retried blindly when the real cause is one only the
          // user's "Authenticate" action can fix.
          window.api.azure.checkAuth(cluster.id).then((state) => {
            if (disposed) return
            if (state.status !== 'valid') {
              auth.setAzureAuthRequired(state)
              return
            }
            auth.setConnectError(err.message)
            auth.logEvent(err.message)
            auth.scheduleReconnectOrPause()
          })
        })
    }

    if (cluster.azureTunnel) {
      window.api.azure.checkAuth(cluster.id).then((state) => {
        if (disposed) return
        if (state.status !== 'valid') {
          auth.setAzureAuthRequired(state)
          return
        }
        attemptConnect()
      })
    } else {
      attemptConnect()
    }

    return () => {
      disposed = true
      auth.clearRetryTimer()
      if (stableTimer) clearTimeout(stableTimer)
      resizeObserver.disconnect()
      refitRef.current = null
      sessionIdRef.current = null
      offData()
      offClosed()
      offError()
      dataDisposable.dispose()
      titleDisposable.dispose()
      if (sessionId) window.api.ssh.disconnect(sessionId)
      term.dispose()
      searchAddonRef.current = null
      setSearchOpen(false)
    }
    // cluster.azureTunnel (read above, for the pre-flight auth check) is deliberately left out of
    // the deps below, same reasoning as cluster.id/cluster.connection.host: it's effectively
    // static for a given cluster.id, and reconnecting whenever an unrelated re-render hands this
    // component a new `cluster` object with the same data would defeat the narrowing those two
    // already do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cluster.id,
    cluster.connection.host,
    auth.connectNonce,
    auth.scheduleReconnectOrPause,
    auth.logEvent
  ])

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
    auth.status === 'reconnecting'
      ? `reconnecting (attempt ${auth.retryAttempt}/${MAX_RECONNECT_ATTEMPTS})`
      : auth.status === 'auth-required'
        ? 'login needed'
        : auth.status === 'azure-auth-required'
          ? 'azure sign-in needed'
          : auth.status

  return (
    <div className="terminal-panel">
      <div
        className={`terminal-statusbar${onHeaderPointerDown ? ' terminal-statusbar-draggable' : ''}`}
        onPointerDown={onHeaderPointerDown}
      >
        <span className="terminal-statusbar-label">
          <span className={`session-dot session-dot-${auth.status}`} />
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
        {/* Stops pointerdown so pressing a button never starts a header drag. */}
        <span className="terminal-header-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            className={`terminal-header-btn${snippetsOpen ? ' terminal-header-btn-active' : ''}`}
            title="Insert a saved snippet"
            aria-label="Snippets"
            aria-pressed={snippetsOpen}
            onClick={() => setSnippetsOpen((v) => !v)}
          >
            <FileCode2 size={13} strokeWidth={2} />
          </button>
          <button
            className={`terminal-header-btn${auth.logOpen ? ' terminal-header-btn-active' : ''}`}
            title="Connection log"
            aria-label="Connection log"
            aria-pressed={auth.logOpen}
            onClick={() => auth.setLogOpen((v) => !v)}
          >
            <History size={13} strokeWidth={2} />
          </button>
          {onSplit && (
            <button
              className="terminal-header-btn"
              title={`Split Terminal (${SPLIT_SHORTCUT_LABEL})`}
              aria-label="Split terminal"
              onClick={onSplit}
            >
              {splitDirection === 'horizontal' ? (
                <SquareSplitHorizontal size={13} strokeWidth={2} />
              ) : (
                <SquareSplitVertical size={13} strokeWidth={2} />
              )}
            </button>
          )}
          {onToggleMaximize && (
            <button
              className={`terminal-header-btn${maximized ? ' terminal-header-btn-active' : ''}`}
              title={maximized ? 'Restore Pane' : 'Maximize Pane'}
              aria-label={maximized ? 'Restore pane' : 'Maximize pane'}
              aria-pressed={maximized}
              onClick={onToggleMaximize}
            >
              {maximized ? (
                <Minimize2 size={13} strokeWidth={2} />
              ) : (
                <Maximize2 size={13} strokeWidth={2} />
              )}
            </button>
          )}
          {onClose && (
            <button
              className="terminal-header-btn terminal-header-btn-danger"
              title="Close Session"
              aria-label="Close session"
              onClick={onClose}
            >
              <X size={13} strokeWidth={2} />
            </button>
          )}
        </span>
      </div>
      {snippetsOpen && (
        <div className="terminal-popover terminal-snippets-popover">
          <div className="terminal-popover-header">
            <h5>Snippets</h5>
            <button className="btn-icon" title="Close" onClick={() => setSnippetsOpen(false)}>
              <X size={12} strokeWidth={2} />
            </button>
          </div>
          {snippets.length === 0 ? (
            <p className="terminal-popover-empty">No snippets saved yet.</p>
          ) : (
            <ul className="terminal-popover-list">
              {snippets.map((snippet) => (
                <li key={snippet.id}>
                  <button
                    className="terminal-snippet-item"
                    title={snippet.body}
                    onClick={() => insertSnippet(snippet.body)}
                  >
                    {snippet.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="terminal-snippets-manage"
            onClick={() => {
              setSnippetsOpen(false)
              setManageSnippetsOpen(true)
            }}
          >
            <Settings2 size={12} strokeWidth={2} />
            Manage snippets...
          </button>
        </div>
      )}
      {auth.logOpen && (
        <div className="terminal-connection-log">
          <div className="terminal-connection-log-header">
            <h5>Connection log</h5>
            <button className="btn-icon" title="Close" onClick={() => auth.setLogOpen(false)}>
              <X size={12} strokeWidth={2} />
            </button>
          </div>
          {auth.connectionLog.length === 0 ? (
            <p className="terminal-connection-log-empty">Nothing yet.</p>
          ) : (
            <ul className="terminal-connection-log-list">
              {[...auth.connectionLog].reverse().map((entry, i) => (
                <li key={entry.time + i} className="terminal-connection-log-entry">
                  <span className="terminal-connection-log-time">
                    {new Date(entry.time).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                  <span className="terminal-connection-log-message">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {auth.connectError && <div className="error-banner terminal-error">{auth.connectError}</div>}
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
        {auth.status !== 'connected' && (
          <div className="terminal-shade">
            {auth.status === 'connecting' && <p>Connecting to {cluster.connection.host}...</p>}
            {auth.status === 'reconnecting' && (
              <p>
                Reconnecting to {cluster.connection.host} (attempt {auth.retryAttempt}/
                {MAX_RECONNECT_ATTEMPTS})...
              </p>
            )}
            {cluster.azureTunnel &&
              auth.tunnelMessage &&
              (auth.status === 'connecting' ||
                auth.status === 'reconnecting' ||
                (auth.status === 'azure-auth-required' && auth.azureAuthenticating)) && (
                <p className="terminal-shade-detail">{auth.tunnelMessage}</p>
              )}
            {auth.status === 'auth-required' && (
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
            {auth.status === 'azure-auth-required' && (
              <>
                <p className="terminal-shade-title">Azure authentication required</p>
                <p>
                  {auth.azureAuthState?.status === 'cli-missing'
                    ? "The Azure CLI ('az') was not found on PATH."
                    : auth.azureAuthState?.account
                      ? `Azure sign-in for ${auth.azureAuthState.account} has expired.`
                      : 'No cached Azure sign-in was found.'}
                </p>
                <div className="terminal-shade-actions">
                  {auth.azureAuthState?.status !== 'cli-missing' && (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={auth.azureAuthenticating}
                      onClick={auth.authenticateAzure}
                    >
                      <LogIn size={13} strokeWidth={2} />
                      {auth.azureAuthenticating ? 'Authenticating...' : 'Authenticate'}
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    disabled={auth.azureAuthenticating}
                    onClick={auth.resetAndReconnectNow}
                  >
                    <RefreshCw size={13} strokeWidth={2} />
                    Retry connection
                  </button>
                  {auth.azureAuthState?.status !== 'cli-missing' && (
                    <button
                      className="btn btn-sm"
                      disabled={auth.azureAuthenticating || auth.azureClearing}
                      title="Signs out of every cluster's cached Azure session, not just this one - use when Authenticate silently reuses the wrong account for this cluster's tenant"
                      onClick={() => {
                        if (
                          confirm(
                            "Clear the Azure CLI's cached sign-in for every cluster (not just this one)? You'll need to authenticate again."
                          )
                        ) {
                          auth.clearAzureAuth()
                        }
                      }}
                    >
                      <Eraser size={13} strokeWidth={2} />
                      {auth.azureClearing ? 'Clearing...' : 'Clear cached sign-in'}
                    </button>
                  )}
                </div>
              </>
            )}
            {auth.status === 'paused' && (
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
                <button className="btn btn-sm" onClick={auth.resetAndReconnectNow}>
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
      {manageSnippetsOpen && <SnippetsDialog onClose={() => setManageSnippetsOpen(false)} />}
    </div>
  )
}
