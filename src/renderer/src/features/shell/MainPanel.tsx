import { useCallback, useState } from 'react'
import { ArrowLeftRight, Columns2, Power, Puzzle, Rows2 } from 'lucide-react'
import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import TerminalPanel, { type SessionStatus } from '../terminal/TerminalPanel'
import TerminalTabBar from '../terminal/TerminalTabBar'
import StatusPanel from '../status/StatusPanel'
import WidgetPicker from './WidgetPicker'
import { toggleWidget, swapPanes, type PanelLayout, type WidgetType } from './panelLayout'

interface MainPanelProps {
  cluster: ClusterSummary
  layout: PanelLayout
  onLayoutChange: (layout: PanelLayout) => void
  /** This cluster's live reachability reading - see TerminalPanel's prop of the same name for why
   *  it's passed straight through rather than reduced to a one-shot signal. */
  reachability?: ClusterReachability
  /** True when this cluster isn't the one currently selected in the sidebar - kept mounted
   *  (instead of unmounted) so a pinned cluster's Terminal/Grafana connections keep running in
   *  the background, just visually hidden. */
  hidden?: boolean
  onTerminalStatusChange?: (status: SessionStatus) => void
  /** Flips `cluster.activeMonitoring` back on - offered from the standby placeholder below. */
  onResumeMonitoring?: () => void
}

// Both widgets stay mounted at all times regardless of visibility - `display: none` instead of
// unmounting - so hiding the Terminal never disconnects its SSH session, and re-showing it is
// instant. `order` (not DOM position) controls which side/row a pane appears on, so "swap" is a
// pure CSS reorder with no remount either. Orders are 0/2 (not 0/1) to leave room for the resize
// handle at order 1, always sitting between the two panes regardless of swap.
function paneStyle(visible: WidgetType[], type: WidgetType, ratio: number): React.CSSProperties {
  const index = visible.indexOf(type)
  const flexGrow = index === 0 ? ratio : index === 1 ? 1 - ratio : 1
  return {
    display: index === -1 ? 'none' : 'flex',
    order: index === -1 ? 99 : index * 2,
    flexGrow
  }
}

export default function MainPanel({
  cluster,
  layout,
  onLayoutChange,
  reachability,
  hidden = false,
  onTerminalStatusChange,
  onResumeMonitoring
}: MainPanelProps): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  // Tab 0 is this cluster's primary session - the one keepAliveInBackground/standby apply to
  // (see AppShell's `hidden` prop) - and lives as long as this MainPanel instance does. Extra
  // tabs are foreground-only: unmounted (disconnecting their session) whenever this cluster isn't
  // the one currently selected, not just when explicitly closed - see the `hidden` check below.
  const [tabs, setTabs] = useState<string[]>(() => [crypto.randomUUID()])
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0])
  const [tabOrientation, setTabOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  const { visible, orientation } = layout
  const ratio = dragRatio ?? layout.splitRatio ?? 0.5

  const handleAddTab = useCallback((): void => {
    const id = crypto.randomUUID()
    setTabs((prev) => [...prev, id])
    setActiveTabId(id)
  }, [])

  const handleCloseTab = useCallback(
    (id: string): void => {
      if (tabs.length <= 1 || tabs[0] === id) return
      const next = tabs.filter((t) => t !== id)
      setTabs(next)
      if (activeTabId === id) setActiveTabId(next[next.length - 1])
    },
    [tabs, activeTabId]
  )

  // Tab 0 stays first - it's the cluster's primary/pinned session (see the `tabs` comment above),
  // so neither end of a reorder is allowed to touch it.
  const handleReorderTab = useCallback(
    (dragId: string, dropId: string): void => {
      if (tabs[0] === dragId || tabs[0] === dropId) return
      const from = tabs.indexOf(dragId)
      const to = tabs.indexOf(dropId)
      if (from === -1 || to === -1) return
      const next = [...tabs]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      setTabs(next)
    },
    [tabs]
  )

  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.buttons !== 1) return
    const container = e.currentTarget.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const fraction =
      orientation === 'horizontal'
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height
    setDragRatio(Math.min(0.85, Math.max(0.15, fraction)))
  }

  function handleResizeEnd(): void {
    if (dragRatio !== null) onLayoutChange({ ...layout, splitRatio: dragRatio })
    setDragRatio(null)
  }

  return (
    <div className={`main-panel${hidden ? ' main-panel-hidden' : ''}`}>
      <div className="panel-toolbar">
        <span className="panel-toolbar-title">{cluster.name}</span>
        <div className="panel-toolbar-actions">
          <button
            className="btn-icon"
            title="Swap pane order"
            disabled={visible.length < 2}
            onClick={() => onLayoutChange(swapPanes(layout))}
          >
            <ArrowLeftRight size={15} strokeWidth={2} />
          </button>
          <button
            className={`btn-icon${orientation === 'horizontal' ? ' btn-icon-active' : ''}`}
            title="Side by side"
            onClick={() => onLayoutChange({ ...layout, orientation: 'horizontal' })}
          >
            <Columns2 size={15} strokeWidth={2} />
          </button>
          <button
            className={`btn-icon${orientation === 'vertical' ? ' btn-icon-active' : ''}`}
            title="Stacked"
            onClick={() => onLayoutChange({ ...layout, orientation: 'vertical' })}
          >
            <Rows2 size={15} strokeWidth={2} />
          </button>
          <div className="widget-picker-anchor">
            <button
              className={`btn-icon${pickerOpen ? ' btn-icon-active' : ''}`}
              title="Add or remove widgets"
              onClick={() => setPickerOpen((open) => !open)}
            >
              <Puzzle size={15} strokeWidth={2} />
            </button>
            {pickerOpen && (
              <WidgetPicker
                visible={visible}
                onToggle={(type) => onLayoutChange(toggleWidget(layout, type))}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {cluster.activeMonitoring ? (
        // Both panes stay in the DOM even with visible.length === 0 (see paneStyle) so hiding
        // every widget still never disconnects the terminal's SSH session.
        <div className={`panel-split panel-split-${orientation}`}>
          {visible.length === 0 && (
            <div className="panel-split-empty">
              Every widget is hidden - click the puzzle-piece icon above to add one back.
            </div>
          )}
          <div className="panel-pane" style={paneStyle(visible, 'terminal', ratio)}>
            <div className={`terminal-tabs-layout terminal-tabs-layout-${tabOrientation}`}>
              <TerminalTabBar
                tabs={tabs}
                activeTabId={activeTabId}
                orientation={tabOrientation}
                onSelect={setActiveTabId}
                onAdd={handleAddTab}
                onClose={handleCloseTab}
                onReorder={handleReorderTab}
                onOrientationChange={setTabOrientation}
              />
              <div className="terminal-tab-panes">
                {tabs.map((tabId, index) => {
                  const isPrimary = index === 0
                  if (!isPrimary && hidden) return null
                  return (
                    <div
                      key={tabId}
                      className="terminal-tab-pane"
                      style={{ display: tabId === activeTabId ? 'flex' : 'none' }}
                    >
                      <TerminalPanel
                        cluster={cluster}
                        reachability={reachability}
                        onStatusChange={isPrimary ? onTerminalStatusChange : undefined}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          {visible.length === 2 && (
            <div
              className={`panel-resizer panel-resizer-${orientation}`}
              style={{ order: 1 }}
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
          )}
          <div className="panel-pane" style={paneStyle(visible, 'status', ratio)}>
            <StatusPanel cluster={cluster} reachability={reachability} />
          </div>
        </div>
      ) : (
        // Neither TerminalPanel nor StatusPanel is mounted at all here - no SSH session, no
        // Grafana polling, no reconnect/backoff loop exists for this cluster while in standby.
        <div className="panel-split-empty panel-standby">
          <Power size={22} strokeWidth={1.5} />
          <p>
            Active Monitoring is off for {cluster.name} - no Terminal or Grafana connections are
            running.
          </p>
          <button className="btn btn-sm" onClick={onResumeMonitoring}>
            <Power size={13} strokeWidth={2} />
            Resume monitoring
          </button>
        </div>
      )}
    </div>
  )
}
