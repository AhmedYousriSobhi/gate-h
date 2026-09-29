import { ipcMain } from 'electron'
import { fetchStorageUsage } from '../storage/usage'

export function registerStorageIpcHandlers(): void {
  ipcMain.handle('storage:usage', (_event, clusterId: string) => fetchStorageUsage(clusterId))
}
