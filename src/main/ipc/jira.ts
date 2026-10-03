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
  tags: string[]
} {
  const cluster = getCluster(clusterId)
  if (!cluster?.jira) {
    throw new Error('This cluster has no Jira project configured.')
  }
  const { jiraApiToken } = getClusterSecrets(clusterId)
  if (!jiraApiToken) {
    throw new Error('No Jira API token is stored for this cluster.')
  }
  return { jira: cluster.jira, token: jiraApiToken, clusterName: cluster.name, tags: cluster.tags }
}

export function registerJiraIpcHandlers(): void {
  ipcMain.handle(
    'jira:list',
    async (_event, clusterId: string, filter?: JiraListFilter): Promise<JiraIssueSummary[]> => {
      const { jira, token, tags } = requireJiraContext(clusterId)
      return listJiraIssues(jira, token, tags, {
        text: typeof filter?.text === 'string' ? filter.text : undefined,
        openOnly: filter?.openOnly === true,
        assigned:
          filter?.assigned && typeof filter.assigned.kind === 'string'
            ? {
                kind: filter.assigned.kind,
                value: typeof filter.assigned.value === 'string' ? filter.assigned.value : undefined
              }
            : undefined
      })
    }
  )

  ipcMain.handle('jira:openCount', async (_event, clusterId: string): Promise<number> => {
    const { jira, token, tags } = requireJiraContext(clusterId)
    return countOpenJiraIssues(jira, token, tags)
  })

  ipcMain.handle(
    'jira:create',
    async (_event, clusterId: string, input: CreateJiraIssueInput): Promise<JiraIssueSummary> => {
      const { jira, token, clusterName, tags } = requireJiraContext(clusterId)
      return createJiraIssue(jira, token, input, clusterName, tags)
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
