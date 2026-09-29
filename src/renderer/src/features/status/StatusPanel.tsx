import { BarChart3, ListChecks, Ticket } from 'lucide-react'
import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import GrafanaStatusSection from './GrafanaStatusSection'
import JiraSection from './JiraSection'
import SlurmSection from './SlurmSection'
import './status.css'

interface StatusPanelProps {
  cluster: ClusterSummary
  reachability?: ClusterReachability
  /** The Status widget is showing in the layout, rather than toggled off. */
  active: boolean
}

export default function StatusPanel({
  cluster,
  reachability,
  active
}: StatusPanelProps): React.JSX.Element {
  return (
    <div className="status-body">
      <section>
        <h2>
          <BarChart3 size={15} strokeWidth={2} />
          Grafana
        </h2>
        <GrafanaStatusSection cluster={cluster} reachability={reachability} />
      </section>
      <section>
        <h2>
          <ListChecks size={15} strokeWidth={2} />
          Slurm
        </h2>
        <SlurmSection cluster={cluster} active={active} />
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
