import { ipcMain } from './guard'
import { fetchStorageUsage } from '../storage/usage'

export function registerStorageIpcHandlers(): void {
  ipcMain.handle('storage:usage', (_event, clusterId: string, extraPaths?: string[]) =>
    fetchStorageUsage(clusterId, Array.isArray(extraPaths) ? extraPaths.map(String) : [])
  )
}
