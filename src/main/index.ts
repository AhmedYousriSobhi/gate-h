import { app, shell, BrowserWindow, Menu } from 'electron'
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
import { registerOverviewIpcHandlers } from './ipc/overview'
import { registerAzureIpcHandlers } from './ipc/azure'
import { pruneUnusedAzureProfiles, setAzureStatusBroadcaster, stopAllTunnels } from './azure/tunnel'
import { registerTeleportIpcHandlers } from './ipc/teleport'
import { startTeleportSessionMonitor, stopTeleportSessionMonitor } from './teleport/sessionState'
import { closeAllSessions } from './ssh/manager'
import { registerSchedulerIpcHandlers } from './ipc/scheduler'
import { registerStorageIpcHandlers } from './ipc/storage'
import { registerFileIpcHandlers } from './ipc/files'
import { registerTemplateIpcHandlers } from './ipc/templates'
import { registerSnippetIpcHandlers } from './ipc/snippets'
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
import { adoptLoginShellPath } from './shellPath'
import type {
  AzureTunnelStatusEvent,
  ClusterNotification,
  ClusterReachability,
  SchedulerSnapshot,
  TeleportSessionInfo
} from '../shared/types'

// Must run before anything (including app.whenReady()) touches the userData path.
initUserDataDir()
// Before anything spawns tsh/az/bash - see shellPath.ts.
adoptLoginShellPath()

const isMac = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null

/** `shell.openExternal` hands the URL to the OS, so anything but a web link (file:, a custom app
 *  scheme, ...) coming out of a window.open or navigation could launch something local. */
function openExternalSafely(url: string): void {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url)
  } catch {
    // Not a URL - nothing to open.
  }
}

function createWindow(): void {
  // Create the browser window. Frameless with a custom title bar (see
  // src/renderer/src/features/shell/TitleBar.tsx) rather than the OS-native one - double-click-to-
  // maximize on a native title bar is a window-manager behavior Electron doesn't control on Linux,
  // and it's inconsistent across WMs/compositors. A custom title bar makes it work everywhere.
  // macOS keeps its own traffic-light controls instead, inset into the same 32px bar, with the
  // system's own double-click and zoom behavior.
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 640,
    minHeight: 480,
    show: false,
    ...(isMac
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 9 } }
      : { frame: false }),
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
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
    openExternalSafely(details.url)
    return { action: 'deny' }
  })

  // The window has the preload bridge, so it must never end up showing anything but the app itself.
  win.webContents.on('will-navigate', (event, url) => {
    const appUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
    const sameApp = appUrl
      ? new URL(url).origin === new URL(appUrl).origin
      : url.startsWith('file://')
    if (!sameApp) {
      event.preventDefault()
      openExternalSafely(url)
    }
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

  // macOS shows an app menu whether or not the app sets one; an explicit one names the app and
  // keeps Cmd+C/V/A/Z working in every input (those shortcuts come from the Edit menu's roles).
  if (isMac) {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
          ]
        },
        { role: 'windowMenu' }
      ])
    )
  }

  // Grafana's own panel-hover menu (View/Explore/...) opens via window.open() - webview guests
  // block that outright unless allowed (see the `allowpopups` attribute on the <webview> in
  // GrafanaStatusSection.tsx), and once allowed, Electron's default is to spawn a bare, unstyled
  // popup window. Route it through the system browser instead, same as the main window's own
  // external links (see win.webContents.setWindowOpenHandler above).
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler((details) => {
      openExternalSafely(details.url)
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
  registerOverviewIpcHandlers()
  registerAzureIpcHandlers()
  // Catches profiles orphaned by anything that bypassed the remove/edit handlers (a crash mid-way).
  pruneUnusedAzureProfiles()
  registerTeleportIpcHandlers()
  registerSchedulerIpcHandlers()
  registerStorageIpcHandlers()
  registerFileIpcHandlers()
  registerTemplateIpcHandlers()
  registerSnippetIpcHandlers()

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
// explicitly with Cmd + Q. The sessions belonged to the closed window, so they
// end with it either way; the background monitors keep running until the app
// actually quits, so a window reopened from the Dock (see 'activate') is live.
app.on('window-all-closed', () => {
  closeAllSessions()
  stopAllTunnels()
  if (!isMac) app.quit()
})

app.on('before-quit', () => {
  closeAllSessions()
  stopAllTunnels()
  stopClusterMonitor()
  stopJiraMonitor()
  stopTeleportSessionMonitor()
  stopSchedulerMonitor()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
