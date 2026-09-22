import { ipcMain } from 'electron'
import { getCluster, getClusterSecrets, setGrafanaPanelSelection } from '../clusters'
import { getGrafanaStatus } from '../grafana/client'
import type { ClusterSummary, GrafanaStatusResult } from '../../shared/types'

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
}
