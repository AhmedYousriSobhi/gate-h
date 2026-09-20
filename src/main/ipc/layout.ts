import { ipcMain } from 'electron'
import { getPanelLayout, setPanelLayout } from '../settings'
import type { PanelLayout } from '../../shared/types'

export function registerLayoutIpcHandlers(): void {
  ipcMain.handle('layout:get', () => getPanelLayout())
  ipcMain.on('layout:set', (_event, layout: PanelLayout) => setPanelLayout(layout))
}
