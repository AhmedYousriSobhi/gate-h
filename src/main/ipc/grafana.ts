import { ipcMain } from 'electron'
import { getCluster, getClusterSecrets } from '../clusters'
import { getGrafanaStatus } from '../grafana/client'
import type { GrafanaStatusResult } from '../../shared/types'

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
}
