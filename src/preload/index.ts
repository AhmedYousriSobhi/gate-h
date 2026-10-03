import { contextBridge, ipcRenderer } from 'electron'
import type {
  AzureTunnelStatusEvent,
  ClusterInput,
  ClusterNotification,
  ClusterOrder,
  ClusterReachability,
  CreateJiraIssueInput,
  FileTransferEvent,
  GateHApi,
  JobTemplateInput,
  SnippetInput,
  OverviewViewMode,
  PanelLayout,
  PanelOrientation,
  SchedulerSnapshot,
  SshClosedEvent,
  SshDataEvent,
  SshErrorEvent,
  StatusLayout,
  TeleportSessionInfo
} from '../shared/types'

// Custom APIs for renderer - a narrow, explicit surface over IPC. The renderer never gets
// direct Node/Electron access, and secrets never travel back across this bridge.
const api: GateHApi = {
  platform: process.platform,
  clusters: {
    list: () => ipcRenderer.invoke('clusters:list'),
    get: (id: string) => ipcRenderer.invoke('clusters:get', id),
    create: (input: ClusterInput) => ipcRenderer.invoke('clusters:create', input),
    update: (id: string, input: ClusterInput) => ipcRenderer.invoke('clusters:update', id, input),
    remove: (id: string) => ipcRenderer.invoke('clusters:remove', id),
    setActiveMonitoring: (id: string, active: boolean) =>
      ipcRenderer.invoke('clusters:setActiveMonitoring', id, active),
    importFromSshConfig: () => ipcRenderer.invoke('clusters:importFromSshConfig')
  },
  grafana: {
    getStatus: (clusterId: string) => ipcRenderer.invoke('grafana:status', clusterId),
    setPanelSelection: (clusterId: string, dashboardUid: string, panelIds: number[]) =>
      ipcRenderer.invoke('grafana:setPanelSelection', clusterId, dashboardUid, panelIds),
    setDashboardOrientation: (
      clusterId: string,
      dashboardUid: string,
      orientation: PanelOrientation
    ) =>
      ipcRenderer.invoke('grafana:setDashboardOrientation', clusterId, dashboardUid, orientation),
    setPanelEmbedHeight: (clusterId: string, dashboardUid: string, height: number) =>
      ipcRenderer.invoke('grafana:setPanelEmbedHeight', clusterId, dashboardUid, height),
    setPanelWidths: (clusterId: string, dashboardUid: string, widths: Record<number, number>) =>
      ipcRenderer.invoke('grafana:setPanelWidths', clusterId, dashboardUid, widths),
    prepareEmbed: (clusterId: string) => ipcRenderer.invoke('grafana:prepareEmbed', clusterId),
    gpuUsage: (clusterId: string, nodelists: string[]) =>
      ipcRenderer.invoke('grafana:gpuUsage', clusterId, nodelists)
  },
  jira: {
    list: (clusterId: string) => ipcRenderer.invoke('jira:list', clusterId),
    create: (clusterId: string, input: CreateJiraIssueInput) =>
      ipcRenderer.invoke('jira:create', clusterId, input),
    searchNode: (clusterId: string, nodeName: string) =>
      ipcRenderer.invoke('jira:searchNode', clusterId, nodeName)
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
  teleport: {
    sessions: () => ipcRenderer.invoke('teleport:sessions'),
    onSessions: (callback: (sessions: Record<string, TeleportSessionInfo>) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: Record<string, TeleportSessionInfo>
      ): void => callback(payload)
      ipcRenderer.on('teleport:sessions', listener)
      return () => ipcRenderer.removeListener('teleport:sessions', listener)
    },
    login: (clusterId: string, options: { renew: boolean }) =>
      ipcRenderer.invoke('teleport:login', clusterId, options)
  },
  scheduler: {
    getCached: () => ipcRenderer.invoke('scheduler:getCached'),
    watch: (clusterId: string) => ipcRenderer.send('scheduler:watch', clusterId),
    unwatch: (clusterId: string) => ipcRenderer.send('scheduler:unwatch', clusterId),
    refresh: (clusterId: string) => ipcRenderer.send('scheduler:refresh', clusterId),
    onSnapshot: (callback: (snapshot: SchedulerSnapshot) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SchedulerSnapshot): void =>
        callback(payload)
      ipcRenderer.on('scheduler:snapshot', listener)
      return () => ipcRenderer.removeListener('scheduler:snapshot', listener)
    },
    arrayTasks: (clusterId: string, arrayJobId: string) =>
      ipcRenderer.invoke('scheduler:arrayTasks', clusterId, arrayJobId),
    history: (clusterId: string, days: number) =>
      ipcRenderer.invoke('scheduler:history', clusterId, days),
    submit: (clusterId: string, script: string, label: string) =>
      ipcRenderer.invoke('scheduler:submit', clusterId, script, label),
    cancel: (clusterId: string, jobId: string) =>
      ipcRenderer.invoke('scheduler:cancel', clusterId, jobId),
    sampleGpus: (clusterId: string, jobId: string, nodes: number) =>
      ipcRenderer.invoke('scheduler:sampleGpus', clusterId, jobId, nodes)
  },
  files: {
    list: (clusterId: string, path?: string) => ipcRenderer.invoke('files:list', clusterId, path),
    download: (clusterId: string, remotePath: string) =>
      ipcRenderer.invoke('files:download', clusterId, remotePath),
    upload: (clusterId: string, remoteDir: string) =>
      ipcRenderer.invoke('files:upload', clusterId, remoteDir),
    onTransfer: (callback: (event: FileTransferEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: FileTransferEvent): void =>
        callback(payload)
      ipcRenderer.on('files:transfer', listener)
      return () => ipcRenderer.removeListener('files:transfer', listener)
    }
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (input: JobTemplateInput) => ipcRenderer.invoke('templates:save', input),
    remove: (id: string) => ipcRenderer.invoke('templates:remove', id)
  },
  snippets: {
    list: () => ipcRenderer.invoke('snippets:list'),
    save: (input: SnippetInput) => ipcRenderer.invoke('snippets:save', input),
    remove: (id: string) => ipcRenderer.invoke('snippets:remove', id)
  },
  storage: {
    usage: (clusterId: string) => ipcRenderer.invoke('storage:usage', clusterId)
  },
  azure: {
    listSubscriptions: () => ipcRenderer.invoke('azure:listSubscriptions'),
    findVm: (vmName: string) => ipcRenderer.invoke('azure:findVm', vmName),
    verifyTunnel: (clusterId: string) => ipcRenderer.invoke('azure:verifyTunnel', clusterId),
    checkAuth: (clusterId: string) => ipcRenderer.invoke('azure:checkAuth', clusterId),
    login: (clusterId: string, deviceCode?: boolean) =>
      ipcRenderer.invoke('azure:login', clusterId, deviceCode),
    clearAuth: (clusterId: string) => ipcRenderer.invoke('azure:clearAuth', clusterId),
    onStatus: (callback: (event: AzureTunnelStatusEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AzureTunnelStatusEvent): void =>
        callback(payload)
      ipcRenderer.on('azure:status', listener)
      return () => ipcRenderer.removeListener('azure:status', listener)
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
    delete: (id: string) => ipcRenderer.send('notifications:delete', id),
    clearAll: () => ipcRenderer.send('notifications:clearAll'),
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
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    getActiveId: () => ipcRenderer.invoke('profiles:getActiveId'),
    setActiveId: (id: string) => ipcRenderer.send('profiles:setActiveId', id),
    create: (name: string) => ipcRenderer.invoke('profiles:create', name),
    rename: (id: string, name: string) => ipcRenderer.invoke('profiles:rename', id, name),
    remove: (id: string) => ipcRenderer.invoke('profiles:remove', id),
    countClusters: (id: string) => ipcRenderer.invoke('profiles:countClusters', id)
  },
  layout: {
    get: () => ipcRenderer.invoke('layout:get'),
    set: (layout: PanelLayout) => ipcRenderer.send('layout:set', layout)
  },
  overview: {
    getViewMode: () => ipcRenderer.invoke('overview:getViewMode'),
    setViewMode: (mode: OverviewViewMode) => ipcRenderer.send('overview:setViewMode', mode)
  },
  statusLayout: {
    get: () => ipcRenderer.invoke('statusLayout:get'),
    set: (layout: StatusLayout) => ipcRenderer.send('statusLayout:set', layout)
  },
  sidebarWidth: {
    get: () => ipcRenderer.invoke('sidebarWidth:get'),
    set: (width: number) => ipcRenderer.send('sidebarWidth:set', width)
  },
  clusterOrder: {
    get: () => ipcRenderer.invoke('clusterOrder:get'),
    set: (order: ClusterOrder) => ipcRenderer.send('clusterOrder:set', order)
  }
}

// Only `window.api` is exposed - never the toolkit's `electronAPI`, whose raw `ipcRenderer` would let
// the renderer call any IPC channel, and whose import is not loadable from a sandboxed preload.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
