import { ipcMain } from './guard'
import {
  getCluster,
  getClusterSecrets,
  setGrafanaDashboardOrientation,
  setGrafanaPanelEmbedHeight,
  setGrafanaPanelSelection,
  setGrafanaPanelWidths
} from '../clusters'
import { getGrafanaStatus } from '../grafana/client'
import { getGpuUsage } from '../grafana/gpu'
import { expandHostlist, MAX_GPU_HOSTS, NODE_NAME_PATTERN } from '../scheduler/gpu'
import { registerEmbedOrigin } from '../grafana/embed'
import {
  PROMETHEUS_LABEL_PATTERN,
  type ClusterSummary,
  type GpuSample,
  type GrafanaStatusResult,
  type PanelOrientation
} from '../../shared/types'

export function registerGrafanaIpcHandlers(): void {
  ipcMain.handle(
    'grafana:gpuUsage',
    async (_event, clusterId: string, nodelists: string[]): Promise<GpuSample[]> => {
      const grafana = getCluster(clusterId)?.grafana
      if (!grafana?.gpuDatasourceUid) throw new Error('No GPU metrics datasource configured.')
      if (grafana.gpuHostLabel && !PROMETHEUS_LABEL_PATTERN.test(grafana.gpuHostLabel)) {
        throw new Error(`Invalid GPU host label: ${grafana.gpuHostLabel}`)
      }
      const { grafanaApiToken } = getClusterSecrets(clusterId)
      if (!grafanaApiToken) throw new Error('No Grafana API token is stored for this cluster.')
      const hosts = [...new Set(nodelists.flatMap((list) => expandHostlist(String(list))))]
        .filter((host) => NODE_NAME_PATTERN.test(host))
        .slice(0, MAX_GPU_HOSTS)
      if (hosts.length === 0) return []
      return getGpuUsage(grafana, grafanaApiToken, hosts)
    }
  )

  ipcMain.handle(
    'grafana:status',
    async (_event, clusterId: string): Promise<GrafanaStatusResult> => {
      const cluster = getCluster(clusterId)
      if (!cluster?.grafana) {
        throw new Error('This cluster has no Grafana instance configured.')
      }
      const { grafanaApiToken } = getClusterSecrets(clusterId)
      if (!grafanaApiToken) {
        throw new Error('No Grafana API token is stored for this cluster.')
      }
      return getGrafanaStatus(cluster.grafana, grafanaApiToken)
    }
  )

  ipcMain.handle(
    'grafana:setPanelSelection',
    async (
      _event,
      clusterId: string,
      dashboardUid: string,
      panelIds: number[]
    ): Promise<ClusterSummary> => {
      return setGrafanaPanelSelection(clusterId, dashboardUid, panelIds)
    }
  )

  ipcMain.handle(
    'grafana:setDashboardOrientation',
    async (
      _event,
      clusterId: string,
      dashboardUid: string,
      orientation: PanelOrientation
    ): Promise<ClusterSummary> => {
      return setGrafanaDashboardOrientation(clusterId, dashboardUid, orientation)
    }
  )

  ipcMain.handle(
    'grafana:setPanelEmbedHeight',
    async (
      _event,
      clusterId: string,
      dashboardUid: string,
      height: number
    ): Promise<ClusterSummary> => {
      return setGrafanaPanelEmbedHeight(clusterId, dashboardUid, height)
    }
  )

  ipcMain.handle(
    'grafana:setPanelWidths',
    async (
      _event,
      clusterId: string,
      dashboardUid: string,
      widths: Record<number, number>
    ): Promise<ClusterSummary> => {
      return setGrafanaPanelWidths(clusterId, dashboardUid, widths)
    }
  )

  ipcMain.handle('grafana:prepareEmbed', async (_event, clusterId: string): Promise<void> => {
    const cluster = getCluster(clusterId)
    if (!cluster?.grafana) {
      throw new Error('This cluster has no Grafana instance configured.')
    }
    const { grafanaApiToken } = getClusterSecrets(clusterId)
    if (!grafanaApiToken) {
      throw new Error('No Grafana API token is stored for this cluster.')
    }
    registerEmbedOrigin(cluster.grafana.baseUrl, grafanaApiToken)
  })
}
