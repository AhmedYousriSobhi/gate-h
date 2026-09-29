import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerClusterIpcHandlers } from './ipc/clusters'
import { registerSshIpcHandlers } from './ipc/ssh'
import { registerGrafanaIpcHandlers } from './ipc/grafana'
import { setupGrafanaEmbedSession } from './grafana/embed'
import { registerJiraIpcHandlers } from './ipc/jira'
import { registerReachabilityIpcHandlers } from './ipc/reachability'
import { registerNotificationIpcHandlers } from './ipc/notifications'
import { registerWindowIpcHandlers } from './ipc/window'
import { registerProfileIpcHandlers } from './ipc/profiles'
import { registerLayoutIpcHandlers } from './ipc/layout'
import { registerAzureIpcHandlers } from './ipc/azure'
import { setAzureStatusBroadcaster, stopAllTunnels } from './azure/tunnel'
import { registerTeleportIpcHandlers } from './ipc/teleport'
import { startTeleportSessionMonitor, stopTeleportSessionMonitor } from './teleport/sessionState'
import { closeAllSessions } from './ssh/manager'
import { registerSchedulerIpcHandlers } from './ipc/scheduler'
import { registerStorageIpcHandlers } from './ipc/storage'
import { registerFileIpcHandlers } from './ipc/files'
import {
  setSchedulerBroadcaster,
  setSchedulerWindowFocused,
  startSchedulerMonitor,
  stopSchedulerMonitor
} from './scheduler/monitor'
import {
  startClusterMonitor,
  stopClusterMonitor,
  triggerImmediateSweepIfStale
} from './monitor/clusterMonitor'
import { startJiraMonitor, stopJiraMonitor } from './monitor/jiraMonitor'
import { setNotificationBroadcaster } from './notifications/store'
import { initUserDataDir } from './userData'
import type {
  AzureTunnelStatusEvent,
  ClusterNotification,
  ClusterReachability,
  SchedulerSnapshot,
  TeleportSessionInfo
} from '../shared/types'

// Must run before anything (including app.whenReady()) touches the userData path.
initUserDataDir()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window. Frameless with a custom title bar (see
  // src/renderer/src/features/shell/TitleBar.tsx) rather than the OS-native one - double-click-to-
  // maximize on a native title bar is a window-manager behavior Electron doesn't control on Linux,
  // and it's inconsistent across WMs/compositors. A custom title bar makes it work everywhere.
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 640,
    minHeight: 480,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Only for embedding a cluster's own Grafana panels live (see grafana/embed.ts) - the
      // webview is pointed exclusively at Grafana origins the user configured, in their own
      // dedicated session partition.
      webviewTag: true
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('maximize', () => win.webContents.send('window:maximized-changed', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized-changed', false))

  // Catch up on reachability quickly after the user comes back to the app (e.g. right after
  // reconnecting a VPN) instead of waiting for the next scheduled sweep - throttled inside
  // triggerImmediateSweepIfStale so this can never turn into extra probing beyond the normal
  // sweep cadence.
  win.on('focus', () => {
    triggerImmediateSweepIfStale()
    setSchedulerWindowFocused(true)
  })
  win.on('blur', () => setSchedulerWindowFocused(false))

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('de.yousri.gateh')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupGrafanaEmbedSession()

  // Grafana's own panel-hover menu (View/Explore/...) opens via window.open() - webview guests
  // block that outright unless allowed (see the `allowpopups` attribute on the <webview> in
  // GrafanaStatusSection.tsx), and once allowed, Electron's default is to spawn a bare, unstyled
  // popup window. Route it through the system browser instead, same as the main window's own
  // external links (see win.webContents.setWindowOpenHandler above).
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
  })

  registerClusterIpcHandlers()
  registerSshIpcHandlers()
  registerGrafanaIpcHandlers()
  registerJiraIpcHandlers()
  registerReachabilityIpcHandlers()
  registerNotificationIpcHandlers()
  registerWindowIpcHandlers(() => mainWindow)
  registerProfileIpcHandlers()
  registerLayoutIpcHandlers()
  registerAzureIpcHandlers()
  registerTeleportIpcHandlers()
  registerSchedulerIpcHandlers()
  registerStorageIpcHandlers()
  registerFileIpcHandlers()

  createWindow()

  startClusterMonitor((event: ClusterReachability) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reachability:update', event)
    }
  })

  setNotificationBroadcaster((notification: ClusterNotification) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notifications:created', notification)
    }
  })
  setAzureStatusBroadcaster((event: AzureTunnelStatusEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('azure:status', event)
    }
  })
  startJiraMonitor()
  setSchedulerBroadcaster((snapshot: SchedulerSnapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scheduler:snapshot', snapshot)
    }
  })
  startSchedulerMonitor()
  startTeleportSessionMonitor((sessions: Record<string, TeleportSessionInfo>) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('teleport:sessions', sessions)
    }
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  closeAllSessions()
  stopAllTunnels()
  stopClusterMonitor()
  stopJiraMonitor()
  stopTeleportSessionMonitor()
  stopSchedulerMonitor()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
