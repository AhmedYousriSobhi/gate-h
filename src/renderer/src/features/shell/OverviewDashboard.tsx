import { BarChart3, Plus, Ticket } from 'lucide-react'
import type {
  ClusterNotification,
  ClusterReachability,
  ClusterSummary
} from '../../../../shared/types'
import StatusLed from './StatusLed'
import { avatarColorFor, initialFor } from '../../lib/avatarColor'

interface OverviewDashboardProps {
  profileName: string
  clusters: ClusterSummary[]
  reachability: Record<string, ClusterReachability>
  notifications: ClusterNotification[]
  onConnect: (cluster: ClusterSummary) => void
  onViewStatus: (cluster: ClusterSummary) => void
  onAdd: () => void
}

function reachabilityLabel(status: ClusterReachability['status'] | undefined): string {
  if (status === 'online') return 'Reachable'
  if (status === 'offline') return 'Unreachable'
  return 'Checking...'
}

export default function OverviewDashboard({
  profileName,
  clusters,
  reachability,
  notifications,
  onConnect,
  onViewStatus,
  onAdd
}: OverviewDashboardProps): React.JSX.Element {
  const onlineCount = clusters.filter((c) => reachability[c.id]?.status === 'online').length
  const offlineCount = clusters.filter((c) => reachability[c.id]?.status === 'offline').length

  return (
    <div className="overview">
      <div className="overview-header">
        <div>
          <h1>{profileName}</h1>
          <p className="hint">
            {clusters.length} cluster{clusters.length === 1 ? '' : 's'}
            {clusters.length > 0 && (
              <>
                {' '}
                · <span className="overview-stat-online">{onlineCount} online</span>
                {offlineCount > 0 && (
                  <>
                    {' '}
                    · <span className="overview-stat-offline">{offlineCount} unreachable</span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={14} strokeWidth={2.5} />
          Add cluster
        </button>
      </div>

      {clusters.length === 0 ? (
        <div className="overview-empty">
          <p className="hint">
            No clusters in this profile yet. Click &quot;Add cluster&quot; to register one.
          </p>
        </div>
      ) : (
        <div className="overview-grid">
          {clusters.map((cluster) => {
            const unread = notifications.filter((n) => n.clusterId === cluster.id && !n.read).length
            return (
              <div className="overview-card" key={cluster.id}>
                <div className="overview-card-head">
                  <span
                    className="cluster-avatar overview-card-avatar"
                    style={{ backgroundColor: avatarColorFor(cluster.name) }}
                  >
                    {initialFor(cluster.name)}
                    <StatusLed
                      status={reachability[cluster.id]?.status}
                      latencyMs={reachability[cluster.id]?.latencyMs}
                    />
                  </span>
                  <div>
                    <div className="overview-card-name">{cluster.name}</div>
                    <div className="overview-card-host mono">{cluster.connection.host}</div>
                  </div>
                  {unread > 0 && <span className="overview-card-badge">{unread}</span>}
                </div>

                {cluster.tags.length > 0 && (
                  <div className="tags">
                    {cluster.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="overview-card-meta">
                  <span>{reachabilityLabel(reachability[cluster.id]?.status)}</span>
                  {cluster.grafana && (
                    <span className="overview-card-integration">
                      <BarChart3 size={11} strokeWidth={2} /> Grafana
                    </span>
                  )}
                  {cluster.jira && (
                    <span className="overview-card-integration">
                      <Ticket size={11} strokeWidth={2} /> Jira
                    </span>
                  )}
                </div>

                <div className="overview-card-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => onConnect(cluster)}>
                    Connect
                  </button>
                  <button className="btn btn-sm" onClick={() => onViewStatus(cluster)}>
                    Status
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
