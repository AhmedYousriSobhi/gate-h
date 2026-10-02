import { ipcMain } from 'electron'
import {
  getPanelLayout,
  getSidebarWidth,
  getStatusLayout,
  setPanelLayout,
  setSidebarWidth,
  setStatusLayout
} from '../settings'
import type { PanelLayout, StatusLayout } from '../../shared/types'

export function registerLayoutIpcHandlers(): void {
  ipcMain.handle('layout:get', () => getPanelLayout())
  ipcMain.on('layout:set', (_event, layout: PanelLayout) => setPanelLayout(layout))
  ipcMain.handle('statusLayout:get', () => getStatusLayout())
  ipcMain.on('statusLayout:set', (_event, layout: StatusLayout) => setStatusLayout(layout))
  ipcMain.handle('sidebarWidth:get', () => getSidebarWidth())
  ipcMain.on('sidebarWidth:set', (_event, width: number) => setSidebarWidth(width))
}
