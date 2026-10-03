import { type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import { ipcMain } from './guard'
import { closeSession, openSshSession, resizeSession, writeToSession } from '../ssh/manager'

export function registerSshIpcHandlers(): void {
  ipcMain.handle('ssh:connect', (event: IpcMainInvokeEvent, clusterId: string) =>
    openSshSession(clusterId, event.sender)
  )

  ipcMain.on('ssh:write', (_event: IpcMainEvent, sessionId: string, data: string) => {
    writeToSession(sessionId, data)
  })

  ipcMain.on(
    'ssh:resize',
    (_event: IpcMainEvent, sessionId: string, cols: number, rows: number) => {
      resizeSession(sessionId, cols, rows)
    }
  )

  ipcMain.on('ssh:disconnect', (_event: IpcMainEvent, sessionId: string) => {
    closeSession(sessionId)
  })
}
