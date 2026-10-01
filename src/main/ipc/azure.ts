import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { findVm, listSubscriptions, verifyTunnel } from '../azure/tunnel'
import { getCluster } from '../clusters'

export function registerAzureIpcHandlers(): void {
  ipcMain.handle('azure:listSubscriptions', () => listSubscriptions())
  ipcMain.handle('azure:findVm', (_event: IpcMainInvokeEvent, vmName: string) => findVm(vmName))
  ipcMain.handle('azure:verifyTunnel', (_event: IpcMainInvokeEvent, clusterId: string) => {
    const cluster = getCluster(clusterId)
    if (!cluster) throw new Error('Cluster not found')
    return verifyTunnel(cluster)
  })
}
