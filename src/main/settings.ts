import { getDb } from './db'
import {
  ALL_STATUS_WIDGET_TYPES,
  ALL_WIDGET_TYPES,
  DEFAULT_OVERVIEW_VIEW_MODE,
  DEFAULT_PANEL_LAYOUT,
  DEFAULT_STATUS_LAYOUT,
  type OverviewViewMode,
  type PanelLayout,
  type StatusLayout
} from '../shared/types'

// Generic key/value storage backed by the `app_settings` table (created in db.ts's profiles
// migration) - profiles.ts's active-profile-id and the panel layout below both live here rather
// than each rolling their own table.

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

const PANEL_LAYOUT_KEY = 'panelLayout'

function isValidPanelLayout(value: unknown): value is PanelLayout {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PanelLayout>
  return (
    Array.isArray(candidate.visible) &&
    candidate.visible.every((w) => (ALL_WIDGET_TYPES as string[]).includes(w)) &&
    (candidate.orientation === 'horizontal' || candidate.orientation === 'vertical') &&
    (candidate.splitRatio === undefined ||
      (typeof candidate.splitRatio === 'number' &&
        candidate.splitRatio >= 0.15 &&
        candidate.splitRatio <= 0.85))
  )
}

/** Falls back to the default layout if nothing was saved yet, or the saved JSON doesn't parse or
 *  no longer matches the shape (e.g. a widget type that existed in an older version was removed) -
 *  a corrupt or stale setting should never be able to break the panel, just reset it. */
export function getPanelLayout(): PanelLayout {
  const raw = getSetting(PANEL_LAYOUT_KEY)
  if (!raw) return DEFAULT_PANEL_LAYOUT
  try {
    const parsed = JSON.parse(raw)
    return isValidPanelLayout(parsed) ? parsed : DEFAULT_PANEL_LAYOUT
  } catch {
    return DEFAULT_PANEL_LAYOUT
  }
}

export function setPanelLayout(layout: PanelLayout): void {
  setSetting(PANEL_LAYOUT_KEY, JSON.stringify(layout))
}

const OVERVIEW_VIEW_MODE_KEY = 'overviewViewMode'

/** Falls back to the default (cards) if nothing was saved yet or the value is stale/corrupt -
 *  same reasoning as getPanelLayout above. */
export function getOverviewViewMode(): OverviewViewMode {
  const raw = getSetting(OVERVIEW_VIEW_MODE_KEY)
  return raw === 'cards' || raw === 'table' ? raw : DEFAULT_OVERVIEW_VIEW_MODE
}

export function setOverviewViewMode(mode: OverviewViewMode): void {
  setSetting(OVERVIEW_VIEW_MODE_KEY, mode)
}

const STATUS_LAYOUT_KEY = 'statusLayout'

function isValidStatusLayout(value: unknown): value is StatusLayout {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StatusLayout>
  return (
    Array.isArray(candidate.visible) &&
    candidate.visible.every((w) => (ALL_STATUS_WIDGET_TYPES as string[]).includes(w))
  )
}

/** Falls back to the default (every section shown) if nothing was saved yet, or the saved JSON
 *  doesn't parse or no longer matches the shape - same reasoning as getPanelLayout above. */
export function getStatusLayout(): StatusLayout {
  const raw = getSetting(STATUS_LAYOUT_KEY)
  if (!raw) return DEFAULT_STATUS_LAYOUT
  try {
    const parsed = JSON.parse(raw)
    return isValidStatusLayout(parsed) ? parsed : DEFAULT_STATUS_LAYOUT
  } catch {
    return DEFAULT_STATUS_LAYOUT
  }
}

export function setStatusLayout(layout: StatusLayout): void {
  setSetting(STATUS_LAYOUT_KEY, JSON.stringify(layout))
}
