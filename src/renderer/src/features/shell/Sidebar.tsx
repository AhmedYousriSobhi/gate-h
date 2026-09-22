import { LayoutDashboard, Pencil, Pin, PinOff, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
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
  /** Live Terminal connection status for every currently-mounted cluster (selected, or pinned to
   *  stay connected in the background) - keyed by cluster id, absent for anything not mounted. */
  terminalStatuses: Record<string, SessionStatus>
  onToggleKeepAlive: (cluster: ClusterSummary) => void
  onToggleActiveMonitoring: (cluster: ClusterSummary) => void
}

const KEEP_ALIVE_STATUS_LABEL: Record<SessionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  paused: 'Paused'
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
  onToggleKeepAlive,
  onToggleActiveMonitoring
}: SidebarProps): React.JSX.Element {
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
                cluster.keepAliveInBackground &&
                terminalStatuses[cluster.id] && (
                  <div
                    className={`keep-alive-badge keep-alive-badge-${terminalStatuses[cluster.id]}`}
                  >
                    {KEEP_ALIVE_STATUS_LABEL[terminalStatuses[cluster.id]]}
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
              <button
                className={`icon-btn${cluster.keepAliveInBackground ? ' icon-btn-active' : ''}`}
                title={
                  cluster.keepAliveInBackground
                    ? 'Stop keeping connected in the background'
                    : 'Keep connected in the background'
                }
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleKeepAlive(cluster)
                }}
              >
                {cluster.keepAliveInBackground ? (
                  <Pin size={13} strokeWidth={2} />
                ) : (
                  <PinOff size={13} strokeWidth={2} />
                )}
              </button>
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
