import { ipcMain } from './guard'
import {
  createCluster,
  getCluster,
  listClustersByProfile,
  removeCluster,
  setClusterActiveMonitoring,
  updateCluster
} from '../clusters'
import { refreshCluster } from '../monitor/clusterMonitor'
import { pruneUnusedAzureProfiles, stopTunnel } from '../azure/tunnel'
import { refreshTeleportSessions } from '../teleport/sessionState'
import { getActiveProfileId } from '../profiles'
import { importFromSshConfig } from '../sshConfigImport'
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
    const existing = getCluster(id)
    // A running tunnel keeps the settings it was started with, so it only needs dropping when
    // those settings actually changed - not on every edit of the cluster, which would otherwise
    // sever any SSH session already running through it (e.g. editing Slurm or Grafana settings on
    // an Azure-tunneled cluster had no business tearing down its tunnel).
    const azureTunnelChanged =
      JSON.stringify(existing?.azureTunnel ?? null) !== JSON.stringify(input.azureTunnel ?? null)
    if (existing?.azureTunnel && azureTunnelChanged) await stopTunnel(id)
    const updated = updateCluster(id, input)
    if (azureTunnelChanged) pruneUnusedAzureProfiles()
    refreshCluster(updated)
    // Also when Teleport was just turned off, so the cluster drops out of the session state.
    void refreshTeleportSessions()
    return updated
  })
  ipcMain.handle('clusters:remove', async (_event, id: string) => {
    if (getCluster(id)?.azureTunnel) await stopTunnel(id)
    const wasTeleport = Boolean(getCluster(id)?.teleport)
    removeCluster(id)
    pruneUnusedAzureProfiles()
    if (wasTeleport) void refreshTeleportSessions()
  })
  ipcMain.handle('clusters:setActiveMonitoring', async (_event, id: string, active: boolean) => {
    // Standby means no connections at all for the cluster, and the tunnel is one.
    if (!active && getCluster(id)?.azureTunnel) await stopTunnel(id)
    return setClusterActiveMonitoring(id, active)
  })
  ipcMain.handle('clusters:importFromSshConfig', () => importFromSshConfig())
}
