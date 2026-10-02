import { useCallback, useState } from 'react'
import { Power } from 'lucide-react'
import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import TerminalPanel, { type SessionStatus } from '../terminal/TerminalPanel'
import TerminalTabBar from '../terminal/TerminalTabBar'
import StatusPanel from '../status/StatusPanel'
import FilesDialog from '../files/FilesDialog'
import TemplatesDialog from '../templates/TemplatesDialog'
import { type PanelLayout, type WidgetType } from './panelLayout'
import MainPanelToolbar from './MainPanelToolbar'
import MainPanelContextMenu from './MainPanelContextMenu'
import { useTerminalTabs } from './useTerminalTabs'

interface MainPanelProps {
  cluster: ClusterSummary
  layout: PanelLayout
  onLayoutChange: (layout: PanelLayout) => void
  /** This cluster's live reachability reading - see TerminalPanel's prop of the same name for why
   *  it's passed straight through rather than reduced to a one-shot signal. */
  reachability?: ClusterReachability
  /** True when this cluster isn't the one currently selected in the sidebar - kept mounted
   *  (instead of unmounted) so every one of its terminal sessions stays connected in the
   *  background, just visually hidden. Status is unmounted meanwhile (no Grafana/Jira polling, no
   *  live panel embeds) and remounts fresh on return. */
  hidden?: boolean
  onTerminalStatusChange?: (status: SessionStatus) => void
  /** How many of this cluster's sessions are connected - what closing the cluster would end. */
  onLiveSessionCountChange?: (count: number) => void
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
  onLiveSessionCountChange,
  onResumeMonitoring
}: MainPanelProps): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const closeFiles = useCallback(() => setFilesOpen(false), [])
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const closeTemplates = useCallback(() => setTemplatesOpen(false), [])
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const { visible, orientation } = layout
  const ratio = dragRatio ?? layout.splitRatio ?? 0.5

  const {
    primaryTabId,
    groupLeaves,
    tabNumbers,
    tabStatuses,
    setTabStatuses,
    tabLabels,
    activeTabId,
    setActiveTabId,
    tabOrientation,
    setTabOrientation,
    splitOrientation,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    handleAddTab,
    handleSplitTab,
    handleCloseTab,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    handleDuplicateTab,
    extractToStandaloneGroup,
    sessionDrag,
    startRename,
    commitRename,
    contextMenu,
    setContextMenu,
    handleSplitOrientationChange,
    tabBarWidth,
    setTabBarWidth,
    handleTabBarResizeMove,
    tabOrder,
    allTabs,
    activeRects,
    activeIsSplit,
    zoomedId,
    handleCycleTab,
    setShellTitles,
    activeDividers,
    handleDividerMove,
    setMaximizedId
  } = useTerminalTabs({
    activeMonitoring: cluster.activeMonitoring,
    onLiveSessionCountChange
  })

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
      {filesOpen && !hidden && <FilesDialog cluster={cluster} onClose={closeFiles} />}
      {templatesOpen && !hidden && <TemplatesDialog cluster={cluster} onClose={closeTemplates} />}
      <MainPanelToolbar
        cluster={cluster}
        layout={layout}
        onLayoutChange={onLayoutChange}
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
        onOpenFiles={() => setFilesOpen(true)}
        onOpenTemplates={() => setTemplatesOpen(true)}
      />

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
                groups={groupLeaves}
                tabNumbers={tabNumbers}
                statuses={tabStatuses}
                titles={tabLabels}
                activeTabId={activeTabId}
                primaryTabId={primaryTabId}
                orientation={tabOrientation}
                splitOrientation={splitOrientation}
                renamingId={renamingId}
                renameValue={renameValue}
                onSelect={setActiveTabId}
                onAdd={handleAddTab}
                onSplit={() => handleSplitTab(activeTabId)}
                onClose={handleCloseTab}
                draggingId={sessionDrag.draggingId}
                hover={sessionDrag.hover}
                onStartDrag={sessionDrag.startDrag}
                onStartRename={startRename}
                onRenameValueChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingId(null)}
                onContextMenu={(id, x, y) => setContextMenu({ tabId: id, x, y })}
                onOrientationChange={setTabOrientation}
                onSplitOrientationChange={handleSplitOrientationChange}
                width={tabBarWidth}
              />
              {tabOrientation === 'vertical' && (
                <div
                  className="terminal-tabbar-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize, double-click to reset"
                  onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                  onPointerMove={handleTabBarResizeMove}
                  onDoubleClick={() => setTabBarWidth(null)}
                />
              )}
              <div className="terminal-tab-panes">
                {/* Creation order and one shared parent, never the tree's own nesting: panes are
                    absolutely positioned from layoutRects instead, so regrouping or re-splitting
                    never re-parents (and so never remounts/reconnects) a session. */}
                {tabOrder
                  .filter((id) => allTabs.includes(id))
                  .map((tabId) => {
                    const isPrimary = tabId === primaryTabId
                    const rect = activeRects.get(tabId)
                    return (
                      <div
                        key={tabId}
                        data-tab-id={tabId}
                        className={`terminal-tab-pane${
                          activeIsSplit && !zoomedId && tabId === activeTabId
                            ? ' terminal-tab-pane-focused'
                            : ''
                        }${rect && rect.x + rect.w < 0.999 ? ' terminal-tab-pane-border-right' : ''}${
                          rect && rect.y + rect.h < 0.999 ? ' terminal-tab-pane-border-bottom' : ''
                        }${sessionDrag.draggingId === tabId ? ' terminal-tab-pane-dragging' : ''}`}
                        style={
                          rect
                            ? {
                                left: `${rect.x * 100}%`,
                                top: `${rect.y * 100}%`,
                                width: `${rect.w * 100}%`,
                                height: `${rect.h * 100}%`
                              }
                            : { display: 'none' }
                        }
                        onPointerDown={() => setActiveTabId(tabId)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setContextMenu({ tabId, x: e.clientX, y: e.clientY })
                        }}
                      >
                        <TerminalPanel
                          cluster={cluster}
                          reachability={reachability}
                          suspended={hidden}
                          onStatusChange={(status) => {
                            setTabStatuses((prev) =>
                              prev.get(tabId) === status ? prev : new Map(prev).set(tabId, status)
                            )
                            if (isPrimary) onTerminalStatusChange?.(status)
                          }}
                          onCycleTab={handleCycleTab}
                          onSplit={() => handleSplitTab(tabId)}
                          onHeaderPointerDown={(e) => sessionDrag.startDrag(tabId, e)}
                          splitDirection={splitOrientation}
                          maximized={zoomedId === tabId}
                          onToggleMaximize={
                            activeIsSplit
                              ? () => setMaximizedId(zoomedId === tabId ? null : tabId)
                              : undefined
                          }
                          onClose={isPrimary ? undefined : () => handleCloseTab(tabId)}
                          onTitleChange={(title) =>
                            setShellTitles((prev) => {
                              const trimmed = title.trim()
                              if ((prev.get(tabId) ?? '') === trimmed) return prev
                              const next = new Map(prev)
                              if (trimmed) next.set(tabId, trimmed)
                              else next.delete(tabId)
                              return next
                            })
                          }
                        />
                      </div>
                    )
                  })}
                {!hidden &&
                  activeDividers.map((d) => {
                    const row = d.dir === 'row'
                    return (
                      <div
                        key={`${d.path.join('.')}:${d.index}`}
                        className={`terminal-tab-divider terminal-tab-divider-${d.dir}`}
                        style={
                          row
                            ? {
                                left: `${d.at * 100}%`,
                                top: `${d.rect.y * 100}%`,
                                height: `${d.rect.h * 100}%`
                              }
                            : {
                                top: `${d.at * 100}%`,
                                left: `${d.rect.x * 100}%`,
                                width: `${d.rect.w * 100}%`
                              }
                        }
                        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                        onPointerMove={(e) => handleDividerMove(e, d)}
                        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                      />
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
            {!hidden && (
              <StatusPanel
                cluster={cluster}
                reachability={reachability}
                active={visible.includes('status')}
              />
            )}
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
      {contextMenu && (
        <MainPanelContextMenu
          contextMenu={contextMenu}
          primaryTabId={primaryTabId}
          groupLeaves={groupLeaves}
          allTabs={allTabs}
          onDismiss={() => setContextMenu(null)}
          startRename={startRename}
          handleSplitTab={handleSplitTab}
          handleDuplicateTab={handleDuplicateTab}
          extractToStandaloneGroup={extractToStandaloneGroup}
          handleCloseTab={handleCloseTab}
          handleCloseOtherTabs={handleCloseOtherTabs}
          handleCloseAllTabs={handleCloseAllTabs}
        />
      )}
    </div>
  )
}
