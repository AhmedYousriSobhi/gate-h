import type { ClusterSummary } from '../../../../shared/types'
import GrafanaStatusSection from './GrafanaStatusSection'
import JiraSection from './JiraSection'
import './status.css'

interface ClusterStatusPageProps {
  cluster: ClusterSummary
  onClose: () => void
}

export default function ClusterStatusPage({
  cluster,
  onClose
}: ClusterStatusPageProps): React.JSX.Element {
  return (
    <div className="status-page">
      <header className="app-header">
        <h1>{cluster.name} — Status</h1>
        <button className="btn" onClick={onClose}>
          Back to clusters
        </button>
      </header>
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
    </div>
  )
}
