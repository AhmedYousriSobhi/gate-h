import { ElectronAPI } from '@electron-toolkit/preload'
import type { HGateApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: HGateApi
  }
}
