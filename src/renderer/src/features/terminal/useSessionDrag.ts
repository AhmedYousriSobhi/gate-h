import { useCallback, useEffect, useRef, useState } from 'react'
import type { Edge } from './splitLayout'

export type DropZone = 'before' | 'after' | 'merge'
const EDGES: Edge[] = ['left', 'right', 'top', 'bottom']
// A plain click never moves this far, so it never turns into a drag.
const DRAG_THRESHOLD_PX = 4

function nearestEdge(rect: DOMRect, x: number, y: number): Edge {
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const distances: Array<[Edge, number]> = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy]
  ]
  return distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0]
}

interface Options {
  /** Which way the tab strip runs - a tab's reorder zones are its ends along that axis. */
  stripOrientation: 'horizontal' | 'vertical'
  /** Dropped on a tab (dropId, with the zone hovered) or on empty tab-strip space (null). */
  onDrop: (dragId: string, dropId: string | null, zone: DropZone) => void
  /** Dropped on a session panel: stack dragId on `edge`'s side of it. */
  onPaneDrop: (dragId: string, paneId: string, edge: Edge) => void
}

/** Dragging a session - by its tab or by its panel's header bar. Plain pointer events with
 *  document listeners and elementFromPoint hit-testing, rather than native HTML5 drag-and-drop,
 *  which proved unreliable for real mouse gestures in this app. Everything the move/up handlers
 *  read lives in refs: pointermove can fire faster than React re-renders. */
export function useSessionDrag({ stripOrientation, onDrop, onPaneDrop }: Options): {
  draggingId: string | null
  hover: { id: string; zone: DropZone } | null
  startDrag: (id: string, event: React.PointerEvent) => void
} {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hover, setHover] = useState<{ id: string; zone: DropZone } | null>(null)
  const latest = useRef({ stripOrientation, onDrop, onPaneDrop })
  useEffect(() => {
    latest.current = { stripOrientation, onDrop, onPaneDrop }
  })

  const startDrag = useCallback((id: string, event: React.PointerEvent): void => {
    if (event.button !== 0) return
    const start = { x: event.clientX, y: event.clientY }
    let moved = false
    let target:
      | { kind: 'tab'; id: string; zone: DropZone }
      | { kind: 'pane'; id: string; edge: Edge }
      | { kind: 'strip' }
      | null = null
    // The panel currently showing a drop preview - toggled imperatively, since it's a transient
    // drag visual on an element rendered elsewhere, not app state.
    let highlighted: Element | null = null
    const clearHighlight = (): void => {
      highlighted?.classList.remove(...EDGES.map((e) => `terminal-tab-pane-drop-${e}`))
      highlighted = null
    }

    const onMove = (e: PointerEvent): void => {
      if (!moved) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return
        moved = true
        setDraggingId(id)
        document.body.classList.add('session-dragging')
      }
      const hit = document.elementFromPoint(e.clientX, e.clientY)
      const overTab = hit?.closest('.terminal-tab')
      const overPane = overTab ? null : hit?.closest('.terminal-tab-pane')
      clearHighlight()
      target = null
      if (overTab) {
        const overId = overTab.getAttribute('data-tab-id')
        if (overId && overId !== id) {
          const rect = overTab.getBoundingClientRect()
          // Middle 60% of a tab stacks with it; only the outer 20% strips along the strip's axis
          // reorder - kept wide since a stacked pill's tabs are small targets.
          const rel =
            latest.current.stripOrientation === 'vertical'
              ? (e.clientY - rect.top) / rect.height
              : (e.clientX - rect.left) / rect.width
          target = {
            kind: 'tab',
            id: overId,
            zone: rel < 0.2 ? 'before' : rel > 0.8 ? 'after' : 'merge'
          }
        }
      } else if (overPane) {
        const paneId = overPane.getAttribute('data-tab-id')
        if (paneId && paneId !== id) {
          const edge = nearestEdge(overPane.getBoundingClientRect(), e.clientX, e.clientY)
          overPane.classList.add(`terminal-tab-pane-drop-${edge}`)
          highlighted = overPane
          target = { kind: 'pane', id: paneId, edge }
        }
      } else if (hit?.closest('.terminal-tabbar')) {
        target = { kind: 'strip' }
      }
      setHover(
        target?.kind === 'tab'
          ? { id: target.id, zone: target.zone }
          : target?.kind === 'pane'
            ? { id: target.id, zone: 'merge' }
            : null
      )
    }

    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      clearHighlight()
      document.body.classList.remove('session-dragging')
      if (moved && target) {
        if (target.kind === 'pane') latest.current.onPaneDrop(id, target.id, target.edge)
        else if (target.kind === 'tab') latest.current.onDrop(id, target.id, target.zone)
        else latest.current.onDrop(id, null, 'merge')
      }
      setDraggingId(null)
      setHover(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  return { draggingId, hover, startDrag }
}
