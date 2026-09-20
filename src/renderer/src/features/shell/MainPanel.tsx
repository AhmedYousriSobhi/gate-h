import { Activity, Terminal as TerminalIcon } from 'lucide-react'
import type { ClusterSummary } from '../../../../shared/types'
import TerminalPanel from '../terminal/TerminalPanel'
import StatusPanel from '../status/StatusPanel'

type Tab = 'terminal' | 'status'

interface MainPanelProps {
  cluster: ClusterSummary
  tab: Tab
  onTabChange: (tab: Tab) => void
  reconnectSignal: number
}

export default function MainPanel({
  cluster,
  tab,
  onTabChange,
  reconnectSignal
}: MainPanelProps): React.JSX.Element {
  return (
    <div className="main-panel" key={cluster.id}>
      <div className="panel-tabs">
        <button
          className={`panel-tab${tab === 'terminal' ? ' panel-tab-active' : ''}`}
          onClick={() => onTabChange('terminal')}
        >
          <TerminalIcon size={14} strokeWidth={2} />
          Terminal
        </button>
        <button
          className={`panel-tab${tab === 'status' ? ' panel-tab-active' : ''}`}
          onClick={() => onTabChange('status')}
        >
          <Activity size={14} strokeWidth={2} />
          Status
        </button>
      </div>
      <div className="panel-content" style={{ display: tab === 'terminal' ? 'flex' : 'none' }}>
        <TerminalPanel cluster={cluster} reconnectSignal={reconnectSignal} />
      </div>
      <div className="panel-content" style={{ display: tab === 'status' ? 'block' : 'none' }}>
        <StatusPanel cluster={cluster} />
      </div>
    </div>
  )
}
