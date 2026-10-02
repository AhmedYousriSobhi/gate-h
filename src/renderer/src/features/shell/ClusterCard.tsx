import { useEffect, useRef, useState } from 'react'
import { BarChart3, Copy, ListChecks, MoreHorizontal, RotateCw, Ticket } from 'lucide-react'
import type {
  ClusterReachability,
  ClusterSummary,
  SchedulerSnapshot
} from '../../../../shared/types'
import { showToast } from '../../lib/toast'
import StatusPill from './StatusPill'
import { jobSummary } from './jobSummary'

interface ClusterCardProps {
  cluster: ClusterSummary
  reachability?: ClusterReachability
  /** Last-known Slurm snapshot, if one exists - see useSchedulerSnapshots. Never fetched on the
   *  Overview's account; absent entirely for a cluster that's never been connected. */
  schedulerSnapshot?: SchedulerSnapshot
  unread: number
  onConnect: (cluster: ClusterSummary) => void
  onViewStatus: (cluster: ClusterSummary) => void
}

/** One cluster's "fleet at a glance" summary: identity, live status, and a single state-aware
 *  primary action. The whole card opens the cluster, mirroring the primary button, so the larger
 *  click target works whether or not a user notices the button itself. */
export default function ClusterCard({
  cluster,
  reachability,
  schedulerSnapshot,
  unread,
  onConnect,
  onViewStatus
}: ClusterCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const status = reachability?.status

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function copyHost(e: React.MouseEvent): void {
    e.stopPropagation()
    void navigator.clipboard.writeText(cluster.connection.host)
    showToast({ message: `Copied ${cluster.connection.host}`, type: 'success' })
  }

  const isUnreachable = status === 'offline'

  return (
    <div
      className="cluster-card"
      role="button"
      tabIndex={0}
      aria-label={`${cluster.name}, ${status === 'online' ? 'online' : status === 'offline' ? 'unreachable' : 'checking'}`}
      onClick={() => onConnect(cluster)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onConnect(cluster)
        }
      }}
    >
      <div className="cluster-card-head">
        <div className="cluster-card-identity">
          <div className="cluster-card-name-row">
            <span className="cluster-card-name" title={cluster.name}>
              {cluster.name}
            </span>
            {!cluster.activeMonitoring && <span className="standby-badge">Standby</span>}
          </div>
          <StatusPill
            status={status}
            latencyMs={reachability?.latencyMs}
            checkedAt={reachability?.checkedAt}
          />
        </div>
        {unread > 0 && (
          <span
            className="overview-card-badge"
            title={`${unread} unread notification${unread === 1 ? '' : 's'}`}
          >
            {unread}
          </span>
        )}
        <div className="cluster-card-menu" ref={menuRef}>
          <button
            className="icon-btn"
            title="More actions"
            aria-label={`More actions for ${cluster.name}`}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
          >
            <MoreHorizontal size={14} strokeWidth={2} />
          </button>
          {menuOpen && (
            <div className="cluster-card-menu-panel">
              <button
                className="cluster-card-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  onViewStatus(cluster)
                }}
              >
                View status
              </button>
            </div>
          )}
        </div>
      </div>

      <button
        className="cluster-card-host mono"
        title={`Click to copy ${cluster.connection.host}`}
        onClick={copyHost}
      >
        <span className="cluster-card-host-text">{cluster.connection.host}</span>
        <Copy size={11} strokeWidth={2} />
      </button>

      {cluster.description && (
        <p className="cluster-card-description" title={cluster.description}>
          {cluster.description}
        </p>
      )}

      {cluster.tags.length > 0 && (
        <div className="tags">
          {cluster.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {cluster.scheduler && schedulerSnapshot?.fetchedAt && (
        <div
          className="cluster-card-slurm"
          title="Slurm status (last refreshed while this cluster was open)"
        >
          <ListChecks size={12} strokeWidth={2} />
          <span>{jobSummary(schedulerSnapshot)}</span>
          {schedulerSnapshot.nodeIssues.length > 0 && (
            <span className="cluster-card-slurm-alert">
              {schedulerSnapshot.nodeIssues.length} node issue
              {schedulerSnapshot.nodeIssues.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      <div className="cluster-card-footer">
        <div className="cluster-card-integrations">
          {cluster.grafana && (
            <span title="Grafana configured" aria-label="Grafana configured">
              <BarChart3 size={13} strokeWidth={2} />
            </span>
          )}
          {cluster.jira && (
            <span title="Jira configured" aria-label="Jira configured">
              <Ticket size={13} strokeWidth={2} />
            </span>
          )}
        </div>
        <button
          className={`btn btn-sm ${isUnreachable ? '' : 'btn-primary'}`}
          onClick={(e) => {
            e.stopPropagation()
            onConnect(cluster)
          }}
        >
          {isUnreachable && <RotateCw size={12} strokeWidth={2} />}
          {isUnreachable ? 'Retry' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
