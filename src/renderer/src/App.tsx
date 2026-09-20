import { useState } from 'react'
import type { ClusterSummary } from '../../shared/types'
import ClusterListPage from './features/clusters/ClusterListPage'
import TerminalView from './features/terminal/TerminalView'
import ClusterStatusPage from './features/status/ClusterStatusPage'

type View =
  | { type: 'list' }
  | { type: 'terminal'; cluster: ClusterSummary }
  | { type: 'status'; cluster: ClusterSummary }

function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ type: 'list' })

  if (view.type === 'terminal') {
    return <TerminalView cluster={view.cluster} onClose={() => setView({ type: 'list' })} />
  }

  if (view.type === 'status') {
    return <ClusterStatusPage cluster={view.cluster} onClose={() => setView({ type: 'list' })} />
  }

  return (
    <ClusterListPage
      onConnect={(cluster) => setView({ type: 'terminal', cluster })}
      onViewStatus={(cluster) => setView({ type: 'status', cluster })}
    />
  )
}

export default App
