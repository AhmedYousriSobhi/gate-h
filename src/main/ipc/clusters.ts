import { ipcMain } from 'electron'
import {
  createCluster,
  getCluster,
  listClustersByProfile,
  removeCluster,
  setClusterActiveMonitoring,
  setClusterKeepAlive,
  updateCluster
} from '../clusters'
import { refreshCluster } from '../monitor/clusterMonitor'
import { stopTunnel } from '../azure/tunnel'
import { refreshTeleportSessions } from '../teleport/sessionState'
import { getActiveProfileId } from '../profiles'
import type { ClusterInput } from '../../shared/types'

export function registerClusterIpcHandlers(): void {
  ipcMain.handle('clusters:list', () => listClustersByProfile(getActiveProfileId()))
  ipcMain.handle('clusters:get', (_event, id: string) => getCluster(id))
  ipcMain.handle('clusters:create', (_event, input: ClusterInput) => {
    const created = createCluster(input)
    refreshCluster(created)
    if (created.teleport) void refreshTeleportSessions()
    return created
  })
  ipcMain.handle('clusters:update', async (_event, id: string, input: ClusterInput) => {
    // A running tunnel keeps the settings it was started with - drop it so the next connect
    // opens one matching the edited config.
    if (getCluster(id)?.azureTunnel) await stopTunnel(id)
    const updated = updateCluster(id, input)
    refreshCluster(updated)
    // Also when Teleport was just turned off, so the cluster drops out of the session state.
    void refreshTeleportSessions()
    return updated
  })
  ipcMain.handle('clusters:remove', async (_event, id: string) => {
    if (getCluster(id)?.azureTunnel) await stopTunnel(id)
    const wasTeleport = Boolean(getCluster(id)?.teleport)
    removeCluster(id)
    if (wasTeleport) void refreshTeleportSessions()
  })
  ipcMain.handle('clusters:setKeepAlive', (_event, id: string, keepAlive: boolean) =>
    setClusterKeepAlive(id, keepAlive)
  )
  ipcMain.handle('clusters:setActiveMonitoring', async (_event, id: string, active: boolean) => {
    // Standby means no connections at all for the cluster, and the tunnel is one.
    if (!active && getCluster(id)?.azureTunnel) await stopTunnel(id)
    return setClusterActiveMonitoring(id, active)
  })
}
