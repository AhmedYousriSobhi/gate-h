import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Ticket, TerminalSquare, WifiOff } from 'lucide-react'
import type { ClusterNotification, NotificationKind } from '../../../../shared/types'
import { timeAgo } from '../../lib/timeAgo'
import type { WidgetType } from './panelLayout'

interface NotificationBellProps {
  notifications: ClusterNotification[]
  markRead: (id: string) => void
  markAllRead: () => void
  onNavigate: (clusterId: string, widget?: WidgetType) => void
}

const KIND_ICON: Record<
  NotificationKind,
  React.ComponentType<{ size?: number; strokeWidth?: number }>
> = {
  reachability: WifiOff,
  jira: Ticket,
  ssh: TerminalSquare
}

const KIND_WIDGET: Record<NotificationKind, WidgetType | undefined> = {
  reachability: undefined,
  jira: 'status',
  ssh: 'terminal'
}

export default function NotificationBell({
  notifications,
  markRead,
  markAllRead,
  onNavigate
}: NotificationBellProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const unreadCount = notifications.filter((n) => !n.read).length

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
            {notifications.length > 0 && (
              <button className="icon-btn" title="Mark all read" onClick={markAllRead}>
                <CheckCheck size={14} strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="notification-list">
            {notifications.length === 0 && (
              <p className="hint notification-empty">
                Nothing yet - you&apos;ll see reachability, Jira, and session events here.
              </p>
            )}
            {notifications.map((notification) => {
              const Icon = KIND_ICON[notification.kind]
              return (
                <button
                  key={notification.id}
                  className={`notification-item${notification.read ? '' : ' notification-item-unread'}`}
                  onClick={() => handleClick(notification)}
                >
                  <span className={`notification-icon notification-icon-${notification.severity}`}>
                    <Icon size={13} strokeWidth={2} />
                  </span>
                  <span className="notification-item-body">
                    <span className="notification-item-message">{notification.message}</span>
                    <span className="notification-item-time">
                      {timeAgo(notification.createdAt)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
