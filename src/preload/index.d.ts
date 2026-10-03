import type { GateHApi } from '../shared/types'

declare global {
  interface Window {
    api: GateHApi
  }
}
