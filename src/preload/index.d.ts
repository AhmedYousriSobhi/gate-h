import { ElectronAPI } from '@electron-toolkit/preload'
import type { GateHApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: GateHApi
  }
}
