import { useState } from 'react'
import { Plus, X } from 'lucide-react'

interface TerminalTabBarProps {
  tabs: string[]
  activeTabId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  onReorder: (dragId: string, dropId: string) => void
}

// Tab 0 is the cluster's primary session (the one keepAliveInBackground/standby apply to - see
// MainPanel) and can't be closed or reordered; every other tab is an ordinary foreground-only
// session, freely draggable among themselves.
export default function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onAdd,
  onClose,
  onReorder
}: TerminalTabBarProps): React.JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)

  return (
    <div className="terminal-tabbar">
      {tabs.map((id, index) => (
        <div
          key={id}
          className={`terminal-tab${id === activeTabId ? ' terminal-tab-active' : ''}${
            id === dragId ? ' terminal-tab-dragging' : ''
          }`}
          draggable={index > 0}
          onClick={() => onSelect(id)}
          onDragStart={() => setDragId(id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => {
            if (index > 0) e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragId && index > 0 && dragId !== id) onReorder(dragId, id)
            setDragId(null)
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
    </div>
  )
}
