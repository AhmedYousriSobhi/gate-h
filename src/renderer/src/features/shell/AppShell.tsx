import { useEffect, useState } from 'react'
import type { ClusterInput, ClusterSummary } from '../../../../shared/types'
import ClusterForm from '../clusters/ClusterForm'
import Sidebar from './Sidebar'
import MainPanel from './MainPanel'
import TitleBar from './TitleBar'
import OverviewDashboard from './OverviewDashboard'
import { useReachability } from '../../hooks/useReachability'
import { useNotifications } from '../../hooks/useNotifications'
import { useProfiles } from '../../hooks/useProfiles'
import { usePanelLayout } from '../../hooks/usePanelLayout'
import { withWidgetVisible, type WidgetType } from './panelLayout'
import './shell.css'

export default function AppShell(): React.JSX.Element {
  const [clusters, setClusters] = useState<ClusterSummary[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)
  // One shared layout rather than per-cluster: it's a workspace preference ("I like Terminal and
  // Status side by side") more than cluster-specific state. Persisted across restarts - see
  // src/main/settings.ts.
  const { layout: panelLayout, setLayout: setPanelLayout } = usePanelLayout()
  const [editing, setEditing] = useState<ClusterSummary | 'new' | null>(null)
  const [reconnectSignal, setReconnectSignal] = useState(0)
  const profilesState = useProfiles()
  const { notifications, markRead, markAllRead } = useNotifications()
  const reachability = useReachability((clusterId, from, to) => {
    // A single, one-shot nudge - not a retry loop - when the *currently open* cluster's
    // connection comes back after being down (e.g. the user just reconnected their VPN), so they
    // don't have to remember to click Reconnect themselves. Anything else (a different cluster
    // flapping in the background, going offline, or already being watched) does nothing here.
    if (clusterId === selectedClusterId && from === 'offline' && to === 'online') {
      setReconnectSignal((n) => n + 1)
    }
  })

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

  function handleNotificationNavigate(clusterId: string, widget?: WidgetType): void {
    setSelectedClusterId(clusterId)
    if (widget) setPanelLayout(withWidgetVisible(panelLayout, widget))
  }

  function handleConnect(cluster: ClusterSummary): void {
    setSelectedClusterId(cluster.id)
    setPanelLayout(withWidgetVisible(panelLayout, 'terminal'))
  }

  function handleViewStatus(cluster: ClusterSummary): void {
    setSelectedClusterId(cluster.id)
    setPanelLayout(withWidgetVisible(panelLayout, 'status'))
  }

  function handleProfileChanged(): void {
    // Clusters are scoped to the active profile server-side, so switching profiles means the
    // previously selected cluster (if any) almost certainly doesn't belong to the new one.
    setSelectedClusterId(null)
    void refresh()
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
          onShowOverview={() => setSelectedClusterId(null)}
          onAdd={() => setEditing('new')}
          onEdit={(cluster) => setEditing(cluster)}
          onRemove={handleRemove}
          notifications={notifications}
          markNotificationRead={markRead}
          markAllNotificationsRead={markAllRead}
          onNotificationNavigate={handleNotificationNavigate}
          profilesState={profilesState}
          onProfileChanged={handleProfileChanged}
        />

        {loadError ? (
          <div className="main-panel main-panel-empty">
            <div className="error-banner">{loadError}</div>
          </div>
        ) : selectedCluster ? (
          <MainPanel
            cluster={selectedCluster}
            layout={panelLayout}
            onLayoutChange={setPanelLayout}
            reconnectSignal={reconnectSignal}
          />
        ) : (
          <OverviewDashboard
            profileName={profilesState.activeProfile?.name ?? ''}
            clusters={clusters}
            reachability={reachability}
            notifications={notifications}
            onConnect={handleConnect}
            onViewStatus={handleViewStatus}
            onAdd={() => setEditing('new')}
          />
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
