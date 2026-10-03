import { ipcMain } from './guard'
import { getCluster, getClusterSecrets } from '../clusters'
import {
  countOpenJiraIssues,
  createJiraIssue,
  listJiraIssues,
  searchJiraIssuesByNode
} from '../jira/client'
import type {
  CreateJiraIssueInput,
  JiraIssueSummary,
  JiraListFilter,
  JiraProfile
} from '../../shared/types'

function requireJiraContext(clusterId: string): {
  jira: JiraProfile
  token: string
  clusterName: string
} {
  const cluster = getCluster(clusterId)
  if (!cluster?.jira) {
    throw new Error('This cluster has no Jira project configured.')
  }
  const { jiraApiToken } = getClusterSecrets(clusterId)
  if (!jiraApiToken) {
    throw new Error('No Jira API token is stored for this cluster.')
  }
  return { jira: cluster.jira, token: jiraApiToken, clusterName: cluster.name }
}

export function registerJiraIpcHandlers(): void {
  ipcMain.handle(
    'jira:list',
    async (_event, clusterId: string, filter?: JiraListFilter): Promise<JiraIssueSummary[]> => {
      const { jira, token } = requireJiraContext(clusterId)
      return listJiraIssues(jira, token, {
        text: typeof filter?.text === 'string' ? filter.text : undefined,
        openOnly: filter?.openOnly === true
      })
    }
  )

  ipcMain.handle('jira:openCount', async (_event, clusterId: string): Promise<number> => {
    const { jira, token } = requireJiraContext(clusterId)
    return countOpenJiraIssues(jira, token)
  })

  ipcMain.handle(
    'jira:create',
    async (_event, clusterId: string, input: CreateJiraIssueInput): Promise<JiraIssueSummary> => {
      const { jira, token, clusterName } = requireJiraContext(clusterId)
      return createJiraIssue(jira, token, input, clusterName)
    }
  )

  ipcMain.handle(
    'jira:searchNode',
    async (_event, clusterId: string, nodeName: string): Promise<JiraIssueSummary[]> => {
      const { jira, token } = requireJiraContext(clusterId)
      return searchJiraIssuesByNode(jira, token, nodeName)
    }
  )
}
