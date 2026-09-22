import { ipcMain } from 'electron'
import {
  getCluster,
  getClusterSecrets,
  setGrafanaDashboardOrientation,
  setGrafanaPanelEmbedHeight,
  setGrafanaPanelSelection,
  setGrafanaPanelWidths
} from '../clusters'
import { getGrafanaStatus } from '../grafana/client'
import { registerEmbedOrigin } from '../grafana/embed'
import type { ClusterSummary, GrafanaStatusResult, PanelOrientation } from '../../shared/types'

export function registerGrafanaIpcHandlers(): void {
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
      widths: number[]
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
