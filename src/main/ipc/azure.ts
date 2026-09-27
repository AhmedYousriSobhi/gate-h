import { ipcMain } from 'electron'
import { listSubscriptions } from '../azure/tunnel'

export function registerAzureIpcHandlers(): void {
  ipcMain.handle('azure:listSubscriptions', () => listSubscriptions())
}
