// UI preferences: layout/display choices (panel split, status-section visibility, sidebar
// width, cluster display order) - separate from cluster identity/configuration in ./cluster.ts.
// Persisted the same way (see src/main/settings.ts) but conceptually distinct: these describe
// how the app is arranged, not what a cluster is.

// The widgets a cluster's main panel can show side by side (see
// src/renderer/src/features/shell/panelLayout.ts for the renderer-side helpers built on this).
// Shared rather than renderer-only because the main process persists and validates it too.
export type WidgetType = 'terminal' | 'status'
export const ALL_WIDGET_TYPES: WidgetType[] = ['terminal', 'status']

export type PanelOrientation = 'horizontal' | 'vertical'

export interface PanelLayout {
  visible: WidgetType[]
  orientation: PanelOrientation
  /** Fraction (0.15-0.85) of the split's main-axis space given to the first visible pane (in
   *  `visible` order, i.e. after any swap). Optional so layouts saved before this field existed
   *  still parse - readers default to 0.5 when absent. */
  splitRatio?: number
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  visible: ['terminal', 'status'],
  orientation: 'horizontal',
  splitRatio: 0.5
}

/** The Overview dashboard's layout: a card per cluster (the default), or a dense table row per
 *  cluster for a fleet too large for cards to stay useful. Persisted like PanelLayout above. */
export type OverviewViewMode = 'cards' | 'table'
export const DEFAULT_OVERVIEW_VIEW_MODE: OverviewViewMode = 'cards'

// Which sections the Status widget itself shows - independent of whether Status as a whole is
// visible in PanelLayout above. Same shape and persistence pattern as PanelLayout, one layer down.
export type StatusWidgetType = 'grafana' | 'slurm' | 'storage' | 'jira'
export const ALL_STATUS_WIDGET_TYPES: StatusWidgetType[] = ['grafana', 'slurm', 'storage', 'jira']

export interface StatusLayout {
  visible: StatusWidgetType[]
}

export const DEFAULT_STATUS_LAYOUT: StatusLayout = {
  visible: ALL_STATUS_WIDGET_TYPES
}

// The cluster sidebar's drag-resizable width in px - persisted like PanelLayout above, one shared
// preference for the whole app rather than per-cluster state.
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
export const DEFAULT_SIDEBAR_WIDTH = 272

/** User-chosen cluster display order (ids), separate from cluster identity/configuration - a pure
 *  UI preference, persisted like PanelLayout above. A cluster id missing from this list (new, or
 *  before the first reorder) falls back to its incoming position - see
 *  src/renderer/src/features/shell/clusterOrder.ts. */
export type ClusterOrder = string[]
export const DEFAULT_CLUSTER_ORDER: ClusterOrder = []
