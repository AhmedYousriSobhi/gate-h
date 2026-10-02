import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  checkAzureAuth,
  clearAzureAuth,
  findVm,
  listSubscriptions,
  loginAzure,
  verifyTunnel
} from '../azure/tunnel'
import { getCluster } from '../clusters'

function getAzureCluster(clusterId: string): NonNullable<ReturnType<typeof getCluster>> {
  const cluster = getCluster(clusterId)
  if (!cluster?.azureTunnel) throw new Error('This cluster has no Azure tunnel configured')
  return cluster
}

export function registerAzureIpcHandlers(): void {
  ipcMain.handle('azure:listSubscriptions', () => listSubscriptions())
  ipcMain.handle('azure:findVm', (_event: IpcMainInvokeEvent, vmName: string) => findVm(vmName))
  ipcMain.handle('azure:verifyTunnel', (_event: IpcMainInvokeEvent, clusterId: string) => {
    const cluster = getCluster(clusterId)
    if (!cluster) throw new Error('Cluster not found')
    return verifyTunnel(cluster)
  })
  ipcMain.handle('azure:checkAuth', (_event: IpcMainInvokeEvent, clusterId: string) =>
    checkAzureAuth(getAzureCluster(clusterId).azureTunnel?.tenant)
  )
  ipcMain.handle('azure:login', (_event: IpcMainInvokeEvent, clusterId: string) =>
    loginAzure(getAzureCluster(clusterId))
  )
  ipcMain.handle('azure:clearAuth', () => clearAzureAuth())
}
