import { useEffect, useRef } from 'react'
import './terminal.css'
import { SPLIT_SHORTCUT_LABEL } from '../../lib/platform'

interface TabContextMenuProps {
  x: number
  y: number
  onDismiss: () => void
  onRename: () => void
  onSplit: () => void
  onDuplicate: () => void
  /** null hides the item - see MainPanel's callers for when each action doesn't apply. */
  onUnstack: (() => void) | null
  onCloseTab: (() => void) | null
  onCloseOthers: (() => void) | null
  onCloseAll: (() => void) | null
}

/** Right-click menu for a terminal tab, opened from either its tab-strip entry or its session
 *  panel - both just report a tab id and a cursor position up to MainPanel, which owns the tab/
 *  group state these actions need and renders a single instance of this menu regardless of where
 *  it was triggered from. */
export default function TabContextMenu({
  x,
  y,
  onDismiss,
  onRename,
  onSplit,
  onDuplicate,
  onUnstack,
  onCloseTab,
  onCloseOthers,
  onCloseAll
}: TabContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleOutside(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onDismiss])

  function run(action: () => void): void {
    action()
    onDismiss()
  }

  return (
    <div className="tab-context-menu" style={{ left: x, top: y }} ref={ref}>
      <button className="tab-context-menu-item" onClick={() => run(onRename)}>
        Rename
      </button>
      <button className="tab-context-menu-item" onClick={() => run(onSplit)}>
        Split
        <kbd className="tab-context-menu-shortcut">{SPLIT_SHORTCUT_LABEL}</kbd>
      </button>
      <button className="tab-context-menu-item" onClick={() => run(onDuplicate)}>
        Duplicate
      </button>
      {onUnstack && (
        <button className="tab-context-menu-item" onClick={() => run(onUnstack)}>
          Unstack
        </button>
      )}
      {(onCloseTab || onCloseOthers || onCloseAll) && <div className="tab-context-menu-divider" />}
      {onCloseTab && (
        <button
          className="tab-context-menu-item tab-context-menu-item-danger"
          onClick={() => run(onCloseTab)}
        >
          Close
        </button>
      )}
      {onCloseOthers && (
        <button
          className="tab-context-menu-item tab-context-menu-item-danger"
          onClick={() => run(onCloseOthers)}
        >
          Close Others
        </button>
      )}
      {onCloseAll && (
        <button
          className="tab-context-menu-item tab-context-menu-item-danger"
          onClick={() => run(onCloseAll)}
        >
          Close All
        </button>
      )}
    </div>
  )
}
