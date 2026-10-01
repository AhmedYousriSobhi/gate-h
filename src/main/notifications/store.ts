import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type {
  ClusterNotification,
  NotificationKind,
  NotificationSeverity
} from '../../shared/types'

// A cross-cluster notification feed (reachability transitions, Jira ticket activity, unexpected
// SSH disconnects) - surfaced in one place (the bell icon) so the user doesn't have to click into
// every cluster to notice something changed. Persisted in the `notifications` table (src/main/
// db.ts) so unread state survives a restart; capped so a long-running install doesn't grow the
// table forever - it's a feed of recent activity, not an unbounded audit log.
const MAX_NOTIFICATIONS = 200

interface NotificationRow {
  id: string
  cluster_id: string
  cluster_name: string
  kind: NotificationKind
  severity: NotificationSeverity
  message: string
  read: number
  created_at: string
}

function rowToNotification(row: NotificationRow): ClusterNotification {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    clusterName: row.cluster_name,
    kind: row.kind,
    severity: row.severity,
    message: row.message,
    read: Boolean(row.read),
    createdAt: row.created_at
  }
}

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
  const db = getDb()
  db.prepare(
    `INSERT INTO notifications (id, cluster_id, cluster_name, kind, severity, message, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    notification.id,
    notification.clusterId,
    notification.clusterName,
    notification.kind,
    notification.severity,
    notification.message,
    notification.createdAt
  )
  // rowid as a tiebreaker: several notifications created within the same millisecond would
  // otherwise sort arbitrarily against each other by created_at alone.
  db.prepare(
    `DELETE FROM notifications WHERE id NOT IN (
       SELECT id FROM notifications ORDER BY created_at DESC, rowid DESC LIMIT ?
     )`
  ).run(MAX_NOTIFICATIONS)
  broadcast?.(notification)
}

export function listNotifications(): ClusterNotification[] {
  const rows = getDb()
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC, rowid DESC')
    .all() as NotificationRow[]
  return rows.map(rowToNotification)
}

export function markNotificationRead(id: string): void {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id)
}

export function markAllNotificationsRead(): void {
  getDb().prepare('UPDATE notifications SET read = 1').run()
}

export function deleteNotification(id: string): void {
  getDb().prepare('DELETE FROM notifications WHERE id = ?').run(id)
}

export function clearAllNotifications(): void {
  getDb().prepare('DELETE FROM notifications').run()
}
