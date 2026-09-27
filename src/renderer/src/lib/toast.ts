export type ToastType = 'success' | 'info' | 'warning' | 'error'

export interface Toast {
  id: string
  type: ToastType
  title?: string
  message: string
  /** Auto-dismiss delay in ms; `null` stays until the user closes it. */
  duration: number | null
  /** Set by `dismissToast` - the card is playing its exit animation and still holds its slot. */
  leaving: boolean
}

export interface ToastOptions {
  message: string
  type?: ToastType
  title?: string
  duration?: number | null
}

const MAX_VISIBLE = 3

// Errors are sticky because they usually need acting on, and an auto-dismissed one is easy to miss
// entirely if it fires while the user is looking elsewhere.
const DEFAULT_DURATION: Record<ToastType, number | null> = {
  success: 5000,
  info: 5000,
  warning: 7000,
  error: null
}

let visible: Toast[] = []
// Overflow is queued rather than dropping the oldest visible toast, which could silently discard
// an error the user hasn't acknowledged yet.
let queue: Toast[] = []
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

/** Show a toast from anywhere in the renderer - React or not:
 *  `showToast({ message: 'Saved successfully', type: 'success' })`. Returns its id so the caller
 *  can close it early with `dismissToast`. */
export function showToast({ message, type = 'info', title, duration }: ToastOptions): string {
  const toast: Toast = {
    id: crypto.randomUUID(),
    type,
    title,
    message,
    duration: duration === undefined ? DEFAULT_DURATION[type] : duration,
    leaving: false
  }
  if (visible.length < MAX_VISIBLE) {
    visible = [...visible, toast]
    emit()
  } else {
    queue = [...queue, toast]
  }
  return toast.id
}

export function dismissToast(id: string): void {
  if (queue.some((t) => t.id === id)) {
    queue = queue.filter((t) => t.id !== id)
    return
  }
  if (!visible.some((t) => t.id === id && !t.leaving)) return
  visible = visible.map((t) => (t.id === id ? { ...t, leaving: true } : t))
  emit()
}

/** Called by the Toaster once a card's exit animation ends; frees its slot for the next queued
 *  toast. */
export function removeToast(id: string): void {
  const next = visible.filter((t) => t.id !== id)
  if (next.length === visible.length) return
  const freed = MAX_VISIBLE - next.length
  visible = [...next, ...queue.slice(0, freed)]
  queue = queue.slice(freed)
  emit()
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getToasts(): readonly Toast[] {
  return visible
}
