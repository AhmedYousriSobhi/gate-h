// The set of widgets a cluster's main panel can show side by side, and the layout controls
// (which are visible, in what order, split which way) that make that dynamic instead of a fixed
// pair of tabs. New widget types plug in here and into WIDGET_DEFS in WidgetPicker.tsx - nothing
// else needs to change to add one to the picker.
export type WidgetType = 'terminal' | 'status'

export const ALL_WIDGET_TYPES: WidgetType[] = ['terminal', 'status']

export type PanelOrientation = 'horizontal' | 'vertical'

export interface PanelLayout {
  /** Which widgets are currently shown, in left-to-right (horizontal) or top-to-bottom (vertical)
   *  order - reordering this is what "swapping" two panes means. */
  visible: WidgetType[]
  orientation: PanelOrientation
}

export const DEFAULT_LAYOUT: PanelLayout = {
  visible: ['terminal', 'status'],
  orientation: 'horizontal'
}

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
