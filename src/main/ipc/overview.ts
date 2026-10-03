import { ipcMain } from './guard'
import { getOverviewViewMode, setOverviewViewMode } from '../settings'
import type { OverviewViewMode } from '../../shared/types'

export function registerOverviewIpcHandlers(): void {
  ipcMain.handle('overview:getViewMode', () => getOverviewViewMode())
  ipcMain.on('overview:setViewMode', (_event, mode: OverviewViewMode) => setOverviewViewMode(mode))
}
