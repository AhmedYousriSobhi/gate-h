import { useRef, useState } from 'react'
import { Columns2, LayoutGrid, Plus, Rows2, X } from 'lucide-react'

interface TerminalTabBarProps {
  tabs: string[]
  activeTabId: string
  orientation: 'horizontal' | 'vertical'
  /** When true, every tab's terminal is visible at once (arranged per `orientation`) instead of
   *  only `activeTabId`'s - see MainPanel. */
  splitView: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  onReorder: (dragId: string, dropId: string) => void
  onOrientationChange: (orientation: 'horizontal' | 'vertical') => void
  onToggleSplitView: () => void
}

// Tab 0 is the cluster's primary session (the one keepAliveInBackground/standby apply to - see
// MainPanel) and can't be closed or reordered; every other tab is an ordinary foreground-only
// session, freely draggable among themselves.
//
// Reordering uses plain pointer events (setPointerCapture + elementFromPoint hit-testing), the
// same technique MainPanel's own pane-resize handle already uses, rather than native HTML5
// drag-and-drop - the native drag/drop event sequence turned out to be unreliable for a real
// mouse gesture in this app (it only fired for synthetic/CDP-driven drags), so it never actually
// reordered anything despite the grab cursor showing.
export default function TerminalTabBar({
  tabs,
  activeTabId,
  orientation,
  splitView,
  onSelect,
  onAdd,
  onClose,
  onReorder,
  onOrientationChange,
  onToggleSplitView
}: TerminalTabBarProps): React.JSX.Element {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  // A real mouse fires pointermove faster than React re-renders, so the move/up handlers below
  // read these refs (updated synchronously, in the same tick) rather than the state above (which
  // can still be one render behind) - state alone caused a race where a fast drag saw a stale
  // `draggingId` of null in its very first pointermove and never captured a hover target.
  const draggingIdRef = useRef<string | null>(null)
  const hoverIdRef = useRef<string | null>(null)

  return (
    <div className={`terminal-tabbar terminal-tabbar-${orientation}`}>
      {tabs.map((id, index) => (
        <div
          key={id}
          data-tab-id={id}
          className={`terminal-tab${index > 0 ? ' terminal-tab-draggable' : ''}${
            id === activeTabId ? ' terminal-tab-active' : ''
          }${id === draggingId ? ' terminal-tab-dragging' : ''}${
            id === hoverId && id !== draggingId ? ' terminal-tab-hover' : ''
          }`}
          onClick={() => onSelect(id)}
          onPointerDown={(e) => {
            if (index === 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            draggingIdRef.current = id
            hoverIdRef.current = null
            setDraggingId(id)
            setHoverId(null)
          }}
          onPointerMove={(e) => {
            if (!draggingIdRef.current) return
            const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.terminal-tab')
            const overId = over?.getAttribute('data-tab-id')
            const next = overId && overId !== tabs[0] ? overId : null
            hoverIdRef.current = next
            setHoverId(next)
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId)
            const drag = draggingIdRef.current
            const hover = hoverIdRef.current
            if (drag && hover && hover !== drag) onReorder(drag, hover)
            draggingIdRef.current = null
            hoverIdRef.current = null
            setDraggingId(null)
            setHoverId(null)
          }}
        >
          <span>Tab {index + 1}</span>
          {index > 0 && (
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
      <button
        className={`btn-icon${splitView ? ' btn-icon-active' : ''}`}
        title={
          splitView
            ? 'Showing every tab at once - click to show one at a time'
            : 'Show every tab at once, split per the orientation above'
        }
        onClick={onToggleSplitView}
      >
        <LayoutGrid size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
