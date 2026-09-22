import { BarChart3, Ticket } from 'lucide-react'
import type { ClusterSummary } from '../../../../shared/types'
import GrafanaStatusSection from './GrafanaStatusSection'
import JiraSection from './JiraSection'
import './status.css'

interface StatusPanelProps {
  cluster: ClusterSummary
  reconnectSignal: number
}

export default function StatusPanel({
  cluster,
  reconnectSignal
}: StatusPanelProps): React.JSX.Element {
  return (
    <div className="status-body">
      <section>
        <h2>
          <BarChart3 size={15} strokeWidth={2} />
          Grafana
        </h2>
        <GrafanaStatusSection cluster={cluster} reconnectSignal={reconnectSignal} />
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
