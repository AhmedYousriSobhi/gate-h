import { useState } from 'react'
import type { ClusterSummary } from '../../shared/types'
import ClusterListPage from './features/clusters/ClusterListPage'
import TerminalView from './features/terminal/TerminalView'

function App(): React.JSX.Element {
  const [connectedCluster, setConnectedCluster] = useState<ClusterSummary | null>(null)

  if (connectedCluster) {
    return <TerminalView cluster={connectedCluster} onClose={() => setConnectedCluster(null)} />
  }

  return <ClusterListPage onConnect={setConnectedCluster} />
}

export default App
