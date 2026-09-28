import { Fragment, useRef, useState } from 'react'
import { Columns2, Plus, Rows2, X } from 'lucide-react'
import type { SessionStatus } from './TerminalPanel'

type DropZone = 'before' | 'after' | 'merge'

interface TerminalTabBarProps {
  /** Tabs the user has dragged together are "stacked" - shown split, simultaneously - while
   *  separate groups are reached by switching between them. Order here is display order. */
  groups: string[][]
  /** Stable per-tab label numbers, keyed by creation order (see MainPanel's tabOrder) - not
   *  recomputed from display position, so a tab's number doesn't shift when it's reordered or
   *  regrouped. */
  tabNumbers: Map<string, number>
  /** Each tab's own connection status, for its status dot - absent until that tab's session has
   *  reported at least once (effectively immediately after mount). */
  statuses: Map<string, SessionStatus>
  /** User-set custom names, keyed by tab id. A tab with no entry here falls back to
   *  "Session {tabNumbers}". */
  titles: Map<string, string>
  activeTabId: string
  /** Can't be closed or dragged, though other tabs can be dropped onto it to join its group. */
  primaryTabId: string
  orientation: 'horizontal' | 'vertical'
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  /** `dropId` is null when the tab was dragged onto empty strip space rather than another tab
   *  (zone is meaningless in that case) - see MainPanel's handleDropTab for the reorder/
   *  merge/pop-out semantics this drives. `zone` is which third of dropId's tab the pointer was
   *  over: the edge thirds reorder (dragId ends up in its own standalone group, positioned next
   *  to dropId's), the middle third merges dragId into dropId's group instead. Dropping directly
   *  onto a visible session panel (not just its tab) also calls this, always with zone 'merge'
   *  and dropId set to that panel's tab id. */
  onDrop: (dragId: string, dropId: string | null, zone: DropZone) => void
  onRename: (id: string, title: string) => void
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
  statuses,
  titles,
  activeTabId,
  primaryTabId,
  orientation,
  onSelect,
  onAdd,
  onClose,
  onDrop,
  onRename,
  onOrientationChange
}: TerminalTabBarProps): React.JSX.Element {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hover, setHover] = useState<{ id: string; zone: DropZone } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Refs mirror the state above and are what move/up actually read from: a real mouse fires
  // pointermove faster than React re-renders, so a fast drag's first move could still see a
  // stale (pre-drag) value from state - refs are updated synchronously, in the same tick.
  const draggingIdRef = useRef<string | null>(null)
  const hoverRef = useRef<{ id: string; zone: DropZone } | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  // The terminal-tab-pane element (rendered by MainPanel, well outside this component's own DOM)
  // currently highlighted as a drop target, tracked and toggled imperatively rather than through
  // React state - it's a transient visual during a drag, not app data, and elementFromPoint finds
  // it either way regardless of component boundaries.
  const paneHoverElRef = useRef<Element | null>(null)

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
              const status = statuses.get(id)
              const title = titles.get(id) ?? `Session ${label}`
              const isRenaming = renamingId === id
              const dropZone = hover?.id === id && id !== draggingId ? hover.zone : null
              return (
                <div
                  key={id}
                  data-tab-id={id}
                  className={`terminal-tab${!isPrimary ? ' terminal-tab-draggable' : ''}${
                    id === activeTabId ? ' terminal-tab-active' : ''
                  }${id === draggingId ? ' terminal-tab-dragging' : ''}${
                    dropZone === 'merge' ? ' terminal-tab-hover' : ''
                  }${dropZone === 'before' ? ' terminal-tab-drop-before' : ''}${
                    dropZone === 'after' ? ' terminal-tab-drop-after' : ''
                  }`}
                  onClick={() => onSelect(id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setRenameValue(title)
                    setRenamingId(id)
                  }}
                  onPointerDown={(e) => {
                    if (isPrimary) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    draggingIdRef.current = id
                    hoverRef.current = null
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
                    const hit = document.elementFromPoint(e.clientX, e.clientY)
                    const overTab = hit?.closest('.terminal-tab')
                    // Dragging past the tab strip entirely and onto the terminal content itself
                    // (a session panel, not just its tab) always merges - dropping directly onto
                    // a session is unambiguous, there's no "just reorder" reading of it - and
                    // lands dragId right after that pane's tab within its group, i.e. stacked
                    // below it (or to its right, in horizontal orientation).
                    const overPane = !overTab ? hit?.closest('.terminal-tab-pane') : null
                    if (paneHoverElRef.current && paneHoverElRef.current !== overPane) {
                      paneHoverElRef.current.classList.remove('terminal-tab-pane-drop-target')
                      paneHoverElRef.current = null
                    }
                    let next: { id: string; zone: DropZone } | null = null
                    if (overPane) {
                      const paneId = overPane.getAttribute('data-tab-id')
                      if (paneId && paneId !== dragId) {
                        overPane.classList.add('terminal-tab-pane-drop-target')
                        paneHoverElRef.current = overPane
                        next = { id: paneId, zone: 'merge' }
                      }
                    } else {
                      const overId = overTab?.getAttribute('data-tab-id')
                      if (overTab && overId && overId !== dragId) {
                        const rect = overTab.getBoundingClientRect()
                        // The middle third of the target tab merges dragId into its group; the
                        // outer thirds (along the strip's own axis) just reorder instead -
                        // without this split, dropping anywhere on a tab always merged, so two
                        // standalone tabs could never swap places without also getting stacked.
                        const rel =
                          orientation === 'vertical'
                            ? (e.clientY - rect.top) / rect.height
                            : (e.clientX - rect.left) / rect.width
                        const zone: DropZone = rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'merge'
                        next = { id: overId, zone }
                      }
                    }
                    hoverRef.current = next
                    setHover(next)
                  }}
                  onPointerUp={(e) => {
                    e.currentTarget.releasePointerCapture(e.pointerId)
                    if (draggingIdRef.current && movedRef.current) {
                      const drop = hoverRef.current
                      onDrop(draggingIdRef.current, drop?.id ?? null, drop?.zone ?? 'merge')
                    }
                    if (paneHoverElRef.current) {
                      paneHoverElRef.current.classList.remove('terminal-tab-pane-drop-target')
                      paneHoverElRef.current = null
                    }
                    draggingIdRef.current = null
                    hoverRef.current = null
                    startPosRef.current = null
                    movedRef.current = false
                    setDraggingId(null)
                    setHover(null)
                  }}
                >
                  {status && <span className={`session-dot session-dot-${status}`} />}
                  {isRenaming ? (
                    <input
                      className="terminal-tab-rename"
                      autoFocus
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        onRename(id, renameValue)
                        setRenamingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <span className="terminal-tab-label">{title}</span>
                  )}
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
