import { ipcMain } from 'electron'
import { createCluster, getCluster, listClusters, removeCluster, updateCluster } from '../clusters'
import { refreshCluster } from '../monitor/clusterMonitor'
import type { ClusterInput } from '../../shared/types'

export function registerClusterIpcHandlers(): void {
  ipcMain.handle('clusters:list', () => listClusters())
  ipcMain.handle('clusters:get', (_event, id: string) => getCluster(id))
  ipcMain.handle('clusters:create', (_event, input: ClusterInput) => {
    const created = createCluster(input)
    refreshCluster(created.id, created.name, created.connection.host, created.connection.port)
    return created
  })
  ipcMain.handle('clusters:update', (_event, id: string, input: ClusterInput) => {
    const updated = updateCluster(id, input)
    refreshCluster(updated.id, updated.name, updated.connection.host, updated.connection.port)
    return updated
  })
  ipcMain.handle('clusters:remove', (_event, id: string) => removeCluster(id))
}
