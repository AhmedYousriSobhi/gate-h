import { useState } from 'react'
import type { ClusterSummary } from '../../../../shared/types'
import TerminalPanel from '../terminal/TerminalPanel'
import StatusPanel from '../status/StatusPanel'

interface MainPanelProps {
  cluster: ClusterSummary | null
}

type Tab = 'terminal' | 'status'

export default function MainPanel({ cluster }: MainPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('terminal')

  if (!cluster) {
    return (
      <div className="main-panel main-panel-empty">
        <p className="hint">Select a cluster on the left, or add one to get started.</p>
      </div>
    )
  }

  return (
    <div className="main-panel" key={cluster.id}>
      <div className="panel-tabs">
        <button
          className={`panel-tab${tab === 'terminal' ? ' panel-tab-active' : ''}`}
          onClick={() => setTab('terminal')}
        >
          Terminal
        </button>
        <button
          className={`panel-tab${tab === 'status' ? ' panel-tab-active' : ''}`}
          onClick={() => setTab('status')}
        >
          Status
        </button>
      </div>
      <div className="panel-content" style={{ display: tab === 'terminal' ? 'flex' : 'none' }}>
        <TerminalPanel cluster={cluster} />
      </div>
      <div className="panel-content" style={{ display: tab === 'status' ? 'block' : 'none' }}>
        <StatusPanel cluster={cluster} />
      </div>
    </div>
  )
}
