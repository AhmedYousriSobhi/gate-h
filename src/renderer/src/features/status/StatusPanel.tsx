import { useLayoutEffect, useRef } from 'react'
import { BarChart3, Ticket } from 'lucide-react'
import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import GrafanaStatusSection from './GrafanaStatusSection'
import JiraSection from './JiraSection'
import { savedScrollTop, saveScrollTop } from './statusCache'
import './status.css'

interface StatusPanelProps {
  cluster: ClusterSummary
  reachability?: ClusterReachability
}

export default function StatusPanel({
  cluster,
  reachability
}: StatusPanelProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // Coming back to a cluster puts you where you were in its Status - the cached Grafana status
  // renders on mount (see statusCache.ts), so the layout is there to scroll before paint.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = savedScrollTop(cluster.id)
  }, [cluster.id])

  return (
    <div
      className="status-body"
      ref={bodyRef}
      onScroll={(e) => saveScrollTop(cluster.id, e.currentTarget.scrollTop)}
    >
      <section>
        <h2>
          <BarChart3 size={15} strokeWidth={2} />
          Grafana
        </h2>
        <GrafanaStatusSection cluster={cluster} reachability={reachability} />
      </section>
      <section>
        <h2>
          <Ticket size={15} strokeWidth={2} />
          Jira
        </h2>
        <JiraSection cluster={cluster} />
      </section>
    </div>
  )
}
