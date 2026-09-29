import { randomUUID } from 'crypto'
import { getDb } from './db'
import { getActiveProfileId } from './profiles'
import type { JobTemplate, JobTemplateInput } from '../shared/types'

// Batch script templates, kept locally per profile - like clusters, a profile's templates belong
// to its context. Nothing here talks to a cluster; submitting is ./scheduler/submit.ts.

interface TemplateRow {
  id: string
  name: string
  body: string
  created_at: string
  updated_at: string
}

function toTemplate(row: TemplateRow): JobTemplate {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listTemplates(): JobTemplate[] {
  const rows = getDb()
    .prepare('SELECT * FROM job_templates WHERE profile_id = ? ORDER BY name COLLATE NOCASE')
    .all(getActiveProfileId()) as TemplateRow[]
  return rows.map(toTemplate)
}

export function saveTemplate(input: JobTemplateInput): JobTemplate {
  const name = input.name.trim()
  if (!name) throw new Error('A template needs a name.')
  const now = new Date().toISOString()
  const db = getDb()
  if (input.id) {
    const result = db
      .prepare(
        'UPDATE job_templates SET name = ?, body = ?, updated_at = ? WHERE id = ? AND profile_id = ?'
      )
      .run(name, input.body, now, input.id, getActiveProfileId())
    if (result.changes === 0) throw new Error('Template not found.')
    return toTemplate(
      db.prepare('SELECT * FROM job_templates WHERE id = ?').get(input.id) as TemplateRow
    )
  }
  const id = randomUUID()
  db.prepare(
    'INSERT INTO job_templates (id, profile_id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, getActiveProfileId(), name, input.body, now, now)
  return toTemplate(db.prepare('SELECT * FROM job_templates WHERE id = ?').get(id) as TemplateRow)
}

export function removeTemplate(id: string): void {
  getDb()
    .prepare('DELETE FROM job_templates WHERE id = ? AND profile_id = ?')
    .run(id, getActiveProfileId())
}
