import type { ClusterSummary } from '../../../../shared/types'
import GrafanaStatusSection from './GrafanaStatusSection'
import JiraSection from './JiraSection'
import './status.css'

interface StatusPanelProps {
  cluster: ClusterSummary
}

export default function StatusPanel({ cluster }: StatusPanelProps): React.JSX.Element {
  return (
    <div className="status-body">
      <section>
        <h2>Grafana</h2>
        <GrafanaStatusSection cluster={cluster} />
      </section>
      <section>
        <h2>Jira</h2>
        <JiraSection cluster={cluster} />
      </section>
    </div>
  )
}
