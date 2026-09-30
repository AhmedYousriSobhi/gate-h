import { useEffect, useMemo, useState } from 'react'
import type { ClusterInput, ClusterSummary } from '../../../../shared/types'
import ClusterForm from '../clusters/ClusterForm'
import Sidebar from './Sidebar'
import MainPanel from './MainPanel'
import TitleBar from './TitleBar'
import Toaster from '../toast/Toaster'
import OverviewDashboard from './OverviewDashboard'
import ImportSshConfigDialog from './ImportSshConfigDialog'
import { useReachability } from '../../hooks/useReachability'
import { useNotifications } from '../../hooks/useNotifications'
import { useProfiles } from '../../hooks/useProfiles'
import { usePanelLayout } from '../../hooks/usePanelLayout'
import { withWidgetVisible, type WidgetType } from './panelLayout'
import type { SessionStatus } from '../terminal/TerminalPanel'
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
  const [importOpen, setImportOpen] = useState(false)
  const [terminalStatuses, setTerminalStatuses] = useState<Record<string, SessionStatus>>({})
  const [liveSessionCounts, setLiveSessionCounts] = useState<Record<string, number>>({})
  // Every cluster selected since launch that hasn't been explicitly closed - switching away never
  // ends its sessions. Only Close, standby, removal and a profile switch take a cluster out.
  const [openClusterIds, setOpenClusterIds] = useState<string[]>([])
  const profilesState = useProfiles()
  const { notifications, markRead, markAllRead } = useNotifications()
  // Every mounted cluster's Terminal/Grafana get this raw, per-cluster reading straight through
  // (see MainPanel/TerminalPanel/GrafanaStatusSection's `reachability` prop) instead of a one-shot
  // "just came back online" signal derived here - a derived signal only fires on an observed
  // offline -> online flip, which misses a cluster that's already online when its session first
  // pauses (nothing to flip). Reading the live value directly lets a paused session recheck it on
  // every push (roughly every 60s - see clusterMonitor's sweep interval), not just on a flip.
  const reachability = useReachability()

  // Open clusters stay mounted (hidden when not selected) so their sessions stay connected in the
  // background - see MainPanel's `hidden` prop.
  const activeClusterIds = useMemo(
    () =>
      selectedClusterId && !openClusterIds.includes(selectedClusterId)
        ? [...openClusterIds, selectedClusterId]
        : openClusterIds,
    [openClusterIds, selectedClusterId]
  )

  function selectCluster(id: string | null): void {
    setSelectedClusterId(id)
    if (id) setOpenClusterIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  function closeCluster(id: string): void {
    setOpenClusterIds((prev) => prev.filter((openId) => openId !== id))
    setSelectedClusterId((prev) => (prev === id ? null : prev))
  }

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
      selectCluster(created.id)
    }
    setEditing(null)
    await refresh()
  }

  async function handleRemove(cluster: ClusterSummary): Promise<void> {
    if (!confirm(`Remove cluster "${cluster.name}"? This cannot be undone.`)) return
    await window.api.clusters.remove(cluster.id)
    closeCluster(cluster.id)
    await refresh()
  }

  function handleNotificationNavigate(clusterId: string, widget?: WidgetType): void {
    selectCluster(clusterId)
    if (widget) setPanelLayout(withWidgetVisible(panelLayout, widget))
  }

  function handleConnect(cluster: ClusterSummary): void {
    selectCluster(cluster.id)
    setPanelLayout(withWidgetVisible(panelLayout, 'terminal'))
  }

  function handleViewStatus(cluster: ClusterSummary): void {
    selectCluster(cluster.id)
    setPanelLayout(withWidgetVisible(panelLayout, 'status'))
  }

  async function handleToggleActiveMonitoring(cluster: ClusterSummary): Promise<void> {
    await window.api.clusters.setActiveMonitoring(cluster.id, !cluster.activeMonitoring)
    // Standby ends every session anyway, so a background standby cluster needn't stay open.
    if (cluster.activeMonitoring && cluster.id !== selectedClusterId) closeCluster(cluster.id)
    await refresh()
  }

  function handleProfileChanged(): void {
    // Clusters are scoped to the active profile server-side, so switching profiles means the
    // previously selected cluster (if any) almost certainly doesn't belong to the new one. Its
    // open sessions end too: a profile is a separate context, often separate credentials.
    setSelectedClusterId(null)
    setOpenClusterIds([])
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
          onSelect={(cluster) => selectCluster(cluster.id)}
          onShowOverview={() => selectCluster(null)}
          onAdd={() => setEditing('new')}
          onImport={() => setImportOpen(true)}
          onEdit={(cluster) => setEditing(cluster)}
          onRemove={handleRemove}
          notifications={notifications}
          markNotificationRead={markRead}
          markAllNotificationsRead={markAllRead}
          onNotificationNavigate={handleNotificationNavigate}
          profilesState={profilesState}
          onProfileChanged={handleProfileChanged}
          terminalStatuses={terminalStatuses}
          openClusterIds={activeClusterIds}
          liveSessionCounts={liveSessionCounts}
          onCloseSessions={(cluster) => closeCluster(cluster.id)}
          onToggleActiveMonitoring={handleToggleActiveMonitoring}
        />

        {loadError ? (
          <div className="main-panel main-panel-empty">
            <div className="error-banner">{loadError}</div>
          </div>
        ) : (
          <>
            {!selectedCluster && (
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
            {/* One MainPanel per open cluster, all kept mounted simultaneously
                - only the selected one is visible - so their sessions stay connected while the
                user is looking at a different cluster (or the Overview), see MainPanel's `hidden`
                prop. */}
            {activeClusterIds.map((id) => {
              const cluster = clusters.find((c) => c.id === id)
              if (!cluster) return null
              return (
                <MainPanel
                  key={id}
                  cluster={cluster}
                  layout={panelLayout}
                  onLayoutChange={setPanelLayout}
                  reachability={reachability[id]}
                  hidden={id !== selectedClusterId}
                  // Returning `prev` unchanged is what stops a render loop: this callback is a new
                  // function every render, so TerminalPanel's effect re-fires on each one.
                  onTerminalStatusChange={(status) =>
                    setTerminalStatuses((prev) =>
                      prev[id] === status ? prev : { ...prev, [id]: status }
                    )
                  }
                  onLiveSessionCountChange={(count) =>
                    setLiveSessionCounts((prev) =>
                      prev[id] === count ? prev : { ...prev, [id]: count }
                    )
                  }
                  onResumeMonitoring={() => handleToggleActiveMonitoring(cluster)}
                />
              )
            })}
          </>
        )}

        {editing && (
          <ClusterForm
            initial={editing === 'new' ? undefined : editing}
            existingClusters={clusters}
            onCancel={() => setEditing(null)}
            onSubmit={handleSubmit}
          />
        )}
        {importOpen && (
          <ImportSshConfigDialog
            onClose={() => setImportOpen(false)}
            onImported={() => void refresh()}
          />
        )}
      </div>
      <Toaster />
    </div>
  )
}
