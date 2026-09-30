import { randomUUID } from 'crypto'
import { getDb } from './db'
import { getActiveProfileId } from './profiles'
import type { Snippet, SnippetInput } from '../shared/types'

// Saved shell commands, kept locally per profile - like job templates, a profile's snippets
// belong to its context. Inserted directly into a terminal's active session; nothing here talks
// to a cluster.

interface SnippetRow {
  id: string
  name: string
  body: string
  created_at: string
  updated_at: string
}

function toSnippet(row: SnippetRow): Snippet {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listSnippets(): Snippet[] {
  const rows = getDb()
    .prepare('SELECT * FROM snippets WHERE profile_id = ? ORDER BY name COLLATE NOCASE')
    .all(getActiveProfileId()) as SnippetRow[]
  return rows.map(toSnippet)
}

export function saveSnippet(input: SnippetInput): Snippet {
  const name = input.name.trim()
  if (!name) throw new Error('A snippet needs a name.')
  const now = new Date().toISOString()
  const db = getDb()
  if (input.id) {
    const result = db
      .prepare(
        'UPDATE snippets SET name = ?, body = ?, updated_at = ? WHERE id = ? AND profile_id = ?'
      )
      .run(name, input.body, now, input.id, getActiveProfileId())
    if (result.changes === 0) throw new Error('Snippet not found.')
    return toSnippet(db.prepare('SELECT * FROM snippets WHERE id = ?').get(input.id) as SnippetRow)
  }
  const id = randomUUID()
  db.prepare(
    'INSERT INTO snippets (id, profile_id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, getActiveProfileId(), name, input.body, now, now)
  return toSnippet(db.prepare('SELECT * FROM snippets WHERE id = ?').get(id) as SnippetRow)
}

export function removeSnippet(id: string): void {
  getDb()
    .prepare('DELETE FROM snippets WHERE id = ? AND profile_id = ?')
    .run(id, getActiveProfileId())
}
