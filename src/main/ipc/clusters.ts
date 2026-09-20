import { ipcMain } from 'electron'
import { createCluster, getCluster, listClusters, removeCluster, updateCluster } from '../clusters'
import type { ClusterInput } from '../../shared/types'

export function registerClusterIpcHandlers(): void {
  ipcMain.handle('clusters:list', () => listClusters())
  ipcMain.handle('clusters:get', (_event, id: string) => getCluster(id))
  ipcMain.handle('clusters:create', (_event, input: ClusterInput) => createCluster(input))
  ipcMain.handle('clusters:update', (_event, id: string, input: ClusterInput) =>
    updateCluster(id, input)
  )
  ipcMain.handle('clusters:remove', (_event, id: string) => removeCluster(id))
}
