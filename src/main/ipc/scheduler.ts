import { ipcMain } from 'electron'
import {
  fetchArrayTasks,
  fetchJobHistory,
  refreshScheduler,
  unwatchScheduler,
  watchScheduler
} from '../scheduler/monitor'

export function registerSchedulerIpcHandlers(): void {
  ipcMain.on('scheduler:watch', (_event, clusterId: string) => watchScheduler(clusterId))
  ipcMain.on('scheduler:unwatch', (_event, clusterId: string) => unwatchScheduler(clusterId))
  ipcMain.on('scheduler:refresh', (_event, clusterId: string) => refreshScheduler(clusterId))
  ipcMain.handle('scheduler:arrayTasks', (_event, clusterId: string, arrayJobId: string) =>
    fetchArrayTasks(clusterId, arrayJobId)
  )
  ipcMain.handle('scheduler:history', (_event, clusterId: string, days: number) =>
    fetchJobHistory(clusterId, days)
  )
}
