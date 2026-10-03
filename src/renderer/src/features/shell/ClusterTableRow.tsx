import { BarChart3, ListChecks, RotateCw, Ticket } from 'lucide-react'
import type {
  ClusterReachability,
  ClusterSummary,
  SchedulerSnapshot
} from '../../../../shared/types'
import StatusPill from './StatusPill'
import { jobSummary } from './jobSummary'

interface ClusterTableRowProps {
  cluster: ClusterSummary
  reachability?: ClusterReachability
  schedulerSnapshot?: SchedulerSnapshot
  /** Unresolved Jira tickets, once fetched. */
  openTickets?: number
  unread: number
  onConnect: (cluster: ClusterSummary) => void
  onViewStatus: (cluster: ClusterSummary) => void
}

/** One cluster per row, for a fleet too large for cards to stay scannable - same data and actions
 *  as ClusterCard, laid out densely instead. The whole row opens the cluster, same as the card. */
export default function ClusterTableRow({
  cluster,
  reachability,
  schedulerSnapshot,
  openTickets,
  unread,
  onConnect,
  onViewStatus
}: ClusterTableRowProps): React.JSX.Element {
  const status = reachability?.status
  const isUnreachable = status === 'offline'
  const hasSchedulerData = Boolean(cluster.scheduler && schedulerSnapshot?.fetchedAt)

  return (
    <tr
      className="cluster-row"
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
      <td>
        <StatusPill
          status={status}
          latencyMs={reachability?.latencyMs}
          checkedAt={reachability?.checkedAt}
        />
      </td>
      <td>
        <span className="cluster-row-name" title={cluster.name}>
          {cluster.name}
        </span>
        {!cluster.activeMonitoring && <span className="standby-badge">Standby</span>}
      </td>
      <td className="mono cluster-row-host" title={cluster.connection.host}>
        {cluster.connection.host}
      </td>
      <td>
        {hasSchedulerData ? (
          <span
            className="cluster-row-jobs"
            title="Slurm status (last refreshed while this cluster was open)"
          >
            <ListChecks size={12} strokeWidth={2} />
            {jobSummary(schedulerSnapshot as SchedulerSnapshot)}
            {(schedulerSnapshot as SchedulerSnapshot).nodeIssues.length > 0 && (
              <span className="cluster-card-slurm-alert">
                {(schedulerSnapshot as SchedulerSnapshot).nodeIssues.length} node issue
                {(schedulerSnapshot as SchedulerSnapshot).nodeIssues.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
        ) : (
          <span className="cluster-row-muted">—</span>
        )}
      </td>
      <td>
        <span className="cluster-card-integrations">
          {cluster.grafana && (
            <span title="Grafana configured" aria-label="Grafana configured">
              <BarChart3 size={13} strokeWidth={2} />
            </span>
          )}
          {cluster.jira && (
            <span
              className="cluster-card-tickets"
              title={
                openTickets === undefined
                  ? 'Jira configured'
                  : `${openTickets} unresolved Jira ticket${openTickets === 1 ? '' : 's'}`
              }
              aria-label={
                openTickets === undefined ? 'Jira configured' : `${openTickets} unresolved tickets`
              }
            >
              <Ticket size={13} strokeWidth={2} />
              {openTickets !== undefined && ` ${openTickets} open`}
            </span>
          )}
        </span>
      </td>
      <td>
        {unread > 0 && (
          <span
            className="overview-card-badge"
            title={`${unread} unread notification${unread === 1 ? '' : 's'}`}
          >
            {unread}
          </span>
        )}
      </td>
      <td className="cluster-row-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-sm"
          onClick={() => onViewStatus(cluster)}
          aria-label={`View status for ${cluster.name}`}
        >
          Status
        </button>
        <button
          className={`btn btn-sm ${isUnreachable ? '' : 'btn-primary'}`}
          onClick={() => onConnect(cluster)}
        >
          {isUnreachable && <RotateCw size={12} strokeWidth={2} />}
          {isUnreachable ? 'Retry' : 'Connect'}
        </button>
      </td>
    </tr>
  )
}
