import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react'
import {
  dismissToast,
  getToasts,
  removeToast,
  subscribeToasts,
  type Toast,
  type ToastType
} from '../../lib/toast'
import './toast.css'

const ICONS: Record<ToastType, typeof Info> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleX
}

function isWindowActive(): boolean {
  return document.hasFocus() && !document.hidden
}

export default function Toaster(): React.JSX.Element {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts)
  // Timers also pause while the app is in the background, so a toast can't expire unseen while
  // the user is in another window.
  const [windowActive, setWindowActive] = useState(isWindowActive)

  useEffect(() => {
    const update = (): void => setWindowActive(isWindowActive())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return (
    <section className="toaster" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} windowActive={windowActive} />
      ))}
    </section>
  )
}

function ToastCard({
  toast,
  windowActive
}: {
  toast: Toast
  windowActive: boolean
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused || !windowActive
  const remainingRef = useRef(toast.duration ?? 0)
  const Icon = ICONS[toast.type]

  useEffect(() => {
    if (toast.duration === null || toast.leaving || paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => dismissToast(toast.id), remainingRef.current)
    return () => {
      clearTimeout(timer)
      remainingRef.current -= Date.now() - startedAt
    }
  }, [toast.id, toast.duration, toast.leaving, paused])

  return (
    <div
      className={`toast-slot${toast.leaving ? ' toast-leaving' : ''}`}
      onAnimationEnd={(e) => {
        if (toast.leaving && e.target === e.currentTarget) removeToast(toast.id)
      }}
    >
      <div
        className={`toast toast-${toast.type}${paused ? ' toast-paused' : ''}`}
        role={toast.type === 'error' ? 'alert' : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') dismissToast(toast.id)
        }}
      >
        <div className="toast-body">
          <Icon className="toast-icon" size={16} aria-hidden />
          <div className="toast-text">
            {toast.title && <div className="toast-title">{toast.title}</div>}
            <div className="toast-message">{toast.message}</div>
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(toast.id)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        {toast.duration !== null && (
          <div className="toast-progress" style={{ animationDuration: `${toast.duration}ms` }} />
        )}
      </div>
    </div>
  )
}
