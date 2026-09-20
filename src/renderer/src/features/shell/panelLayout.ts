// Renderer-side helpers for the layout defined in src/shared/types.ts (WidgetType, PanelLayout,
// etc.) - shared with the main process because it validates and persists the layout too (see
// src/main/settings.ts). New widget types plug in over there and into WidgetPicker.tsx's list -
// nothing here needs to change to add one to the picker.
import {
  ALL_WIDGET_TYPES,
  DEFAULT_PANEL_LAYOUT,
  type PanelLayout,
  type WidgetType
} from '../../../../shared/types'

export type { PanelLayout, PanelOrientation, WidgetType } from '../../../../shared/types'
export { ALL_WIDGET_TYPES, DEFAULT_PANEL_LAYOUT }

/** Adds a widget to the layout if it isn't already visible - used when something outside the
 *  panel itself (Connect on a cluster card, clicking a notification) wants to make sure a
 *  particular widget is on screen without discarding whatever else the user already had open. */
export function withWidgetVisible(layout: PanelLayout, type: WidgetType): PanelLayout {
  if (layout.visible.includes(type)) return layout
  return { ...layout, visible: [...layout.visible, type] }
}

export function toggleWidget(layout: PanelLayout, type: WidgetType): PanelLayout {
  const visible = layout.visible.includes(type)
    ? layout.visible.filter((w) => w !== type)
    : [...layout.visible, type]
  return { ...layout, visible }
}

/** Reverses pane order - "swap" for the common two-pane case, but well-defined for any count. */
export function swapPanes(layout: PanelLayout): PanelLayout {
  return { ...layout, visible: [...layout.visible].reverse() }
}
