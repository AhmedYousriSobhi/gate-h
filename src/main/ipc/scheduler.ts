import { ipcMain } from './guard'
import { cancelJob, submitScript } from '../scheduler/submit'
import {
  fetchArrayTasks,
  fetchJobHistory,
  getCachedSnapshots,
  sampleJobGpus,
  refreshScheduler,
  unwatchScheduler,
  watchScheduler
} from '../scheduler/monitor'

export function registerSchedulerIpcHandlers(): void {
  ipcMain.handle('scheduler:getCached', () => getCachedSnapshots())
  ipcMain.on('scheduler:watch', (_event, clusterId: string) => watchScheduler(clusterId))
  ipcMain.on('scheduler:unwatch', (_event, clusterId: string) => unwatchScheduler(clusterId))
  ipcMain.on('scheduler:refresh', (_event, clusterId: string) => refreshScheduler(clusterId))
  ipcMain.handle('scheduler:arrayTasks', (_event, clusterId: string, arrayJobId: string) =>
    fetchArrayTasks(clusterId, arrayJobId)
  )
  ipcMain.handle(
    'scheduler:submit',
    async (event, clusterId: string, script: string, label: string) => {
      const jobId = await submitScript(clusterId, String(script), String(label), event.sender)
      if (jobId) refreshScheduler(clusterId, { force: true })
      return jobId
    }
  )
  ipcMain.handle('scheduler:cancel', async (event, clusterId: string, jobId: string) => {
    const cancelled = await cancelJob(clusterId, String(jobId), event.sender)
    if (cancelled) refreshScheduler(clusterId, { force: true })
    return cancelled
  })
  ipcMain.handle(
    'scheduler:sampleGpus',
    (_event, clusterId: string, jobId: string, nodes: number) =>
      sampleJobGpus(clusterId, jobId, nodes)
  )
  ipcMain.handle(
    'scheduler:history',
    (_event, clusterId: string, days: number, allUsers?: boolean) =>
      fetchJobHistory(clusterId, days, allUsers === true)
  )
}
