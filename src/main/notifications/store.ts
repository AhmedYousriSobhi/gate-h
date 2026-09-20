import { randomUUID } from 'crypto'
import type {
  ClusterNotification,
  NotificationKind,
  NotificationSeverity
} from '../../shared/types'

// A simple in-memory notification feed - cross-cluster events surfaced in one place (the bell
// icon) so the user doesn't have to click into every cluster to notice something changed. Not
// persisted across restarts: it's meant as a live feed of "what happened while the app was open",
// not a durable audit log.
const MAX_NOTIFICATIONS = 200

const notifications: ClusterNotification[] = []
let broadcast: ((notification: ClusterNotification) => void) | null = null

export function setNotificationBroadcaster(fn: (notification: ClusterNotification) => void): void {
  broadcast = fn
}

export function addNotification(input: {
  clusterId: string
  clusterName: string
  kind: NotificationKind
  severity: NotificationSeverity
  message: string
}): void {
  const notification: ClusterNotification = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    read: false,
    ...input
  }
  notifications.unshift(notification)
  notifications.length = Math.min(notifications.length, MAX_NOTIFICATIONS)
  broadcast?.(notification)
}

export function listNotifications(): ClusterNotification[] {
  return notifications
}

export function markNotificationRead(id: string): void {
  const notification = notifications.find((n) => n.id === id)
  if (notification) notification.read = true
}

export function markAllNotificationsRead(): void {
  for (const notification of notifications) notification.read = true
}
