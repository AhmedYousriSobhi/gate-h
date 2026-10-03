import { ipcMain } from 'electron'
import { pruneUnusedAzureProfiles, stopTunnel } from '../azure/tunnel'
import { listClustersByProfile } from '../clusters'
import {
  countClustersInProfile,
  createProfile,
  getActiveProfileId,
  listProfiles,
  removeProfile,
  renameProfile,
  setActiveProfileId
} from '../profiles'

export function registerProfileIpcHandlers(): void {
  ipcMain.handle('profiles:list', () => listProfiles())
  ipcMain.handle('profiles:getActiveId', () => getActiveProfileId())
  ipcMain.on('profiles:setActiveId', (_event, id: string) => setActiveProfileId(id))
  ipcMain.handle('profiles:create', (_event, name: string) => createProfile(name))
  ipcMain.handle('profiles:rename', (_event, id: string, name: string) => renameProfile(id, name))
  ipcMain.handle('profiles:remove', async (_event, id: string) => {
    // The profile's clusters are deleted with it, so their tunnels must stop first (an `az` process
    // would otherwise keep running against a profile directory about to be pruned).
    const tunneled = listClustersByProfile(id).filter((c) => c.azureTunnel)
    removeProfile(id)
    await Promise.all(tunneled.map((c) => stopTunnel(c.id)))
    pruneUnusedAzureProfiles()
  })
  ipcMain.handle('profiles:countClusters', (_event, id: string) => countClustersInProfile(id))
}
