import { ipcMain } from 'electron'
import { getCluster, getClusterSecrets } from '../clusters'
import { createJiraIssue, listJiraIssues } from '../jira/client'
import type { CreateJiraIssueInput, JiraIssueSummary, JiraProfile } from '../../shared/types'

function requireJiraContext(clusterId: string): { jira: JiraProfile; token: string } {
  const cluster = getCluster(clusterId)
  if (!cluster?.jira) {
    throw new Error('This cluster has no Jira project configured.')
  }
  const { jiraApiToken } = getClusterSecrets(clusterId)
  if (!jiraApiToken) {
    throw new Error('No Jira API token is stored for this cluster.')
  }
  return { jira: cluster.jira, token: jiraApiToken }
}

export function registerJiraIpcHandlers(): void {
  ipcMain.handle('jira:list', async (_event, clusterId: string): Promise<JiraIssueSummary[]> => {
    const { jira, token } = requireJiraContext(clusterId)
    return listJiraIssues(jira, token)
  })

  ipcMain.handle(
    'jira:create',
    async (_event, clusterId: string, input: CreateJiraIssueInput): Promise<JiraIssueSummary> => {
      const { jira, token } = requireJiraContext(clusterId)
      return createJiraIssue(jira, token, input)
    }
  )
}
