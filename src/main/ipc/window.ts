import { type BrowserWindow } from 'electron'
import { ipcMain } from './guard'

/** IPC for the custom title bar (see src/renderer/src/features/shell/TitleBar.tsx) - the window
 *  is frameless, so minimize/maximize/close and double-click-to-maximize all have to be wired up
 *  by the app instead of relying on OS window-manager decorations. */
export function registerWindowIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.on('window:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.on('window:toggleMaximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on('window:close', () => {
    getWindow()?.close()
  })

  ipcMain.handle('window:isMaximized', () => getWindow()?.isMaximized() ?? false)
}
