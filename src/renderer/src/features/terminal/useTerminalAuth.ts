import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AzureAuthState, ClusterReachability } from '../../../../shared/types'

/** `auth-required`: a Teleport terminal with no usable tsh session. Unlike `paused`, reachability
 *  never resumes it - the proxy being up doesn't make a login happen - only a session update
 *  (a login here, on another cluster sharing the proxy, or with tsh in any terminal) does.
 *  `azure-auth-required`: the Azure tunnel's `az` sign-in is missing or expired - same idea, but
 *  resumed only by the Terminal's own "Authenticate" action or a manual Retry. */
export type SessionStatus =
  'connecting' | 'connected' | 'reconnecting' | 'paused' | 'auth-required' | 'azure-auth-required'

// Bounded, backoff-based retry policy: at most MAX_RECONNECT_ATTEMPTS auto-retries within a
// rolling RECONNECT_WINDOW_MS window, each spaced out exponentially with jitter, then the session
// pauses entirely rather than hammering the cluster's SSH daemon - a login node that's actually
// down (vs. transiently flaky) shouldn't see a retry storm that risks tripping fail2ban or similar.
export const MAX_RECONNECT_ATTEMPTS = 2
const RECONNECT_WINDOW_MS = 2 * 60_000
const BASE_RECONNECT_DELAY_MS = 5_000
const RECONNECT_JITTER_MS = 1_000
// How long a session must stay up before it counts as a real connection and restores the retry
// budget. Resetting the moment connect() resolves isn't enough: a Teleport session "connects" as
// soon as its local PTY starts, and tsh can still fail to reach the proxy a moment later - so a
// down proxy would reset the budget on every attempt and retry forever.
export const STABLE_SESSION_MS = 30_000
// How much of this session's connection history to keep - enough to see the run-up to a failure
// (tunnel steps, the drop, a retry or two) without growing unbounded over a long-lived session.
const MAX_LOG_ENTRIES = 50

export interface ConnectionLogEntry {
  time: string
  message: string
}

export interface UseTerminalAuthOptions {
  clusterId: string
  /** True while this session's cluster isn't the selected one - see TerminalPanel's prop of the
   *  same name. A dropped suspended session pauses instead of retrying. */
  suspended: boolean
  /** This cluster's live reachability reading - re-checked on every push, not just a detected
   *  offline -> online flip, so a session sitting paused is re-checked even if it was already
   *  online when it first paused (no flip to observe in that case). */
  reachability?: ClusterReachability
  onStatusChange?: (status: SessionStatus) => void
}

export interface UseTerminalAuthResult {
  status: SessionStatus
  setStatus: (status: SessionStatus) => void
  /** Mirrors `status` for effects/callbacks that read the latest value without depending on it
   *  (and so re-running on every status change) - same reasoning as the original component. */
  statusRef: React.MutableRefObject<SessionStatus>
  /** Mirrors the `suspended` option for the same reason - read inside the connect effect's
   *  ResizeObserver callback, which only re-runs on cluster/connectNonce changes. */
  suspendedRef: React.MutableRefObject<boolean>

  /** The generic connect-error banner - set by any SSH-level failure, not just a reconnect. */
  connectError: string | null
  setConnectError: (message: string | null) => void

  retryAttempt: number
  /** Bumped to force the connect effect to re-run and attempt a fresh connection. */
  connectNonce: number
  /** Called on a closed/failed session: schedules a backed-off retry if the rolling window still
   *  has attempts left, otherwise pauses (or pauses immediately if suspended). */
  scheduleReconnectOrPause: () => void
  /** Manual "Reconnect" click, or a reachability/session recovery signal - resets the backoff
   *  window and bumps connectNonce. */
  resetAndReconnectNow: () => void
  /** Cancels a pending scheduled retry, if any - also used by the connect effect's own cleanup. */
  clearRetryTimer: () => void
  /** Call once a session has been up for STABLE_SESSION_MS - restores the retry budget. */
  markSessionStable: () => void
  /** Resets connect-attempt state at the start of a new connect effect run. */
  beginConnectAttempt: (host: string) => void

  connectionLog: ConnectionLogEntry[]
  logOpen: boolean
  setLogOpen: Dispatch<SetStateAction<boolean>>
  logEvent: (message: string) => void

  /** Latest Azure pre-flight progress line ("Checking Azure CLI session", a device-code login
   *  prompt, "Tunnel active on port X", ...) - shown while not connected. */
  tunnelMessage: string | null
  /** The local `az` sign-in state behind the `azure-auth-required` status. */
  azureAuthState: AzureAuthState | null
  /** Whether an "Authenticate" click is in flight. */
  azureAuthenticating: boolean
  /** Transitions into azure-auth-required, cancelling any pending retry first. */
  setAzureAuthRequired: (state: AzureAuthState) => void
  /** The Terminal's "Authenticate" button handler; `deviceCode` forces the device-code flow,
   *  which skips the browser's cached SSO so the user picks the account themselves. */
  authenticateAzure: (deviceCode?: boolean) => void
  /** Whether a "Clear cached sign-in" click is in flight. */
  azureClearing: boolean
  /** The Terminal's "Clear cached sign-in" button handler - wipes only this cluster's tenant's
   *  cached `az` sign-in, so the next Authenticate starts from a clean slate. */
  clearAzureAuth: () => void
}

/** TerminalPanel's reconnect/backoff state machine and Azure authentication state, pulled out
 *  into a hook - pure code motion: same state, same effects, same timing, same race-condition
 *  handling (the `disposed` guard inside the connect effect's async callbacks stays in
 *  TerminalPanel, since it's intrinsically tied to that effect's own lifecycle, not to this
 *  hook's). The connect effect itself (xterm.js setup, ssh2 wiring) stays in TerminalPanel too -
 *  only the reconnect/Azure state and the handlers that transition it move here. */
export function useTerminalAuth({
  clusterId,
  suspended,
  reachability,
  onStatusChange
}: UseTerminalAuthOptions): UseTerminalAuthResult {
  const [connectError, setConnectError] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus>('connecting')
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [connectNonce, setConnectNonce] = useState(0)
  const [tunnelMessage, setTunnelMessage] = useState<string | null>(null)
  const [connectionLog, setConnectionLog] = useState<ConnectionLogEntry[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [azureAuthState, setAzureAuthState] = useState<AzureAuthState | null>(null)
  const [azureAuthenticating, setAzureAuthenticating] = useState(false)
  const [azureClearing, setAzureClearing] = useState(false)

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
  const suspendedRef = useRef(suspended)
  // Set when a drop was paused only because the cluster was in the background - the one pause
  // that selecting the cluster again resumes. A pause from an exhausted retry budget still waits
  // for reachability or a manual Reconnect, as before.
  const pausedInBackgroundRef = useRef(false)

  const logEvent = useCallback((message: string): void => {
    setConnectionLog((prev) =>
      [...prev, { time: new Date().toISOString(), message }].slice(-MAX_LOG_ENTRIES)
    )
  }, [])

  function clearRetryTimer(): void {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  const scheduleReconnectOrPause = useCallback((): void => {
    if (suspendedRef.current) {
      pausedInBackgroundRef.current = true
      setStatus('paused')
      logEvent('Paused - cluster is in the background')
      return
    }
    const now = Date.now()
    if (now - windowStartRef.current > RECONNECT_WINDOW_MS) {
      windowStartRef.current = now
      attemptsRef.current = 0
    }

    if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('paused')
      logEvent(`Paused - ${MAX_RECONNECT_ATTEMPTS} retries used up`)
      return
    }

    attemptsRef.current += 1
    setRetryAttempt(attemptsRef.current)
    setStatus('reconnecting')
    const delay =
      BASE_RECONNECT_DELAY_MS * 2 ** (attemptsRef.current - 1) + Math.random() * RECONNECT_JITTER_MS
    logEvent(
      `Retrying in ${Math.round(delay / 1000)}s (attempt ${attemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`
    )
    clearRetryTimer()
    retryTimerRef.current = setTimeout(() => setConnectNonce((n) => n + 1), delay)
  }, [logEvent])

  const resetAndReconnectNow = useCallback((): void => {
    clearRetryTimer()
    pausedInBackgroundRef.current = false
    windowStartRef.current = Date.now()
    attemptsRef.current = 0
    setRetryAttempt(0)
    setStatus('connecting')
    logEvent('Reconnecting now')
    setConnectNonce((n) => n + 1)
  }, [logEvent])

  useEffect(() => {
    // Re-checked on every reachability push for this cluster (roughly every 60s, same cadence the
    // reachability sweep itself uses), not just on a detected offline -> online flip - only worth
    // acting on when the session is actually sitting paused; a connecting/connected/retrying
    // session has nothing to nudge.
    if (
      reachability?.status === 'online' &&
      statusRef.current === 'paused' &&
      !suspendedRef.current
    ) {
      resetAndReconnectNow()
    }
  }, [reachability, resetAndReconnectNow])

  // Pause-on-suspend / resume-on-unsuspend. Split out of TerminalPanel's original combined effect
  // (which also refit the terminal here) into its own effect scoped to this hook's concern - the
  // refit stays in TerminalPanel, keyed off the same `suspended` value, since it's unrelated to
  // reconnect state. The two effects don't read each other's results, so this reordering (refit
  // no longer guaranteed to run before resetAndReconnectNow) doesn't change observable behavior:
  // resetAndReconnectNow only schedules a state update (async), and refit is a one-shot terminal
  // resize with no dependency on reconnect state.
  useEffect(() => {
    suspendedRef.current = suspended
    if (suspended) {
      // A retry already scheduled when the cluster went to the background would otherwise still
      // fire there.
      if (retryTimerRef.current) {
        clearRetryTimer()
        pausedInBackgroundRef.current = true
        setStatus('paused')
      }
      return
    }
    if (pausedInBackgroundRef.current) resetAndReconnectNow()
  }, [suspended, resetAndReconnectNow])

  useEffect(
    () =>
      window.api.azure.onStatus((event) => {
        if (event.clusterId !== clusterId) return
        setTunnelMessage(event.message)
        logEvent(event.message)
      }),
    [clusterId, logEvent]
  )

  function beginConnectAttempt(host: string): void {
    setStatus('connecting')
    setConnectError(null)
    setAzureAuthState(null)
    logEvent(`Connecting to ${host}`)
  }

  function markSessionStable(): void {
    windowStartRef.current = Date.now()
    attemptsRef.current = 0
    setRetryAttempt(0)
  }

  function setAzureAuthRequired(state: AzureAuthState): void {
    clearRetryTimer()
    setAzureAuthState(state)
    setStatus('azure-auth-required')
    logEvent('Azure authentication required')
  }

  function authenticateAzure(deviceCode?: boolean): void {
    setAzureAuthenticating(true)
    setConnectError(null)
    // `az login`'s own progress (and its ERROR, if any) now streams in as connection-log entries -
    // open the log so it's visible without an extra click, instead of only the single line under
    // the terminal shade that the next line immediately replaces.
    setLogOpen(true)
    window.api.azure
      .login(clusterId, deviceCode)
      .then(() => {
        setAzureAuthenticating(false)
        resetAndReconnectNow()
      })
      .catch((err: Error) => {
        setAzureAuthenticating(false)
        setConnectError(err.message)
        logEvent(err.message)
      })
  }

  function clearAzureAuth(): void {
    setAzureClearing(true)
    logEvent('Clearing cached Azure sign-in for this tenant')
    window.api.azure
      .clearAuth(clusterId)
      .then(() => {
        setAzureClearing(false)
        logEvent('Cleared - Authenticate will prompt for an account again')
      })
      .catch((err: Error) => {
        setAzureClearing(false)
        logEvent(err.message)
      })
  }

  return {
    status,
    setStatus,
    statusRef,
    suspendedRef,
    connectError,
    setConnectError,
    retryAttempt,
    connectNonce,
    scheduleReconnectOrPause,
    resetAndReconnectNow,
    clearRetryTimer,
    markSessionStable,
    beginConnectAttempt,
    connectionLog,
    logOpen,
    setLogOpen,
    logEvent,
    tunnelMessage,
    azureAuthState,
    azureAuthenticating,
    setAzureAuthRequired,
    authenticateAzure,
    azureClearing,
    clearAzureAuth
  }
}
