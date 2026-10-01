import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Plus, Rows3, Search } from 'lucide-react'
import type {
  ClusterNotification,
  ClusterReachability,
  ClusterSummary,
  SchedulerSnapshot
} from '../../../../shared/types'
import ClusterCard from './ClusterCard'
import ClusterTableRow from './ClusterTableRow'
import { fleetJobTotals } from './jobSummary'
import { useOverviewViewMode } from '../../hooks/useOverviewViewMode'

interface OverviewDashboardProps {
  profileName: string
  clusters: ClusterSummary[]
  reachability: Record<string, ClusterReachability>
  schedulerSnapshots: Record<string, SchedulerSnapshot>
  notifications: ClusterNotification[]
  onConnect: (cluster: ClusterSummary) => void
  onViewStatus: (cluster: ClusterSummary) => void
  onAdd: () => void
}

type Filter = 'all' | 'online' | 'attention' | 'alerts'

// Past this many clusters a glance at the grid stops being enough to find one by eye.
const SEARCH_THRESHOLD = 8

// Needs-attention clusters sort first regardless of the active filter, so a problem is never
// scrolled past while skimming a long "All" list.
const STATUS_RANK: Record<string, number> = { offline: 0, checking: 1, online: 2 }

export default function OverviewDashboard({
  profileName,
  clusters,
  reachability,
  schedulerSnapshots,
  notifications,
  onConnect,
  onViewStatus,
  onAdd
}: OverviewDashboardProps): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [prevReachability, setPrevReachability] = useState(reachability)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const { viewMode, setViewMode } = useOverviewViewMode()

  const unreadByCluster = useMemo(() => {
    const map: Record<string, number> = {}
    for (const n of notifications) if (!n.read) map[n.clusterId] = (map[n.clusterId] ?? 0) + 1
    return map
  }, [notifications])

  const onlineCount = clusters.filter((c) => reachability[c.id]?.status === 'online').length
  const offlineCount = clusters.filter((c) => reachability[c.id]?.status === 'offline').length
  const alertCount = clusters.filter((c) => unreadByCluster[c.id] > 0).length
  // Display-only (not a filter): sums jobs from whatever snapshots are already cached (clusters
  // that have been opened or are background-watched - see SPEC.md §3.10), never fetching anything
  // itself, so showing it here adds no polling.
  const jobTotals = useMemo(() => fleetJobTotals(schedulerSnapshots), [schedulerSnapshots])
  const hasSchedulerData = Object.keys(schedulerSnapshots).length > 0

  // Announces online/offline transitions for screen-reader users, since the status pill's color
  // and icon change is otherwise silent. Computed during render (the React-recommended way to
  // react to a prop change without an Effect) rather than in a useEffect, since the message
  // depends on the *previous* render's reachability - not on any external system.
  if (reachability !== prevReachability) {
    const messages: string[] = []
    for (const cluster of clusters) {
      const before = prevReachability[cluster.id]?.status
      const after = reachability[cluster.id]?.status
      if (
        before &&
        after &&
        before !== after &&
        (before === 'online' || before === 'offline') &&
        (after === 'online' || after === 'offline')
      ) {
        messages.push(`${cluster.name} is now ${after === 'online' ? 'online' : 'unreachable'}`)
      }
    }
    if (messages.length > 0) setAnnouncement(messages.join('. '))
    setPrevReachability(reachability)
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== '/') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      e.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  function handleGridKeyDown(e: React.KeyboardEvent): void {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('.cluster-card') ?? [])
    const index = cards.indexOf(document.activeElement as HTMLElement)
    if (index === -1) return
    e.preventDefault()
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const next = cards[index + delta]
    next?.focus()
  }

  const loading = clusters.length > 0 && Object.keys(reachability).length === 0

  const visible = clusters
    .filter((c) => {
      if (filter === 'online' && reachability[c.id]?.status !== 'online') return false
      if (filter === 'attention' && reachability[c.id]?.status !== 'offline') return false
      if (filter === 'alerts' && !(unreadByCluster[c.id] > 0)) return false
      if (query.trim()) {
        const q = query.trim().toLowerCase()
        if (!c.name.toLowerCase().includes(q) && !c.connection.host.toLowerCase().includes(q)) {
          return false
        }
      }
      return true
    })
    .sort((a, b) => {
      const rankA = STATUS_RANK[reachability[a.id]?.status ?? 'checking']
      const rankB = STATUS_RANK[reachability[b.id]?.status ?? 'checking']
      return rankA - rankB
    })

  return (
    <div className="overview">
      <div className="overview-header">
        <h1>{profileName}</h1>
        {clusters.length > 0 && (
          <div className="overview-view-toggle" role="group" aria-label="Dashboard layout">
            <button
              className={`icon-btn${viewMode === 'cards' ? ' icon-btn-active' : ''}`}
              title="Card view"
              aria-label="Card view"
              aria-pressed={viewMode === 'cards'}
              onClick={() => setViewMode('cards')}
            >
              <LayoutGrid size={14} strokeWidth={2} />
            </button>
            <button
              className={`icon-btn${viewMode === 'table' ? ' icon-btn-active' : ''}`}
              title="Table view"
              aria-label="Table view"
              aria-pressed={viewMode === 'table'}
              onClick={() => setViewMode('table')}
            >
              <Rows3 size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {clusters.length === 0 ? (
        <div className="overview-empty">
          <p className="hint">No clusters in this profile yet.</p>
          <button className="btn btn-primary" onClick={onAdd}>
            <Plus size={14} strokeWidth={2.5} />
            Add your first cluster
          </button>
        </div>
      ) : (
        <>
          <div className="overview-summary" role="group" aria-label="Filter clusters">
            <button
              className={`overview-stat${filter === 'all' ? ' overview-stat-active' : ''}`}
              onClick={() => setFilter('all')}
            >
              <span className="overview-stat-value">{clusters.length}</span>
              <span className="overview-stat-label">Cluster{clusters.length === 1 ? '' : 's'}</span>
            </button>
            <button
              className={`overview-stat${filter === 'online' ? ' overview-stat-active' : ''}`}
              onClick={() => setFilter('online')}
            >
              <span className="overview-stat-value overview-stat-online">{onlineCount}</span>
              <span className="overview-stat-label">Online</span>
            </button>
            <button
              className={`overview-stat${filter === 'attention' ? ' overview-stat-active' : ''}`}
              onClick={() => setFilter('attention')}
            >
              <span className="overview-stat-value overview-stat-offline">{offlineCount}</span>
              <span className="overview-stat-label">Unreachable</span>
            </button>
            <button
              className={`overview-stat${filter === 'alerts' ? ' overview-stat-active' : ''}`}
              onClick={() => setFilter('alerts')}
            >
              <span className="overview-stat-value">{alertCount}</span>
              <span className="overview-stat-label">With alerts</span>
            </button>
            {filter !== 'all' && (
              <button className="btn btn-sm overview-filter-clear" onClick={() => setFilter('all')}>
                Clear filter
              </button>
            )}
            {hasSchedulerData && (
              <div className="overview-job-totals" aria-label="Fleet-wide job totals">
                <span className="overview-stat overview-stat-static">
                  <span className="overview-stat-value">{jobTotals.running}</span>
                  <span className="overview-stat-label">Jobs running</span>
                </span>
                <span className="overview-stat overview-stat-static">
                  <span className="overview-stat-value">{jobTotals.pending}</span>
                  <span className="overview-stat-label">Jobs pending</span>
                </span>
              </div>
            )}
            {clusters.length > SEARCH_THRESHOLD && (
              <div className="overview-search">
                <Search size={13} strokeWidth={2} />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search clusters… (/)"
                  aria-label="Search clusters"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
          </div>

          {loading ? (
            <div className="overview-grid">
              {clusters.map((c) => (
                <div className="cluster-card-skeleton" key={c.id} aria-hidden="true" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="overview-empty">
              <p className="hint">No clusters match this filter.</p>
            </div>
          ) : viewMode === 'table' ? (
            <div className="overview-table-wrap">
              <table className="overview-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Host</th>
                    <th>Jobs</th>
                    <th>Integrations</th>
                    <th>Alerts</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((cluster) => (
                    <ClusterTableRow
                      key={cluster.id}
                      cluster={cluster}
                      reachability={reachability[cluster.id]}
                      schedulerSnapshot={schedulerSnapshots[cluster.id]}
                      unread={unreadByCluster[cluster.id] ?? 0}
                      onConnect={onConnect}
                      onViewStatus={onViewStatus}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overview-grid" ref={gridRef} onKeyDown={handleGridKeyDown}>
              {visible.map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  reachability={reachability[cluster.id]}
                  schedulerSnapshot={schedulerSnapshots[cluster.id]}
                  unread={unreadByCluster[cluster.id] ?? 0}
                  onConnect={onConnect}
                  onViewStatus={onViewStatus}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
