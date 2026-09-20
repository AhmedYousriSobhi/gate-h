import type { CreateJiraIssueInput, JiraIssueSummary, JiraProfile } from '../../shared/types'

// Talks to a cluster's Jira instance (Cloud or Data Center/Server) over its REST API. Uses the
// v2 endpoints deliberately: v3 requires issue descriptions in Atlassian Document Format, while
// v2 accepts a plain string and is still served by both Jira Cloud and Data Center, keeping one
// code path generic across both.

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildAuthHeader(profile: JiraProfile, token: string): string {
  if (profile.authMode === 'cloud') {
    if (!profile.email) throw new Error('Jira Cloud requires an account email for Basic auth.')
    return `Basic ${Buffer.from(`${profile.email}:${token}`).toString('base64')}`
  }
  return `Bearer ${token}`
}

async function jiraFetch(
  profile: JiraProfile,
  token: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(`${trimBaseUrl(profile.baseUrl)}${path}`, {
    ...init,
    headers: {
      Authorization: buildAuthHeader(profile, token),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Jira API error (HTTP ${res.status}): ${body.slice(0, 200)}`)
  }
  return res
}

interface JiraApiIssue {
  key: string
  fields: {
    summary: string
    status?: { name: string }
    issuetype?: { name: string }
    updated: string
  }
}

function toSummary(profile: JiraProfile, issue: JiraApiIssue): JiraIssueSummary {
  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? 'Unknown',
    issueType: issue.fields.issuetype?.name ?? 'Issue',
    updated: issue.fields.updated,
    url: `${trimBaseUrl(profile.baseUrl)}/browse/${issue.key}`
  }
}

export async function listJiraIssues(
  profile: JiraProfile,
  token: string
): Promise<JiraIssueSummary[]> {
  const jql =
    profile.jql?.trim() ||
    (profile.projectKey
      ? `project = "${profile.projectKey}" ORDER BY updated DESC`
      : 'ORDER BY updated DESC')

  const res = await jiraFetch(profile, token, '/rest/api/2/search', {
    method: 'POST',
    body: JSON.stringify({
      jql,
      maxResults: 25,
      fields: ['summary', 'status', 'issuetype', 'updated']
    })
  })
  const data = (await res.json()) as { issues: JiraApiIssue[] }
  return data.issues.map((issue) => toSummary(profile, issue))
}

export async function createJiraIssue(
  profile: JiraProfile,
  token: string,
  input: CreateJiraIssueInput
): Promise<JiraIssueSummary> {
  if (!profile.projectKey) {
    throw new Error('This cluster has no default Jira project key configured.')
  }

  const created = await jiraFetch(profile, token, '/rest/api/2/issue', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        project: { key: profile.projectKey },
        summary: input.summary,
        description: input.description ?? '',
        issuetype: { name: 'Task' }
      }
    })
  }).then((res) => res.json() as Promise<{ key: string }>)

  const issue = await jiraFetch(
    profile,
    token,
    `/rest/api/2/issue/${created.key}?fields=summary,status,issuetype,updated`
  ).then((res) => res.json() as Promise<JiraApiIssue>)

  return toSummary(profile, issue)
}
