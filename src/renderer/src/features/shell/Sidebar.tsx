import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import StatusLed from './StatusLed'

interface SidebarProps {
  clusters: ClusterSummary[]
  reachability: Record<string, ClusterReachability>
  selectedClusterId: string | null
  onSelect: (cluster: ClusterSummary) => void
  onAdd: () => void
  onEdit: (cluster: ClusterSummary) => void
  onRemove: (cluster: ClusterSummary) => void
}

export default function Sidebar({
  clusters,
  reachability,
  selectedClusterId,
  onSelect,
  onAdd,
  onEdit,
  onRemove
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-brand">Gate-H</span>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          + Add
        </button>
      </div>

      <div className="cluster-rows">
        {clusters.length === 0 && (
          <p className="hint sidebar-empty">
            No clusters yet. Click &quot;+ Add&quot; to register one.
          </p>
        )}
        {clusters.map((cluster) => (
          <div
            key={cluster.id}
            className={`cluster-row${cluster.id === selectedClusterId ? ' cluster-row-active' : ''}`}
            onClick={() => onSelect(cluster)}
          >
            <StatusLed status={reachability[cluster.id]?.status} />
            <div className="cluster-row-main">
              <div className="cluster-row-name">{cluster.name}</div>
              <div className="cluster-row-host">{cluster.connection.host}</div>
            </div>
            <div className="cluster-row-actions">
              <button
                className="icon-btn"
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(cluster)
                }}
              >
                ✎
              </button>
              <button
                className="icon-btn icon-btn-danger"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(cluster)
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
