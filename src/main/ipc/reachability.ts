import { ipcMain } from './guard'
import { getAllReachability } from '../monitor/clusterMonitor'

export function registerReachabilityIpcHandlers(): void {
  ipcMain.handle('reachability:getAll', () => getAllReachability())
}
