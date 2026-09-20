import { randomUUID } from 'crypto'
import { getDb } from './db'
import { decryptSecret, encryptSecret } from './secrets'
import type {
  Cluster,
  ClusterInput,
  ClusterSummary,
  ConnectionProfile,
  GrafanaProfile,
  JiraProfile
} from '../shared/types'

interface ClusterRow {
  id: string
  name: string
  description: string
  tags: string
  connection: string
  connection_secret: string | null
  grafana: string | null
  grafana_token: string | null
  jira: string | null
  jira_token: string | null
  created_at: string
  updated_at: string
}

function rowToSummary(row: ClusterRow): ClusterSummary {
  const cluster: Cluster = {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    connection: JSON.parse(row.connection) as ConnectionProfile,
    grafana: row.grafana ? (JSON.parse(row.grafana) as GrafanaProfile) : null,
    jira: row.jira ? (JSON.parse(row.jira) as JiraProfile) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  return {
    ...cluster,
    hasConnectionSecret: Boolean(row.connection_secret),
    hasGrafanaToken: Boolean(row.grafana_token),
    hasJiraToken: Boolean(row.jira_token)
  }
}

export function listClusters(): ClusterSummary[] {
  const rows = getDb()
    .prepare('SELECT * FROM clusters ORDER BY name COLLATE NOCASE')
    .all() as ClusterRow[]
  return rows.map(rowToSummary)
}

export function getCluster(id: string): ClusterSummary | null {
  const row = getDb().prepare('SELECT * FROM clusters WHERE id = ?').get(id) as
    ClusterRow | undefined
  return row ? rowToSummary(row) : null
}

/** Encrypts a plaintext secret, or returns the previous encrypted value when none was submitted
 *  (so editing a cluster without retyping its password/token doesn't wipe it). */
function resolveSecret(
  plainText: string | undefined,
  previousEncrypted: string | null
): string | null {
  if (plainText) return encryptSecret(plainText)
  return previousEncrypted
}

export function createCluster(input: ClusterInput): ClusterSummary {
  const id = randomUUID()
  const now = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO clusters
        (id, name, description, tags, connection, connection_secret, grafana, grafana_token, jira, jira_token, created_at, updated_at)
       VALUES (@id, @name, @description, @tags, @connection, @connection_secret, @grafana, @grafana_token, @jira, @jira_token, @created_at, @updated_at)`
    )
    .run({
      id,
      name: input.name,
      description: input.description,
      tags: JSON.stringify(input.tags),
      connection: JSON.stringify(input.connection),
      connection_secret: input.connectionSecret ? encryptSecret(input.connectionSecret) : null,
      grafana: input.grafana ? JSON.stringify(input.grafana) : null,
      grafana_token: input.grafanaApiToken ? encryptSecret(input.grafanaApiToken) : null,
      jira: input.jira ? JSON.stringify(input.jira) : null,
      jira_token: input.jiraApiToken ? encryptSecret(input.jiraApiToken) : null,
      created_at: now,
      updated_at: now
    })

  return getCluster(id) as ClusterSummary
}

export function updateCluster(id: string, input: ClusterInput): ClusterSummary {
  const existing = getDb().prepare('SELECT * FROM clusters WHERE id = ?').get(id) as
    ClusterRow | undefined
  if (!existing) {
    throw new Error(`Cluster ${id} not found`)
  }

  getDb()
    .prepare(
      `UPDATE clusters SET
        name = @name,
        description = @description,
        tags = @tags,
        connection = @connection,
        connection_secret = @connection_secret,
        grafana = @grafana,
        grafana_token = @grafana_token,
        jira = @jira,
        jira_token = @jira_token,
        updated_at = @updated_at
       WHERE id = @id`
    )
    .run({
      id,
      name: input.name,
      description: input.description,
      tags: JSON.stringify(input.tags),
      connection: JSON.stringify(input.connection),
      connection_secret: resolveSecret(input.connectionSecret, existing.connection_secret),
      grafana: input.grafana ? JSON.stringify(input.grafana) : null,
      grafana_token: input.grafana
        ? resolveSecret(input.grafanaApiToken, existing.grafana_token)
        : null,
      jira: input.jira ? JSON.stringify(input.jira) : null,
      jira_token: input.jira ? resolveSecret(input.jiraApiToken, existing.jira_token) : null,
      updated_at: new Date().toISOString()
    })

  return getCluster(id) as ClusterSummary
}

export function removeCluster(id: string): void {
  getDb().prepare('DELETE FROM clusters WHERE id = ?').run(id)
}

/** Decrypts a cluster's stored secrets for internal use (e.g. opening an SSH connection).
 *  Never expose the return value of this function to the renderer. */
export function getClusterSecrets(id: string): {
  connectionSecret: string | null
  grafanaApiToken: string | null
  jiraApiToken: string | null
} {
  const row = getDb().prepare('SELECT * FROM clusters WHERE id = ?').get(id) as
    ClusterRow | undefined
  if (!row) throw new Error(`Cluster ${id} not found`)
  return {
    connectionSecret: row.connection_secret ? decryptSecret(row.connection_secret) : null,
    grafanaApiToken: row.grafana_token ? decryptSecret(row.grafana_token) : null,
    jiraApiToken: row.jira_token ? decryptSecret(row.jira_token) : null
  }
}
