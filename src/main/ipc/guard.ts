import { ipcMain as electronIpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'

// Only the app's own page may drive these handlers. The main window is the only thing given the
// preload bridge today, but a handler is reachable by any frame that can call `ipcRenderer`, so
// the check lives here, at the one place every handler is registered, instead of being something
// each handler has to remember.
const PROD_PAGE = pathToFileURL(join(__dirname, '../renderer/index.html')).href

function isAppFrame(url: string | undefined): boolean {
  if (!url) return false
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return new URL(url).origin === new URL(devUrl).origin
  return url.startsWith(PROD_PAGE)
}

type InvokeListener = (event: IpcMainInvokeEvent, ...args: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
type SendListener = (event: IpcMainEvent, ...args: any[]) => void // eslint-disable-line @typescript-eslint/no-explicit-any

export const ipcMain = {
  handle(channel: string, listener: InvokeListener): void {
    electronIpcMain.handle(channel, (event, ...args) => {
      if (!isAppFrame(event.senderFrame?.url)) {
        throw new Error(`Blocked IPC call to '${channel}' from an untrusted frame`)
      }
      return listener(event, ...args)
    })
  },
  on(channel: string, listener: SendListener): void {
    electronIpcMain.on(channel, (event, ...args) => {
      if (!isAppFrame(event.senderFrame?.url)) return
      listener(event, ...args)
    })
  }
}
