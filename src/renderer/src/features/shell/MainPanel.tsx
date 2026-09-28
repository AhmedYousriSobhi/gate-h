import { useCallback, useMemo, useState } from 'react'
import { ArrowLeftRight, Columns2, Power, Puzzle, Rows2 } from 'lucide-react'
import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import TerminalPanel, { type SessionStatus } from '../terminal/TerminalPanel'
import TerminalTabBar from '../terminal/TerminalTabBar'
import TabContextMenu from '../terminal/TabContextMenu'
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
  // The primary tab is this cluster's pinned session - the one keepAliveInBackground/standby
  // apply to (see AppShell's `hidden` prop) - identified by a stable id rather than array
  // position, since dragging can now move any other tab into or out of its group. It can't be
  // closed or dragged itself, but other tabs can be dropped onto it to join its group. Every tab
  // (in every group, not just the active one) stays mounted for as long as this MainPanel instance
  // does - only the `hidden` check below (this cluster isn't selected) tears a non-primary tab's
  // session down, not merely being in an inactive group.
  const [primaryTabId] = useState(() => crypto.randomUUID())
  // Tabs the user has dragged onto each other are "stacked" - shown split, simultaneously, per
  // tabOrientation - while separate groups are reached by clicking/cycling between them, one at a
  // time. A fresh tab always starts in its own standalone group.
  const [groups, setGroups] = useState<string[][]>(() => [[primaryTabId]])
  const [activeTabId, setActiveTabId] = useState<string>(primaryTabId)
  // Creation order, not display order - a tab's "Tab N" label comes from here so it stays put
  // across reorders/regroups instead of relabeling every tab whenever positions shift.
  const [tabOrder, setTabOrder] = useState<string[]>(() => [primaryTabId])
  const tabNumbers = useMemo(
    () => new Map(tabOrder.map((id, index) => [id, index + 1])),
    [tabOrder]
  )
  // Every tab's own connection status (not just the primary's) - drives that tab's status dot in
  // TerminalTabBar. tabTitles holds only the tabs a user has actually renamed; anything absent
  // falls back to "Session N" (tabNumbers) in TerminalTabBar.
  const [tabStatuses, setTabStatuses] = useState<Map<string, SessionStatus>>(() => new Map())
  const [tabTitles, setTabTitles] = useState<Map<string, string>>(() => new Map())
  // Rename editing lives here (not in TerminalTabBar) so both the tab strip's double-click and
  // the context menu's "Rename" - triggered from either the strip or a session panel - can start
  // the same edit.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null
  )
  // Vertical (a list down the side) matches VS Code's terminal tab default; horizontal (a row
  // above the terminal, like typical editor tabs) is the alternative, toggled in TerminalTabBar.
  const [tabOrientation, setTabOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  // Independent of tabOrientation - a stacked group's panes can be shown side by side
  // ('horizontal') or stacked top/bottom ('vertical') regardless of which way the tab strip
  // itself is laid out, so a vertical tab sidebar isn't forced into a top/bottom split.
  const [splitOrientation, setSplitOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  const { visible, orientation } = layout
  const ratio = dragRatio ?? layout.splitRatio ?? 0.5
  const activeGroup = groups.find((g) => g.includes(activeTabId)) ?? groups[0]

  const tabTitle = useCallback(
    (id: string): string => tabTitles.get(id) ?? `Session ${tabNumbers.get(id)}`,
    [tabTitles, tabNumbers]
  )

  const handleAddTab = useCallback((): void => {
    const id = crypto.randomUUID()
    setGroups((prev) => [...prev, [id]])
    setTabOrder((prev) => [...prev, id])
    setActiveTabId(id)
  }, [])

  // Shared by every "this tab id no longer exists" path (close one, close others, close all) -
  // tabStatuses/tabTitles would otherwise accumulate entries for tabs that can never come back.
  const dropFromMaps = useCallback((ids: Set<string>): void => {
    setTabStatuses((prev) => {
      if (![...prev.keys()].some((id) => ids.has(id))) return prev
      return new Map([...prev].filter(([id]) => !ids.has(id)))
    })
    setTabTitles((prev) => {
      if (![...prev.keys()].some((id) => ids.has(id))) return prev
      return new Map([...prev].filter(([id]) => !ids.has(id)))
    })
  }, [])

  const handleCloseTab = useCallback(
    (id: string): void => {
      if (id === primaryTabId) return
      setGroups((prev) => prev.map((g) => g.filter((t) => t !== id)).filter((g) => g.length > 0))
      dropFromMaps(new Set([id]))
      if (activeTabId === id) {
        const siblings = groups.find((g) => g.includes(id))?.filter((t) => t !== id) ?? []
        setActiveTabId(siblings[0] ?? primaryTabId)
      }
    },
    [activeTabId, groups, primaryTabId, dropFromMaps]
  )

  // Keeps `keepId` and the primary tab, closes everything else.
  const handleCloseOtherTabs = useCallback(
    (keepId: string): void => {
      const closed = new Set(groups.flat().filter((id) => id !== keepId && id !== primaryTabId))
      if (closed.size === 0) return
      setGroups((prev) =>
        prev.map((g) => g.filter((t) => !closed.has(t))).filter((g) => g.length > 0)
      )
      dropFromMaps(closed)
      setActiveTabId(keepId)
    },
    [groups, primaryTabId, dropFromMaps]
  )

  const handleCloseAllTabs = useCallback((): void => {
    const closed = new Set(groups.flat().filter((id) => id !== primaryTabId))
    if (closed.size === 0) return
    setGroups([[primaryTabId]])
    dropFromMaps(closed)
    setActiveTabId(primaryTabId)
  }, [groups, primaryTabId, dropFromMaps])

  // Opens a brand-new session positioned right next to `sourceId` (its own standalone group, not
  // merged into sourceId's) - same session semantics as the "+" button, just placed by the tab
  // that was duplicated rather than always appended at the end.
  const handleDuplicateTab = useCallback((sourceId: string): void => {
    const newId = crypto.randomUUID()
    setGroups((prev) => {
      const groupIndex = prev.findIndex((g) => g.includes(sourceId))
      if (groupIndex === -1) return prev
      const next = prev.slice()
      next.splice(groupIndex + 1, 0, [newId])
      return next
    })
    setTabOrder((prev) => [...prev, newId])
    setActiveTabId(newId)
  }, [])

  // Pulls `id` out of its current group into its own standalone one - the same outcome as
  // dropping it on empty tab-strip space, also reachable from the context menu's "Unstack".
  const extractToStandaloneGroup = useCallback((id: string): void => {
    setGroups((prev) => {
      const fromIndex = prev.findIndex((g) => g.includes(id))
      if (fromIndex === -1 || prev[fromIndex].length === 1) return prev
      const next = prev.map((g, i) => (i === fromIndex ? g.filter((t) => t !== id) : g))
      next.push([id])
      return next
    })
  }, [])

  const startRename = useCallback(
    (id: string): void => {
      setRenameValue(tabTitle(id))
      setRenamingId(id)
    },
    [tabTitle]
  )

  // An empty/whitespace-only title clears the override, reverting the tab to its default
  // "Session N" label rather than leaving it stuck on a blank string.
  const commitRename = useCallback((): void => {
    const id = renamingId
    if (!id) return
    const trimmed = renameValue.trim()
    setTabTitles((prev) => {
      const next = new Map(prev)
      if (trimmed) next.set(id, trimmed)
      else next.delete(id)
      return next
    })
    setRenamingId(null)
  }, [renamingId, renameValue])

  // The single drop handler behind every drag gesture in the tab strip. `zone` (see
  // TerminalTabBar) is which third of dropId's tab was hovered: dropping within the same group
  // always just reorders that group's pane order regardless of zone; across groups, the middle
  // third ('merge') stacks dragId into dropId's group (shown split together), while the outer
  // thirds ('before'/'after') instead reposition dragId as its own standalone group next to
  // dropId's - without that split, dropping one standalone tab onto another would always merge
  // them, leaving no way to just swap two ungrouped tabs' positions. Dropping on empty strip
  // space (dropId null) pops dragId back out into its own standalone group. The primary tab can
  // never be the one dragged, though it's a valid drop target - other tabs can still join its
  // group.
  const handleDropTab = useCallback(
    (dragId: string, dropId: string | null, zone: 'before' | 'after' | 'merge'): void => {
      if (dragId === primaryTabId || dragId === dropId) return
      if (dropId === null) {
        extractToStandaloneGroup(dragId)
        setActiveTabId(dragId)
        return
      }
      setGroups((prev) => {
        const fromIndex = prev.findIndex((g) => g.includes(dragId))
        if (fromIndex === -1) return prev

        const toIndex = prev.findIndex((g) => g.includes(dropId))
        if (toIndex === -1) return prev

        if (fromIndex === toIndex) {
          const group = [...prev[fromIndex]]
          group.splice(group.indexOf(dragId), 1)
          group.splice(group.indexOf(dropId), 0, dragId)
          return prev.map((g, i) => (i === fromIndex ? group : g))
        }

        if (zone === 'merge') {
          const withoutDrag = prev.map((g) => g.filter((t) => t !== dragId))
          const toGroup = [...withoutDrag[toIndex]]
          toGroup.splice(toGroup.indexOf(dropId) + 1, 0, dragId)
          return withoutDrag
            .map((g, i) => (i === toIndex ? toGroup : g))
            .filter((g) => g.length > 0)
        }

        const withoutDrag = prev
          .map((g) => g.filter((t) => t !== dragId))
          .filter((g) => g.length > 0)
        const targetGroupIndex = withoutDrag.findIndex((g) => g.includes(dropId))
        withoutDrag.splice(zone === 'before' ? targetGroupIndex : targetGroupIndex + 1, 0, [dragId])
        return withoutDrag
      })
      setActiveTabId(dragId)
    },
    [primaryTabId, extractToStandaloneGroup]
  )

  // Ctrl/Cmd+Tab (+Shift to reverse), forwarded up from whichever tab's terminal currently has
  // focus - see TerminalPanel's onCycleTab prop. Cycles every tab across every group (flattened),
  // wrapping around in both directions - which group becomes visible follows from activeGroup.
  const handleCycleTab = useCallback(
    (direction: 1 | -1): void => {
      const flat = groups.flat()
      setActiveTabId((current) => {
        const idx = flat.indexOf(current)
        return flat[(idx + direction + flat.length) % flat.length]
      })
    },
    [groups]
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
                groups={groups}
                tabNumbers={tabNumbers}
                statuses={tabStatuses}
                titles={tabTitles}
                activeTabId={activeTabId}
                primaryTabId={primaryTabId}
                orientation={tabOrientation}
                splitOrientation={splitOrientation}
                renamingId={renamingId}
                renameValue={renameValue}
                onSelect={setActiveTabId}
                onAdd={handleAddTab}
                onClose={handleCloseTab}
                onDrop={handleDropTab}
                onStartRename={startRename}
                onRenameValueChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingId(null)}
                onContextMenu={(id, x, y) => setContextMenu({ tabId: id, x, y })}
                onOrientationChange={setTabOrientation}
                onSplitOrientationChange={setSplitOrientation}
              />
              <div
                className={`terminal-tab-panes${
                  activeGroup.length > 1 ? ` terminal-tab-panes-split-${splitOrientation}` : ''
                }`}
              >
                {groups.flat().map((tabId) => {
                  const isPrimary = tabId === primaryTabId
                  if (!isPrimary && hidden) return null
                  const isVisible = activeGroup.includes(tabId)
                  return (
                    <div
                      key={tabId}
                      data-tab-id={tabId}
                      className={`terminal-tab-pane${
                        activeGroup.length > 1 && tabId === activeTabId
                          ? ' terminal-tab-pane-focused'
                          : ''
                      }`}
                      style={{ display: isVisible ? 'flex' : 'none' }}
                      onPointerDown={() => setActiveTabId(tabId)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ tabId, x: e.clientX, y: e.clientY })
                      }}
                    >
                      <TerminalPanel
                        cluster={cluster}
                        reachability={reachability}
                        onStatusChange={(status) => {
                          setTabStatuses((prev) =>
                            prev.get(tabId) === status ? prev : new Map(prev).set(tabId, status)
                          )
                          if (isPrimary) onTerminalStatusChange?.(status)
                        }}
                        onCycleTab={handleCycleTab}
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
      {contextMenu &&
        (() => {
          const { tabId } = contextMenu
          const isPrimary = tabId === primaryTabId
          const group = groups.find((g) => g.includes(tabId))
          const others = groups.flat().filter((id) => id !== tabId && id !== primaryTabId)
          return (
            <TabContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onDismiss={() => setContextMenu(null)}
              onRename={() => startRename(tabId)}
              onDuplicate={() => handleDuplicateTab(tabId)}
              onUnstack={group && group.length > 1 ? () => extractToStandaloneGroup(tabId) : null}
              onCloseTab={isPrimary ? null : () => handleCloseTab(tabId)}
              onCloseOthers={others.length > 0 ? () => handleCloseOtherTabs(tabId) : null}
              onCloseAll={others.length > 0 ? () => handleCloseAllTabs() : null}
            />
          )
        })()}
    </div>
  )
}
