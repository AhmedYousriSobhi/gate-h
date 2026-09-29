import { useState } from 'react'
import { LayoutDashboard, Pencil, Plus, Power, PowerOff, Trash2, X } from 'lucide-react'
import type {
  ClusterNotification,
  ClusterReachability,
  ClusterSummary
} from '../../../../shared/types'
import type { useProfiles } from '../../hooks/useProfiles'
import type { SessionStatus } from '../terminal/TerminalPanel'
import StatusLed from './StatusLed'
import NotificationBell from './NotificationBell'
import ProfileSwitcher from './ProfileSwitcher'
import { avatarColorFor, initialFor } from '../../lib/avatarColor'
import type { WidgetType } from './panelLayout'

interface SidebarProps {
  clusters: ClusterSummary[]
  reachability: Record<string, ClusterReachability>
  selectedClusterId: string | null
  onSelect: (cluster: ClusterSummary) => void
  onShowOverview: () => void
  onAdd: () => void
  onEdit: (cluster: ClusterSummary) => void
  onRemove: (cluster: ClusterSummary) => void
  notifications: ClusterNotification[]
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void
  onNotificationNavigate: (clusterId: string, widget?: WidgetType) => void
  profilesState: ReturnType<typeof useProfiles>
  onProfileChanged: () => void
  /** Primary Terminal connection status by cluster id - may hold stale entries for clusters no
   *  longer open, so only read for ids in openClusterIds. */
  terminalStatuses: Record<string, SessionStatus>
  /** Clusters whose sessions are currently mounted (open or selected). */
  openClusterIds: string[]
  liveSessionCounts: Record<string, number>
  onCloseSessions: (cluster: ClusterSummary) => void
  onToggleActiveMonitoring: (cluster: ClusterSummary) => void
}

const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  paused: 'Paused',
  'auth-required': 'Login needed'
}

export default function Sidebar({
  clusters,
  reachability,
  selectedClusterId,
  onSelect,
  onShowOverview,
  onAdd,
  onEdit,
  onRemove,
  notifications,
  markNotificationRead,
  markAllNotificationsRead,
  onNotificationNavigate,
  profilesState,
  onProfileChanged,
  terminalStatuses,
  openClusterIds,
  liveSessionCounts,
  onCloseSessions,
  onToggleActiveMonitoring
}: SidebarProps): React.JSX.Element {
  // Closing a cluster with connected sessions takes a second click on the same button rather
  // than a modal - ended SSH sessions can't be brought back, but a dialog for it gets in the way.
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null)
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <ProfileSwitcher profilesState={profilesState} onProfileChanged={onProfileChanged} />
        <div className="sidebar-header-actions">
          <NotificationBell
            notifications={notifications}
            markRead={markNotificationRead}
            markAllRead={markAllNotificationsRead}
            onNavigate={onNotificationNavigate}
          />
          <button className="btn btn-primary btn-sm" onClick={onAdd}>
            <Plus size={14} strokeWidth={2.5} />
            Add
          </button>
        </div>
      </div>

      <div className="cluster-rows">
        <div
          className={`cluster-row overview-row${selectedClusterId === null ? ' cluster-row-active' : ''}`}
          onClick={onShowOverview}
        >
          <span className="overview-row-icon">
            <LayoutDashboard size={15} strokeWidth={2} />
          </span>
          <div className="cluster-row-main">
            <div className="cluster-row-name">Overview</div>
          </div>
        </div>

        {clusters.length === 0 && (
          <p className="hint sidebar-empty">
            No clusters yet. Click &quot;Add&quot; to register one.
          </p>
        )}
        {clusters.map((cluster) => (
          <div
            key={cluster.id}
            className={`cluster-row${cluster.id === selectedClusterId ? ' cluster-row-active' : ''}`}
            onClick={() => onSelect(cluster)}
            onMouseLeave={() => setConfirmCloseId((id) => (id === cluster.id ? null : id))}
          >
            <span
              className="cluster-avatar"
              style={{ backgroundColor: avatarColorFor(cluster.name) }}
            >
              {initialFor(cluster.name)}
              <StatusLed status={reachability[cluster.id]?.status} />
            </span>
            <div className="cluster-row-main">
              <div className="cluster-row-name">
                {cluster.name}
                {!cluster.activeMonitoring && <span className="standby-badge">Standby</span>}
              </div>
              <div className="cluster-row-host mono">{cluster.connection.host}</div>
              {cluster.activeMonitoring &&
                openClusterIds.includes(cluster.id) &&
                terminalStatuses[cluster.id] && (
                  <div className={`session-badge session-badge-${terminalStatuses[cluster.id]}`}>
                    {SESSION_STATUS_LABEL[terminalStatuses[cluster.id]]}
                  </div>
                )}
            </div>
            <div className="cluster-row-actions">
              <button
                className="icon-btn"
                title={
                  cluster.activeMonitoring
                    ? 'Turn off Active Monitoring (standby - no connections at all)'
                    : 'Turn on Active Monitoring'
                }
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleActiveMonitoring(cluster)
                }}
              >
                {cluster.activeMonitoring ? (
                  <Power size={13} strokeWidth={2} />
                ) : (
                  <PowerOff size={13} strokeWidth={2} />
                )}
              </button>
              {openClusterIds.includes(cluster.id) && (
                <button
                  className={`icon-btn icon-btn-danger${
                    confirmCloseId === cluster.id ? ' close-confirm' : ''
                  }`}
                  title="Close sessions"
                  onClick={(e) => {
                    e.stopPropagation()
                    const live = liveSessionCounts[cluster.id] ?? 0
                    if (live > 0 && confirmCloseId !== cluster.id) {
                      setConfirmCloseId(cluster.id)
                      return
                    }
                    setConfirmCloseId(null)
                    onCloseSessions(cluster)
                  }}
                >
                  {confirmCloseId === cluster.id ? (
                    `Close ${liveSessionCounts[cluster.id]} live?`
                  ) : (
                    <X size={13} strokeWidth={2} />
                  )}
                </button>
              )}
              <button
                className="icon-btn"
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(cluster)
                }}
              >
                <Pencil size={13} strokeWidth={2} />
              </button>
              <button
                className="icon-btn icon-btn-danger"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(cluster)
                }}
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
