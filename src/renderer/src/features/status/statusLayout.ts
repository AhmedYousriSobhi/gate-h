// Renderer-side helper for the layout defined in src/shared/types.ts (StatusWidgetType,
// StatusLayout) - shared with the main process because it validates and persists the layout too
// (see src/main/settings.ts). Mirrors shell/panelLayout.ts's toggleWidget one layer down: this
// toggles a section *within* Status, independent of whether Status itself is shown in PanelLayout.
import type { StatusLayout, StatusWidgetType } from '../../../../shared/types'

export type { StatusLayout, StatusWidgetType } from '../../../../shared/types'
export { ALL_STATUS_WIDGET_TYPES, DEFAULT_STATUS_LAYOUT } from '../../../../shared/types'

export function toggleStatusWidget(layout: StatusLayout, type: StatusWidgetType): StatusLayout {
  const visible = layout.visible.includes(type)
    ? layout.visible.filter((w) => w !== type)
    : [...layout.visible, type]
  return { ...layout, visible }
}
