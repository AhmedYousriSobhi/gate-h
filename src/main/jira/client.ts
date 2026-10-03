import type {
  CreateJiraIssueInput,
  JiraIssueSummary,
  JiraListFilter,
  JiraProfile
} from '../../shared/types'
import { toClusterSlug } from '../../shared/clusterSlug'

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

/** The cluster's own scope, parenthesised so a user's `a OR b` can't swallow the clauses added
 *  after it, and without a trailing ORDER BY (each caller adds its own). Empty when unscoped. */
function baseJql(profile: JiraProfile, tags: string[] = []): string {
  const labels = [...new Set(tags.map(toClusterSlug))]
  const mentions = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  // An explicit JQL wins; otherwise the project key and the cluster's own tags narrow it. A tag
  // matches a ticket carrying it as a label or mentioning it, since existing tickets are rarely
  // labelled by hand.
  const tagClause = [
    labels.length ? `labels in (${labels.map((l) => `"${l}"`).join(', ')})` : '',
    ...mentions.map((t) => `text ~ "${t.replace(/[\\"]/g, '\\$&')}"`)
  ]
    .filter(Boolean)
    .join(' OR ')
  const derived = [
    profile.projectKey ? `project = "${profile.projectKey}"` : '',
    tagClause && `(${tagClause})`
  ]
    .filter(Boolean)
    .join(' AND ')
  const raw = profile.jql?.trim() || derived
  const scope = raw.replace(/\s+order\s+by\s.*$/i, '').trim()
  return scope ? `(${scope})` : ''
}

async function searchJiraIssues(
  profile: JiraProfile,
  token: string,
  jql: string
): Promise<JiraIssueSummary[]> {
  const body = JSON.stringify({
    jql,
    maxResults: 25,
    fields: ['summary', 'status', 'issuetype', 'updated']
  })
  // Jira Cloud removed /rest/api/2/search (HTTP 410); Server/Data Center only has the old one.
  let res: Response
  try {
    res = await jiraFetch(profile, token, '/rest/api/3/search/jql', { method: 'POST', body })
  } catch (err) {
    if (!(err instanceof Error) || !/HTTP (404|405)\b/.test(err.message)) throw err
    res = await jiraFetch(profile, token, '/rest/api/2/search', { method: 'POST', body })
  }
  const data = (await res.json()) as { issues: JiraApiIssue[] }
  return data.issues.map((issue) => toSummary(profile, issue))
}

export async function listJiraIssues(
  profile: JiraProfile,
  token: string,
  tags: string[],
  filter: JiraListFilter = {}
): Promise<JiraIssueSummary[]> {
  // The v3 search rejects a query with no restriction at all, so an unscoped profile gets a window.
  const clauses = [baseJql(profile, tags) || 'updated >= -90d']
  const text = filter.text?.trim()
  if (text) clauses.push(`text ~ "${text.replace(/[\\"]/g, '\\$&')}"`)
  if (filter.openOnly) clauses.push('resolution = Unresolved')
  return searchJiraIssues(profile, token, `${clauses.join(' AND ')} ORDER BY updated DESC`)
}

/** How many tickets in the cluster's own scope are still unresolved. Jira Cloud's approximate-count
 *  endpoint; Server/Data Center has none, so it falls back to the old search's `total`. */
export async function countOpenJiraIssues(
  profile: JiraProfile,
  token: string,
  tags: string[]
): Promise<number> {
  const scope = baseJql(profile, tags)
  // Without a project, tag or JQL this would count every ticket the account can see - not the cluster's.
  if (!scope) throw new Error('This cluster has no Jira project key, tags or JQL filter.')
  const jql = `${scope} AND resolution = Unresolved`
  try {
    const res = await jiraFetch(profile, token, '/rest/api/3/search/approximate-count', {
      method: 'POST',
      body: JSON.stringify({ jql })
    })
    return ((await res.json()) as { count: number }).count
  } catch (err) {
    if (!(err instanceof Error) || !/HTTP (404|405)\b/.test(err.message)) throw err
    const res = await jiraFetch(profile, token, '/rest/api/2/search', {
      method: 'POST',
      body: JSON.stringify({ jql, maxResults: 0 })
    })
    return ((await res.json()) as { total: number }).total
  }
}

/** Tickets mentioning a given compute node, scoped the same way as listJiraIssues (the cluster's
 *  own project/JQL filter) - see docs/JIRA_GUIDE.md section 4's "mentioning a specific compute
 *  node" recipe, which this automates instead of the user typing it in by hand. */
export async function searchJiraIssuesByNode(
  profile: JiraProfile,
  token: string,
  nodeName: string
): Promise<JiraIssueSummary[]> {
  const scope = baseJql(profile)
  const escaped = nodeName.replace(/"/g, '\\"')
  const jql = `${scope ? `${scope} AND ` : ''}text ~ "${escaped}" ORDER BY updated DESC`
  return searchJiraIssues(profile, token, jql)
}

export async function createJiraIssue(
  profile: JiraProfile,
  token: string,
  input: CreateJiraIssueInput,
  clusterName: string,
  tags: string[]
): Promise<JiraIssueSummary> {
  if (!profile.projectKey) {
    throw new Error('This cluster has no default Jira project key configured.')
  }

  const baseFields = {
    project: { key: profile.projectKey },
    summary: input.summary,
    description: input.description ?? '',
    issuetype: { name: 'Task' }
  }

  // Best-effort: tag the ticket with the cluster's own identity (see docs/JIRA_GUIDE.md) so it
  // shows up under a JQL filter like `labels = "<cluster>"` without the user tagging it by hand.
  // Falls back to creating without a label if this Jira project's create screen doesn't have a
  // Labels field configured, rather than failing the whole ticket creation over a nice-to-have.
  const createIssue = (fields: Record<string, unknown>): Promise<{ key: string }> =>
    jiraFetch(profile, token, '/rest/api/2/issue', {
      method: 'POST',
      body: JSON.stringify({ fields })
    }).then((res) => res.json() as Promise<{ key: string }>)

  let created: { key: string }
  try {
    created = await createIssue({
      ...baseFields,
      labels: [...new Set([clusterName, ...tags].map(toClusterSlug))]
    })
  } catch {
    created = await createIssue(baseFields)
  }

  const issue = await jiraFetch(
    profile,
    token,
    `/rest/api/2/issue/${created.key}?fields=summary,status,issuetype,updated`
  ).then((res) => res.json() as Promise<JiraApiIssue>)

  return toSummary(profile, issue)
}
