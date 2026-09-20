import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ClusterInput, HGateApi } from '../shared/types'

// Custom APIs for renderer - a narrow, explicit surface over IPC. The renderer never gets
// direct Node/Electron access, and secrets never travel back across this bridge.
const api: HGateApi = {
  clusters: {
    list: () => ipcRenderer.invoke('clusters:list'),
    get: (id: string) => ipcRenderer.invoke('clusters:get', id),
    create: (input: ClusterInput) => ipcRenderer.invoke('clusters:create', input),
    update: (id: string, input: ClusterInput) => ipcRenderer.invoke('clusters:update', id, input),
    remove: (id: string) => ipcRenderer.invoke('clusters:remove', id)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
