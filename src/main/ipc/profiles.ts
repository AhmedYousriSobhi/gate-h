import { ipcMain } from 'electron'
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
  ipcMain.handle('profiles:remove', (_event, id: string) => removeProfile(id))
  ipcMain.handle('profiles:countClusters', (_event, id: string) => countClustersInProfile(id))
}
