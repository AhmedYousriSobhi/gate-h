import { Plus, X } from 'lucide-react'

interface TerminalTabBarProps {
  tabs: string[]
  activeTabId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
}

// Tab 0 is the cluster's primary session (the one keepAliveInBackground/standby apply to - see
// MainPanel) and can't be closed; every other tab is an ordinary foreground-only session.
export default function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onAdd,
  onClose
}: TerminalTabBarProps): React.JSX.Element {
  return (
    <div className="terminal-tabbar">
      {tabs.map((id, index) => (
        <div
          key={id}
          className={`terminal-tab${id === activeTabId ? ' terminal-tab-active' : ''}`}
          onClick={() => onSelect(id)}
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
