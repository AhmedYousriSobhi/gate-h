import { useEffect, useState } from 'react'
import type { ClusterInput, ClusterSummary } from '../../../../shared/types'
import ClusterForm from '../clusters/ClusterForm'
import Sidebar from './Sidebar'
import MainPanel from './MainPanel'
import TitleBar from './TitleBar'
import { useReachability } from '../../hooks/useReachability'
import './shell.css'

export default function AppShell(): React.JSX.Element {
  const [clusters, setClusters] = useState<ClusterSummary[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'terminal' | 'status'>('terminal')
  const [editing, setEditing] = useState<ClusterSummary | 'new' | null>(null)
  const reachability = useReachability()

  async function refresh(): Promise<ClusterSummary[]> {
    try {
      const data = await window.api.clusters.list()
      setClusters(data)
      setLoadError(null)
      return data
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load clusters.')
      return []
    }
  }

  useEffect(() => {
    let cancelled = false
    window.api.clusters
      .list()
      .then((data) => {
        if (!cancelled) setClusters(data)
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(input: ClusterInput): Promise<void> {
    if (editing && editing !== 'new') {
      await window.api.clusters.update(editing.id, input)
    } else {
      const created = await window.api.clusters.create(input)
      setSelectedClusterId(created.id)
    }
    setEditing(null)
    await refresh()
  }

  async function handleRemove(cluster: ClusterSummary): Promise<void> {
    if (!confirm(`Remove cluster "${cluster.name}"? This cannot be undone.`)) return
    await window.api.clusters.remove(cluster.id)
    if (selectedClusterId === cluster.id) setSelectedClusterId(null)
    await refresh()
  }

  function handleNotificationNavigate(clusterId: string, tab?: 'terminal' | 'status'): void {
    setSelectedClusterId(clusterId)
    if (tab) setActiveTab(tab)
  }

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) ?? null

  return (
    <div className="app-frame">
      <TitleBar />
      <div className="shell">
        <Sidebar
          clusters={clusters}
          reachability={reachability}
          selectedClusterId={selectedClusterId}
          onSelect={(cluster) => setSelectedClusterId(cluster.id)}
          onAdd={() => setEditing('new')}
          onEdit={(cluster) => setEditing(cluster)}
          onRemove={handleRemove}
          onNotificationNavigate={handleNotificationNavigate}
        />

        {loadError ? (
          <div className="main-panel main-panel-empty">
            <div className="error-banner">{loadError}</div>
          </div>
        ) : (
          <MainPanel cluster={selectedCluster} tab={activeTab} onTabChange={setActiveTab} />
        )}

        {editing && (
          <ClusterForm
            initial={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  )
}
