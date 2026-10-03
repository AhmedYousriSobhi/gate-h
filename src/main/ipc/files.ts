import { BrowserWindow, dialog, type WebContents } from 'electron'
import { ipcMain } from './guard'
import { basename, join } from 'path'
import { homedir } from 'os'
import { listDirectory, remoteExists, remoteJoin, transfer } from '../files/sftp'
import type { FileTransferEvent } from '../../shared/types'

function reporter(sender: WebContents): (event: FileTransferEvent) => void {
  return (event) => {
    if (!sender.isDestroyed()) sender.send('files:transfer', event)
  }
}

export function registerFileIpcHandlers(): void {
  ipcMain.handle('files:list', (_event, clusterId: string, path?: string) =>
    listDirectory(clusterId, path)
  )

  ipcMain.handle('files:download', async (event, clusterId: string, remotePath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { defaultPath: join(homedir(), 'Downloads', basename(remotePath)) }
    const { canceled, filePath } = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return false
    await transfer(clusterId, 'download', remotePath, filePath, reporter(event.sender))
    return true
  })

  ipcMain.handle('files:upload', async (event, clusterId: string, remoteDir: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      buttonLabel: 'Upload'
    }
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return 0

    const targets = filePaths.map((local) => ({
      local,
      remote: remoteJoin(remoteDir, basename(local))
    }))
    const existing: string[] = []
    for (const target of targets) {
      if (await remoteExists(clusterId, target.remote)) existing.push(basename(target.local))
    }
    if (existing.length) {
      const confirm = {
        type: 'warning' as const,
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Overwrite ${existing.length === 1 ? existing[0] : `${existing.length} files`} in ${remoteDir}?`,
        detail: existing.length > 1 ? existing.join('\n') : undefined
      }
      const { response } = window
        ? await dialog.showMessageBox(window, confirm)
        : await dialog.showMessageBox(confirm)
      if (response !== 0) return 0
    }
    // One at a time: parallel fastPuts on one SFTP channel only compete for its window.
    for (const target of targets) {
      await transfer(clusterId, 'upload', target.remote, target.local, reporter(event.sender))
    }
    return targets.length
  })
}
