import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, renameSync } from 'fs'

// The app was originally named "H-Gate" (package.json name: "hgate"), which Electron used to
// derive the userData directory (~/.config/hgate on Linux) before this was ever set explicitly.
// Renaming to "Gate-H" must not silently orphan a user's already-saved clusters, so userData is
// now pinned to an explicit, name-independent path, and any pre-existing legacy directory/db is
// migrated into it the first time the renamed app runs.
const CURRENT_DIR_NAME = 'gate-h'
const LEGACY_DIR_NAME = 'hgate'
export const DB_FILE_NAME = 'gate-h.sqlite3'
const LEGACY_DB_FILE_NAME = 'hgate.sqlite3'

export function initUserDataDir(): void {
  const base = app.getPath('appData')
  const currentDir = join(base, CURRENT_DIR_NAME)
  const legacyDir = join(base, LEGACY_DIR_NAME)

  app.setPath('userData', currentDir)

  if (!existsSync(currentDir)) {
    mkdirSync(currentDir, { recursive: true })
  }

  const currentDbPath = join(currentDir, DB_FILE_NAME)
  const legacyDbPath = join(legacyDir, LEGACY_DB_FILE_NAME)
  if (!existsSync(currentDbPath) && existsSync(legacyDbPath)) {
    renameSync(legacyDbPath, currentDbPath)
  }
}
