import { ipcMain } from 'electron'
import {
  clearAllNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from '../notifications/store'

export function registerNotificationIpcHandlers(): void {
  ipcMain.handle('notifications:list', () => listNotifications())
  ipcMain.on('notifications:markRead', (_event, id: string) => markNotificationRead(id))
  ipcMain.on('notifications:markAllRead', () => markAllNotificationsRead())
  ipcMain.on('notifications:delete', (_event, id: string) => deleteNotification(id))
  ipcMain.on('notifications:clearAll', () => clearAllNotifications())
}
