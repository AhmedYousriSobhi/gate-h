import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { openTeleportLogin } from '../ssh/manager'
import { getTeleportSessions } from '../teleport/sessionState'

export function registerTeleportIpcHandlers(): void {
  ipcMain.handle('teleport:sessions', () => getTeleportSessions())
  ipcMain.handle(
    'teleport:login',
    (event: IpcMainInvokeEvent, clusterId: string, options: { renew: boolean }) =>
      openTeleportLogin(clusterId, Boolean(options?.renew), event.sender)
  )
}
