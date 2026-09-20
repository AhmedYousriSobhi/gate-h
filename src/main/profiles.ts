import { randomUUID } from 'crypto'
import { getDb } from './db'
import type { Profile } from '../shared/types'

interface ProfileRow {
  id: string
  name: string
  created_at: string
  updated_at: string
}

function rowToProfile(row: ProfileRow): Profile {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function listProfiles(): Profile[] {
  const rows = getDb()
    .prepare('SELECT * FROM profiles ORDER BY created_at ASC')
    .all() as ProfileRow[]
  return rows.map(rowToProfile)
}

export function createProfile(name: string): Profile {
  const id = randomUUID()
  const now = new Date().toISOString()
  getDb()
    .prepare('INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now)
  return { id, name, createdAt: now, updatedAt: now }
}

export function renameProfile(id: string, name: string): Profile {
  const now = new Date().toISOString()
  getDb().prepare('UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id)
  const row = getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow
  return rowToProfile(row)
}

/** Deletes a profile and every cluster that belongs to it. The caller (IPC handler) is
 *  responsible for getting the user's confirmation first - `countClustersInProfile` is there so
 *  the renderer can show "this will also remove N clusters" before asking. Refuses to delete the
 *  last remaining profile, and reassigns the active profile if it was the one just removed. */
export function removeProfile(id: string): void {
  const db = getDb()
  const remaining = (
    db.prepare('SELECT COUNT(*) as count FROM profiles').get() as { count: number }
  ).count
  if (remaining <= 1) {
    throw new Error('Cannot delete the last remaining profile.')
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM clusters WHERE profile_id = ?').run(id)
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id)

    if (getActiveProfileId() === id) {
      const fallback = db
        .prepare('SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1')
        .get() as { id: string }
      setActiveProfileId(fallback.id)
    }
  })
  transaction()
}

export function countClustersInProfile(id: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM clusters WHERE profile_id = ?')
    .get(id) as { count: number }
  return row.count
}

export function getActiveProfileId(): string {
  const row = getDb()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('activeProfileId') as { value: string } | undefined
  if (!row) {
    // Should never happen post-migration, but fall back to the oldest profile rather than throw.
    const fallback = getDb()
      .prepare('SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1')
      .get() as {
      id: string
    }
    return fallback.id
  }
  return row.value
}

export function setActiveProfileId(id: string): void {
  getDb()
    .prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run('activeProfileId', id)
}
