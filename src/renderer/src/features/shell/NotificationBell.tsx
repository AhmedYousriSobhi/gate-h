import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  CheckCheck,
  ListChecks,
  Ticket,
  TerminalSquare,
  Trash2,
  WifiOff,
  X
} from 'lucide-react'
import type {
  ClusterNotification,
  NotificationKind,
  NotificationSeverity
} from '../../../../shared/types'
import { timeAgo } from '../../lib/timeAgo'
import type { WidgetType } from './panelLayout'

interface NotificationBellProps {
  notifications: ClusterNotification[]
  markRead: (id: string) => void
  markAllRead: () => void
  deleteNotification: (id: string) => void
  clearAll: () => void
  onNavigate: (clusterId: string, widget?: WidgetType) => void
}

const KIND_ICON: Record<
  NotificationKind,
  React.ComponentType<{ size?: number; strokeWidth?: number }>
> = {
  reachability: WifiOff,
  jira: Ticket,
  ssh: TerminalSquare,
  scheduler: ListChecks
}

const KIND_WIDGET: Record<NotificationKind, WidgetType | undefined> = {
  reachability: undefined,
  jira: 'status',
  ssh: 'terminal',
  scheduler: 'status'
}

const KIND_LABEL: Record<NotificationKind, string> = {
  reachability: 'Reachability',
  jira: 'Jira',
  ssh: 'SSH',
  scheduler: 'Scheduler'
}

const KIND_FILTERS: NotificationKind[] = ['reachability', 'ssh', 'jira', 'scheduler']
const SEVERITY_FILTERS: NotificationSeverity[] = ['warning', 'info']

export default function NotificationBell({
  notifications,
  markRead,
  markAllRead,
  deleteNotification,
  clearAll,
  onNavigate
}: NotificationBellProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [kindFilter, setKindFilter] = useState<NotificationKind | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<NotificationSeverity | 'all'>('all')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const unreadCount = notifications.filter((n) => !n.read).length
  const filtered = notifications.filter(
    (n) =>
      (kindFilter === 'all' || n.kind === kindFilter) &&
      (severityFilter === 'all' || n.severity === severityFilter)
  )
  const filterActive = kindFilter !== 'all' || severityFilter !== 'all'

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleClick(notification: ClusterNotification): void {
    markRead(notification.id)
    onNavigate(notification.clusterId, KIND_WIDGET[notification.kind])
    setOpen(false)
  }

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        className="icon-btn notification-bell-trigger"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={16} strokeWidth={2} />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <span>Notifications</span>
            <span className="notification-panel-actions">
              {notifications.some((n) => !n.read) && (
                <button
                  className="icon-btn"
                  title="Mark all read"
                  aria-label="Mark all notifications read"
                  onClick={markAllRead}
                >
                  <CheckCheck size={14} strokeWidth={2} />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  className="icon-btn icon-btn-danger"
                  title="Clear all"
                  aria-label="Clear all notifications"
                  onClick={clearAll}
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              )}
            </span>
          </div>
          {notifications.length > 0 && (
            <div className="notification-filter-row">
              <button
                className={`notification-filter-chip${kindFilter === 'all' ? ' notification-filter-chip-active' : ''}`}
                onClick={() => setKindFilter('all')}
              >
                All
              </button>
              {KIND_FILTERS.map((kind) => (
                <button
                  key={kind}
                  className={`notification-filter-chip${kindFilter === kind ? ' notification-filter-chip-active' : ''}`}
                  onClick={() => setKindFilter((prev) => (prev === kind ? 'all' : kind))}
                >
                  {KIND_LABEL[kind]}
                </button>
              ))}
              <span className="notification-filter-divider" />
              {SEVERITY_FILTERS.map((severity) => (
                <button
                  key={severity}
                  className={`notification-filter-chip${severityFilter === severity ? ' notification-filter-chip-active' : ''}`}
                  onClick={() =>
                    setSeverityFilter((prev) => (prev === severity ? 'all' : severity))
                  }
                >
                  {severity === 'warning' ? 'Warning' : 'Info'}
                </button>
              ))}
              {filterActive && (
                <button
                  className="notification-filter-chip notification-filter-reset"
                  onClick={() => {
                    setKindFilter('all')
                    setSeverityFilter('all')
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          )}
          <div className="notification-list">
            {notifications.length === 0 && (
              <p className="hint notification-empty">
                Nothing yet - you&apos;ll see reachability, Jira, and session events here.
              </p>
            )}
            {notifications.length > 0 && filtered.length === 0 && (
              <p className="hint notification-empty">No notifications match this filter.</p>
            )}
            {filtered.map((notification) => {
              const Icon = KIND_ICON[notification.kind]
              return (
                <div
                  key={notification.id}
                  className={`notification-item${notification.read ? '' : ' notification-item-unread'}`}
                >
                  <button
                    className="notification-item-main"
                    onClick={() => handleClick(notification)}
                  >
                    <span
                      className={`notification-icon notification-icon-${notification.severity}`}
                    >
                      <Icon size={13} strokeWidth={2} />
                    </span>
                    <span className="notification-item-body">
                      <span className="notification-item-message">{notification.message}</span>
                      <span className="notification-item-time">
                        {timeAgo(notification.createdAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-btn notification-item-delete"
                    title="Delete"
                    aria-label="Delete notification"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteNotification(notification.id)
                    }}
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
