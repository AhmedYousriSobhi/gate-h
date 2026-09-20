import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ClusterInput,
  ClusterNotification,
  ClusterReachability,
  CreateJiraIssueInput,
  GateHApi,
  SshClosedEvent,
  SshDataEvent,
  SshErrorEvent
} from '../shared/types'

// Custom APIs for renderer - a narrow, explicit surface over IPC. The renderer never gets
// direct Node/Electron access, and secrets never travel back across this bridge.
const api: GateHApi = {
  clusters: {
    list: () => ipcRenderer.invoke('clusters:list'),
    get: (id: string) => ipcRenderer.invoke('clusters:get', id),
    create: (input: ClusterInput) => ipcRenderer.invoke('clusters:create', input),
    update: (id: string, input: ClusterInput) => ipcRenderer.invoke('clusters:update', id, input),
    remove: (id: string) => ipcRenderer.invoke('clusters:remove', id)
  },
  grafana: {
    getStatus: (clusterId: string) => ipcRenderer.invoke('grafana:status', clusterId)
  },
  jira: {
    list: (clusterId: string) => ipcRenderer.invoke('jira:list', clusterId),
    create: (clusterId: string, input: CreateJiraIssueInput) =>
      ipcRenderer.invoke('jira:create', clusterId, input)
  },
  ssh: {
    connect: (clusterId: string) => ipcRenderer.invoke('ssh:connect', clusterId),
    write: (sessionId: string, data: string) => ipcRenderer.send('ssh:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('ssh:resize', sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.send('ssh:disconnect', sessionId),
    onData: (callback: (event: SshDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SshDataEvent): void =>
        callback(payload)
      ipcRenderer.on('ssh:data', listener)
      return () => ipcRenderer.removeListener('ssh:data', listener)
    },
    onClosed: (callback: (event: SshClosedEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SshClosedEvent): void =>
        callback(payload)
      ipcRenderer.on('ssh:closed', listener)
      return () => ipcRenderer.removeListener('ssh:closed', listener)
    },
    onError: (callback: (event: SshErrorEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SshErrorEvent): void =>
        callback(payload)
      ipcRenderer.on('ssh:error', listener)
      return () => ipcRenderer.removeListener('ssh:error', listener)
    }
  },
  reachability: {
    getAll: () => ipcRenderer.invoke('reachability:getAll'),
    onUpdate: (callback: (event: ClusterReachability) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ClusterReachability): void =>
        callback(payload)
      ipcRenderer.on('reachability:update', listener)
      return () => ipcRenderer.removeListener('reachability:update', listener)
    }
  },
  notifications: {
    list: () => ipcRenderer.invoke('notifications:list'),
    markRead: (id: string) => ipcRenderer.send('notifications:markRead', id),
    markAllRead: () => ipcRenderer.send('notifications:markAllRead'),
    onCreated: (callback: (notification: ClusterNotification) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ClusterNotification): void =>
        callback(payload)
      ipcRenderer.on('notifications:created', listener)
      return () => ipcRenderer.removeListener('notifications:created', listener)
    }
  },
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
        callback(maximized)
      ipcRenderer.on('window:maximized-changed', listener)
      return () => ipcRenderer.removeListener('window:maximized-changed', listener)
    }
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
