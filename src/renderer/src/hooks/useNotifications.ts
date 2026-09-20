import { useEffect, useState } from 'react'
import type { ClusterNotification } from '../../../shared/types'

// Mirrors the cap in src/main/notifications/store.ts - the main process's own list is bounded to
// this many, but it broadcasts every new one regardless of that cap, so without a matching bound
// here a very long-running session would grow this array forever.
const MAX_NOTIFICATIONS = 200

/** Live cross-cluster notification feed (reachability changes, Jira ticket activity, unexpected
 *  SSH disconnects) - the main process is the source of truth; this just mirrors it into state
 *  and keeps new arrivals sorted to the front. */
export function useNotifications(): {
  notifications: ClusterNotification[]
  markRead: (id: string) => void
  markAllRead: () => void
} {
  const [notifications, setNotifications] = useState<ClusterNotification[]>([])

  useEffect(() => {
    let cancelled = false

    window.api.notifications.list().then((initial) => {
      if (!cancelled) setNotifications(initial)
    })

    const off = window.api.notifications.onCreated((notification) => {
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS))
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  function markRead(id: string): void {
    window.api.notifications.markRead(id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  function markAllRead(): void {
    window.api.notifications.markAllRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  return { notifications, markRead, markAllRead }
}
