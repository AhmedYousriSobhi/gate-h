import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { DB_FILE_NAME } from './userData'

let db: Database.Database | null = null

function columnExists(database: Database.Database, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((c) => c.name === column)
}

/** Migrates a database created before profiles existed: every cluster needs a `profile_id`, at
 *  least one profile must exist, and `app_settings.activeProfileId` must point at a real one.
 *  Safe to run on every launch - each step is a no-op once already applied. */
function migrateToProfiles(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  if (!columnExists(database, 'clusters', 'profile_id')) {
    database.exec('ALTER TABLE clusters ADD COLUMN profile_id TEXT')
  }

  const profileCount = (
    database.prepare('SELECT COUNT(*) as count FROM profiles').get() as { count: number }
  ).count

  let defaultProfileId: string
  if (profileCount === 0) {
    defaultProfileId = randomUUID()
    const now = new Date().toISOString()
    database
      .prepare('INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(defaultProfileId, 'Personal', now, now)
  } else {
    defaultProfileId = (
      database.prepare('SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1').get() as {
        id: string
      }
    ).id
  }

  database
    .prepare('UPDATE clusters SET profile_id = ? WHERE profile_id IS NULL')
    .run(defaultProfileId)

  const activeSetting = database
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('activeProfileId') as { value: string } | undefined
  const activeStillExists =
    activeSetting &&
    database.prepare('SELECT 1 FROM profiles WHERE id = ?').get(activeSetting.value)

  if (!activeStillExists) {
    database
      .prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run('activeProfileId', defaultProfileId)
  }
}

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), DB_FILE_NAME)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS clusters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      connection TEXT NOT NULL,
      connection_secret TEXT,
      grafana TEXT,
      grafana_token TEXT,
      jira TEXT,
      jira_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  migrateToProfiles(db)

  // No longer read - the per-cluster pin it backed was removed once every opened cluster stayed
  // connected in the background - but migrations are additive-only, so the column stays.
  if (!columnExists(db, 'clusters', 'keep_alive')) {
    db.exec('ALTER TABLE clusters ADD COLUMN keep_alive INTEGER NOT NULL DEFAULT 0')
  }

  // Defaults to 1 (active), unlike keep_alive above - an existing cluster should keep connecting
  // exactly as it did before this column existed, not silently go into standby.
  if (!columnExists(db, 'clusters', 'active_monitoring')) {
    db.exec('ALTER TABLE clusters ADD COLUMN active_monitoring INTEGER NOT NULL DEFAULT 1')
  }

  if (!columnExists(db, 'clusters', 'azure_tunnel')) {
    db.exec('ALTER TABLE clusters ADD COLUMN azure_tunnel TEXT')
  }

  if (!columnExists(db, 'clusters', 'teleport')) {
    db.exec('ALTER TABLE clusters ADD COLUMN teleport TEXT')
  }

  if (!columnExists(db, 'clusters', 'scheduler')) {
    db.exec('ALTER TABLE clusters ADD COLUMN scheduler TEXT')
  }

  if (!columnExists(db, 'clusters', 'storage')) {
    db.exec('ALTER TABLE clusters ADD COLUMN storage TEXT')
  }

  if (!columnExists(db, 'clusters', 'jump_host_secret')) {
    db.exec('ALTER TABLE clusters ADD COLUMN jump_host_secret TEXT')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS job_templates (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS known_hosts (
      host_port TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `)

  return db
}
