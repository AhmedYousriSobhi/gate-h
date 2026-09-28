import { Fragment, useRef, useState } from 'react'
import { Columns2, Plus, Rows2, X } from 'lucide-react'

interface TerminalTabBarProps {
  /** Tabs the user has dragged together are "stacked" - shown split, simultaneously - while
   *  separate groups are reached by switching between them. Order here is display order. */
  groups: string[][]
  /** Stable per-tab label numbers, keyed by creation order (see MainPanel's tabOrder) - not
   *  recomputed from display position, so a tab's number doesn't shift when it's reordered or
   *  regrouped. */
  tabNumbers: Map<string, number>
  activeTabId: string
  /** Can't be closed or dragged, though other tabs can be dropped onto it to join its group. */
  primaryTabId: string
  orientation: 'horizontal' | 'vertical'
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  /** `dropId` is null when the tab was dragged onto empty strip space rather than another tab -
   *  see MainPanel's handleDropTab for the reorder/merge/pop-out semantics this drives. */
  onDrop: (dragId: string, dropId: string | null) => void
  onOrientationChange: (orientation: 'horizontal' | 'vertical') => void
}

// Reordering/grouping uses plain pointer events (setPointerCapture + elementFromPoint
// hit-testing, gated behind a small movement threshold so a plain click never misfires as a
// drag), the same technique MainPanel's own pane-resize handle already uses, rather than native
// HTML5 drag-and-drop - the native drag/drop event sequence turned out to be unreliable for a
// real mouse gesture in this app (it only fired for synthetic/CDP-driven drags).
const DRAG_THRESHOLD_PX = 4

export default function TerminalTabBar({
  groups,
  tabNumbers,
  activeTabId,
  primaryTabId,
  orientation,
  onSelect,
  onAdd,
  onClose,
  onDrop,
  onOrientationChange
}: TerminalTabBarProps): React.JSX.Element {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  // Refs mirror the state above and are what move/up actually read from: a real mouse fires
  // pointermove faster than React re-renders, so a fast drag's first move could still see a
  // stale (pre-drag) value from state - refs are updated synchronously, in the same tick.
  const draggingIdRef = useRef<string | null>(null)
  const hoverIdRef = useRef<string | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)

  return (
    <div className={`terminal-tabbar terminal-tabbar-${orientation}`}>
      {groups.map((group, groupIndex) => (
        <Fragment key={group[0]}>
          <div
            className={`terminal-tab-group${group.length > 1 ? ' terminal-tab-group-stacked' : ''}`}
          >
            {group.map((id) => {
              const label = tabNumbers.get(id)
              const isPrimary = id === primaryTabId
              return (
                <div
                  key={id}
                  data-tab-id={id}
                  className={`terminal-tab${!isPrimary ? ' terminal-tab-draggable' : ''}${
                    id === activeTabId ? ' terminal-tab-active' : ''
                  }${id === draggingId ? ' terminal-tab-dragging' : ''}${
                    id === hoverId && id !== draggingId ? ' terminal-tab-hover' : ''
                  }`}
                  onClick={() => onSelect(id)}
                  onPointerDown={(e) => {
                    if (isPrimary) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    draggingIdRef.current = id
                    hoverIdRef.current = null
                    startPosRef.current = { x: e.clientX, y: e.clientY }
                    movedRef.current = false
                  }}
                  onPointerMove={(e) => {
                    const dragId = draggingIdRef.current
                    const start = startPosRef.current
                    if (!dragId || !start) return
                    if (!movedRef.current) {
                      if (
                        Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX
                      ) {
                        return
                      }
                      movedRef.current = true
                      setDraggingId(dragId)
                    }
                    const over = document
                      .elementFromPoint(e.clientX, e.clientY)
                      ?.closest('.terminal-tab')
                    const overId = over?.getAttribute('data-tab-id') ?? null
                    hoverIdRef.current = overId
                    setHoverId(overId)
                  }}
                  onPointerUp={(e) => {
                    e.currentTarget.releasePointerCapture(e.pointerId)
                    if (draggingIdRef.current && movedRef.current) {
                      onDrop(draggingIdRef.current, hoverIdRef.current)
                    }
                    draggingIdRef.current = null
                    hoverIdRef.current = null
                    startPosRef.current = null
                    movedRef.current = false
                    setDraggingId(null)
                    setHoverId(null)
                  }}
                >
                  <span>Tab {label}</span>
                  {!isPrimary && (
                    <button
                      className="terminal-tab-close"
                      title="Close tab"
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose(id)
                      }}
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {groupIndex < groups.length - 1 && <div className="terminal-tab-group-divider" />}
        </Fragment>
      ))}
      <button className="btn-icon terminal-tab-add" title="New terminal tab" onClick={onAdd}>
        <Plus size={13} strokeWidth={2} />
      </button>
      <div className="terminal-tabbar-spacer" />
      <button
        className={`btn-icon${orientation === 'horizontal' ? ' btn-icon-active' : ''}`}
        title="Tabs side by side"
        onClick={() => onOrientationChange('horizontal')}
      >
        <Columns2 size={13} strokeWidth={2} />
      </button>
      <button
        className={`btn-icon${orientation === 'vertical' ? ' btn-icon-active' : ''}`}
        title="Tabs stacked"
        onClick={() => onOrientationChange('vertical')}
      >
        <Rows2 size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
