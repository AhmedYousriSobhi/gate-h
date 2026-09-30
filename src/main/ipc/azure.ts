import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { findVm, listSubscriptions } from '../azure/tunnel'

export function registerAzureIpcHandlers(): void {
  ipcMain.handle('azure:listSubscriptions', () => listSubscriptions())
  ipcMain.handle('azure:findVm', (_event: IpcMainInvokeEvent, vmName: string) => findVm(vmName))
}
