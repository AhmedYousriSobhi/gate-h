import { Fragment, useRef, useState } from 'react'
import { Ellipsis, Plus, SquareSplitHorizontal, SquareSplitVertical, X } from 'lucide-react'
import type { SessionStatus } from './TerminalPanel'
import TerminalLayoutMenu from './TerminalLayoutMenu'
import type { DropZone } from './useSessionDrag'

const STATUS_WORDS: Record<SessionStatus, string> = {
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  paused: 'paused',
  'auth-required': 'login needed'
}

// Matches .tab-context-menu's min-width plus a little slack, for keeping the menu on-screen.
const LAYOUT_MENU_WIDTH = 190

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
  /** Each tab's label - its rename, else its shell's window title (see MainPanel's tabTitle).
   *  A tab missing here falls back to "Session {tabNumbers}". */
  titles: Map<string, string>
  activeTabId: string
  /** Can't be closed (no close button), but drags and stacks like any other tab. */
  primaryTabId: string
  orientation: 'horizontal' | 'vertical'
  /** How a stacked group's panes are arranged - independent of `orientation` (the tab strip's
   *  own layout), so a vertical sidebar of tabs isn't forced into a top/bottom pane split. */
  splitOrientation: 'horizontal' | 'vertical'
  onSelect: (id: string) => void
  onAdd: () => void
  /** Adds a new session into the active tab's group (VS Code's "Split Terminal"). */
  onSplit: () => void
  onClose: (id: string) => void
  /** Drag state and starter from MainPanel's useSessionDrag - shared with the session panels'
   *  header bars, so a session can be dragged by either. */
  draggingId: string | null
  hover: { id: string; zone: DropZone } | null
  onStartDrag: (id: string, event: React.PointerEvent) => void
  /** Rename editing is controlled from MainPanel (not owned here) so the context menu's
   *  "Rename" - which can be opened from a session panel, not just the strip - can start the
   *  same edit as double-clicking a tab. */
  renamingId: string | null
  renameValue: string
  onStartRename: (id: string) => void
  onRenameValueChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onContextMenu: (id: string, x: number, y: number) => void
  onOrientationChange: (orientation: 'horizontal' | 'vertical') => void
  onSplitOrientationChange: (orientation: 'horizontal' | 'vertical') => void
}

export default function TerminalTabBar({
  groups,
  tabNumbers,
  statuses,
  titles,
  activeTabId,
  primaryTabId,
  orientation,
  splitOrientation,
  onSelect,
  onAdd,
  onSplit,
  onClose,
  draggingId,
  hover,
  onStartDrag,
  renamingId,
  renameValue,
  onStartRename,
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onContextMenu,
  onOrientationChange,
  onSplitOrientationChange
}: TerminalTabBarProps): React.JSX.Element {
  const layoutButtonRef = useRef<HTMLButtonElement | null>(null)
  const [layoutMenu, setLayoutMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <div className={`terminal-tabbar terminal-tabbar-${orientation}`}>
      <div className="terminal-tabbar-actions">
        <button
          className="btn-icon"
          title="New session (Alt+click to split)"
          onClick={(e) => (e.altKey ? onSplit() : onAdd())}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
        <button className="btn-icon" title="Split session (Ctrl+Shift+5)" onClick={onSplit}>
          {splitOrientation === 'horizontal' ? (
            <SquareSplitHorizontal size={14} strokeWidth={2} />
          ) : (
            <SquareSplitVertical size={14} strokeWidth={2} />
          )}
        </button>
        <button
          ref={layoutButtonRef}
          className={`btn-icon${layoutMenu ? ' btn-icon-active' : ''}`}
          title="Layout options"
          onClick={(e) => {
            if (layoutMenu) return setLayoutMenu(null)
            const rect = e.currentTarget.getBoundingClientRect()
            setLayoutMenu({
              x: Math.max(8, Math.min(rect.left, window.innerWidth - LAYOUT_MENU_WIDTH - 8)),
              y: rect.bottom + 4
            })
          }}
        >
          <Ellipsis size={14} strokeWidth={2} />
        </button>
      </div>
      {layoutMenu && (
        <TerminalLayoutMenu
          x={layoutMenu.x}
          y={layoutMenu.y}
          anchorRef={layoutButtonRef}
          orientation={orientation}
          splitOrientation={splitOrientation}
          onOrientationChange={onOrientationChange}
          onSplitOrientationChange={onSplitOrientationChange}
          onDismiss={() => setLayoutMenu(null)}
        />
      )}
      <div className="terminal-tabbar-tabs">
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
                    title={status ? `${title} - ${STATUS_WORDS[status]}` : title}
                    className={`terminal-tab terminal-tab-draggable${
                      id === activeTabId ? ' terminal-tab-active' : ''
                    }${id === draggingId ? ' terminal-tab-dragging' : ''}${
                      dropZone === 'merge' ? ' terminal-tab-hover' : ''
                    }${dropZone === 'before' ? ' terminal-tab-drop-before' : ''}${
                      dropZone === 'after' ? ' terminal-tab-drop-after' : ''
                    }`}
                    onClick={() => onSelect(id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onStartRename(id)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onContextMenu(id, e.clientX, e.clientY)
                    }}
                    onPointerDown={(e) => onStartDrag(id, e)}
                  >
                    {status && <span className={`session-dot session-dot-${status}`} />}
                    {isRenaming ? (
                      <input
                        className="terminal-tab-rename"
                        autoFocus
                        value={renameValue}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => onRenameValueChange(e.target.value)}
                        onBlur={onRenameCommit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') onRenameCancel()
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
      </div>
    </div>
  )
}
