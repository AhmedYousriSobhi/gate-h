import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Columns2, Power, Puzzle, Rows2 } from 'lucide-react'
import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import TerminalPanel, { type SessionStatus } from '../terminal/TerminalPanel'
import TerminalTabBar from '../terminal/TerminalTabBar'
import { useSessionDrag } from '../terminal/useSessionDrag'
import TabContextMenu from '../terminal/TabContextMenu'
import {
  dividers,
  insertBeside,
  resizeSplit,
  layoutRects,
  leaf,
  leaves,
  removeLeaf,
  setRootDir,
  swapLeaves,
  type Edge,
  type LayoutNode,
  type SplitDir
} from '../terminal/splitLayout'
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
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  // The primary tab is the session whose status the sidebar shows - identified by a stable id
  // rather than position, so it can be dragged anywhere like any other tab; it just can't be
  // closed. Every tab (in every stack, not just the visible one) stays mounted for as long as this
  // MainPanel instance does, hidden or not.
  const [primaryTabId] = useState(() => crypto.randomUUID())
  // One split tree per stack (see splitLayout.ts): sessions dragged together are shown at once,
  // arranged by the tree - which can mix directions, e.g. two side by side above a third - while
  // separate stacks are reached by clicking/cycling between them. A new tab starts as its own stack.
  const [groups, setGroups] = useState<LayoutNode[]>(() => [leaf(primaryTabId)])
  const [activeTabId, setActiveTabId] = useState<string>(primaryTabId)
  // Creation order, not display order - a tab's "Session N" label comes from here so it stays put
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
  // Standby unmounts every session, but tabStatuses keeps their last readings.
  const liveSessionCount = cluster.activeMonitoring
    ? [...tabStatuses.values()].filter((status) => status === 'connected').length
    : 0
  useEffect(() => {
    onLiveSessionCountChange?.(liveSessionCount)
  }, [liveSessionCount, onLiveSessionCountChange])
  // What each session's remote shell titles its window (e.g. `vagrant@compute-node: ~/logs`) -
  // tells same-host sessions apart by where they are, without anyone having to rename them.
  const [shellTitles, setShellTitles] = useState<Map<string, string>>(() => new Map())
  // Rename editing lives here (not in TerminalTabBar) so both the tab strip's double-click and
  // the context menu's "Rename" - triggered from either the strip or a session panel - can start
  // the same edit.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null
  )
  // Vertical (a list down the side) matches VS Code's terminal tab default; horizontal (a row
  // above the terminal, like typical editor tabs) is the alternative, chosen in the layout menu.
  const [tabOrientation, setTabOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  // Direction for splits that don't come with one of their own (the split button/shortcut, a
  // tab-strip merge). Dropping on a panel's edge picks its own direction instead.
  const [defaultSplit, setDefaultSplit] = useState<SplitDir>('column')
  const { visible, orientation } = layout
  const ratio = dragRatio ?? layout.splitRatio ?? 0.5
  const groupLeaves = useMemo(() => groups.map(leaves), [groups])
  const allTabs = useMemo(() => groupLeaves.flat(), [groupLeaves])
  const activeGroupIndex = Math.max(
    0,
    groupLeaves.findIndex((ids) => ids.includes(activeTabId))
  )
  const activeGroup = groups[activeGroupIndex]
  const activeIsSplit = activeGroup.kind === 'split'
  // A session "maximized" over its stack (header toolbar) fills the stack's area; the others stay
  // mounted and connected, just hidden. Only counts while it's still in the visible, split stack,
  // so closing, moving or unstacking it simply ends the maximize.
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  const zoomedId =
    maximizedId && activeIsSplit && groupLeaves[activeGroupIndex].includes(maximizedId)
      ? maximizedId
      : null
  const activeRects = useMemo(
    () => (zoomedId ? new Map([[zoomedId, { x: 0, y: 0, w: 1, h: 1 }]]) : layoutRects(activeGroup)),
    [activeGroup, zoomedId]
  )
  // What the layout menu shows as selected: the visible stack's own outer direction if it's
  // split, otherwise the default a new split would use.
  const splitOrientation =
    (activeIsSplit ? activeGroup.dir : defaultSplit) === 'row' ? 'horizontal' : 'vertical'
  const defaultEdge: Edge = defaultSplit === 'row' ? 'right' : 'bottom'

  // A rename wins, then the shell's own title, then "Session N".
  const tabTitle = useCallback(
    (id: string): string =>
      tabTitles.get(id) ?? shellTitles.get(id) ?? `Session ${tabNumbers.get(id)}`,
    [tabTitles, shellTitles, tabNumbers]
  )
  const tabLabels = useMemo(
    () => new Map(allTabs.map((id) => [id, tabTitle(id)])),
    [allTabs, tabTitle]
  )

  const handleAddTab = useCallback((): void => {
    const id = crypto.randomUUID()
    setGroups((prev) => [...prev, leaf(id)])
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
    setShellTitles((prev) => {
      if (![...prev.keys()].some((id) => ids.has(id))) return prev
      return new Map([...prev].filter(([id]) => !ids.has(id)))
    })
  }, [])

  const removeEverywhere = (prev: LayoutNode[], ids: Set<string>): LayoutNode[] =>
    prev
      .map((g) => [...ids].reduce<LayoutNode | null>((n, id) => (n ? removeLeaf(n, id) : n), g))
      .filter((g): g is LayoutNode => g !== null)

  const handleCloseTab = useCallback(
    (id: string): void => {
      if (id === primaryTabId) return
      setGroups((prev) => removeEverywhere(prev, new Set([id])))
      dropFromMaps(new Set([id]))
      if (activeTabId === id) {
        const siblings = groupLeaves.find((g) => g.includes(id))?.filter((t) => t !== id) ?? []
        setActiveTabId(siblings[0] ?? primaryTabId)
      }
    },
    [activeTabId, groupLeaves, primaryTabId, dropFromMaps]
  )

  // Keeps `keepId` and the primary tab, closes everything else.
  const handleCloseOtherTabs = useCallback(
    (keepId: string): void => {
      const closed = new Set(allTabs.filter((id) => id !== keepId && id !== primaryTabId))
      if (closed.size === 0) return
      setGroups((prev) => removeEverywhere(prev, closed))
      dropFromMaps(closed)
      setActiveTabId(keepId)
    },
    [allTabs, primaryTabId, dropFromMaps]
  )

  const handleCloseAllTabs = useCallback((): void => {
    const closed = new Set(allTabs.filter((id) => id !== primaryTabId))
    if (closed.size === 0) return
    setGroups([leaf(primaryTabId)])
    dropFromMaps(closed)
    setActiveTabId(primaryTabId)
  }, [allTabs, primaryTabId, dropFromMaps])

  // Opens a brand-new session as its own stack right after `sourceId`'s - same session semantics
  // as the "+" button, just placed by the tab that was duplicated instead of at the end.
  const handleDuplicateTab = useCallback((sourceId: string): void => {
    const newId = crypto.randomUUID()
    setGroups((prev) => {
      const groupIndex = prev.findIndex((g) => leaves(g).includes(sourceId))
      if (groupIndex === -1) return prev
      const next = prev.slice()
      next.splice(groupIndex + 1, 0, leaf(newId))
      return next
    })
    setTabOrder((prev) => [...prev, newId])
    setActiveTabId(newId)
  }, [])

  // VS Code's "Split Terminal": a new session beside `sourceId`, in the default direction.
  const handleSplitTab = useCallback(
    (sourceId: string): void => {
      const newId = crypto.randomUUID()
      setMaximizedId(null)
      setGroups((prev) =>
        prev.map((g) =>
          leaves(g).includes(sourceId) ? insertBeside(g, sourceId, newId, defaultEdge) : g
        )
      )
      setTabOrder((prev) => [...prev, newId])
      setActiveTabId(newId)
    },
    [defaultEdge]
  )

  // Pulls `id` out of its current stack into its own - the same outcome as dropping it on empty
  // tab-strip space, also reachable from the context menu's "Unstack".
  const extractToStandaloneGroup = useCallback((id: string): void => {
    setGroups((prev) => {
      const from = prev.find((g) => leaves(g).includes(id))
      if (!from || from.kind === 'leaf') return prev
      return [...removeEverywhere(prev, new Set([id])), leaf(id)]
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

  // Moves dragId out of wherever it is and beside targetId on `edge` - shared by tab-strip merges
  // and panel-edge drops, which differ only in how the edge is chosen.
  const moveBeside = useCallback((dragId: string, targetId: string, edge: Edge): void => {
    setMaximizedId(null)
    setGroups((prev) =>
      removeEverywhere(prev, new Set([dragId])).map((g) =>
        leaves(g).includes(targetId) ? insertBeside(g, targetId, dragId, edge) : g
      )
    )
    setActiveTabId(dragId)
  }, [])

  // The single drop handler behind every drag gesture in the tab strip. `zone` (see
  // TerminalTabBar) is which part of dropId's tab was hovered: within the same stack, any drop
  // swaps the two sessions' places; across stacks, the middle ('merge') adds dragId beside dropId
  // in the default direction, while the outer strips ('before'/'after') instead reposition dragId
  // as its own stack next to dropId's - without that, dropping one standalone tab onto another
  // would always merge them, leaving no way to just reorder. Dropping on empty strip space
  // (dropId null) pops dragId out into its own stack.
  const handleDropTab = useCallback(
    (dragId: string, dropId: string | null, zone: 'before' | 'after' | 'merge'): void => {
      if (dragId === dropId) return
      if (dropId === null) {
        extractToStandaloneGroup(dragId)
        setActiveTabId(dragId)
        return
      }
      const from = groupLeaves.findIndex((g) => g.includes(dragId))
      const to = groupLeaves.findIndex((g) => g.includes(dropId))
      if (from === -1 || to === -1) return
      if (from === to) {
        setGroups((prev) => prev.map((g, i) => (i === from ? swapLeaves(g, dragId, dropId) : g)))
        setActiveTabId(dragId)
        return
      }
      if (zone === 'merge') {
        moveBeside(dragId, dropId, defaultEdge)
        return
      }
      setGroups((prev) => {
        const without = removeEverywhere(prev, new Set([dragId]))
        const target = without.findIndex((g) => leaves(g).includes(dropId))
        without.splice(zone === 'before' ? target : target + 1, 0, leaf(dragId))
        return without
      })
      setActiveTabId(dragId)
    },
    [groupLeaves, extractToStandaloneGroup, moveBeside, defaultEdge]
  )

  // A tab dropped onto a session panel's edge (VS Code's drag-to-split): it goes on that side of
  // that one panel only, nesting a new split when needed - so a stack can become a grid, e.g.
  // two side by side above a third, without re-laying out anything else.
  const handlePaneDrop = useCallback(
    (dragId: string, paneId: string, edge: Edge): void => {
      if (dragId === paneId) return
      moveBeside(dragId, paneId, edge)
    },
    [moveBeside]
  )

  // The layout menu's "Split sessions" choice: flips the visible stack's outer split and becomes
  // the default for future splits.
  const handleSplitOrientationChange = useCallback(
    (next: 'horizontal' | 'vertical'): void => {
      const dir: SplitDir = next === 'horizontal' ? 'row' : 'column'
      setDefaultSplit(dir)
      setGroups((prev) => prev.map((g, i) => (i === activeGroupIndex ? setRootDir(g, dir) : g)))
    },
    [activeGroupIndex]
  )

  // Ctrl/Cmd+Tab (+Shift to reverse), forwarded up from whichever tab's terminal currently has
  // focus - see TerminalPanel's onCycleTab prop. Cycles every tab across every stack, wrapping
  // around in both directions - which stack becomes visible follows from activeGroup.
  const handleCycleTab = useCallback(
    (direction: 1 | -1): void => {
      setActiveTabId((current) => {
        const idx = allTabs.indexOf(current)
        return allTabs[(idx + direction + allTabs.length) % allTabs.length]
      })
    },
    [allTabs]
  )

  const sessionDrag = useSessionDrag({
    stripOrientation: tabOrientation,
    onDrop: handleDropTab,
    onPaneDrop: handlePaneDrop
  })
  const activeDividers = useMemo(
    () => (zoomedId ? [] : dividers(activeGroup)),
    [activeGroup, zoomedId]
  )

  // Dragging the border between two sessions in the visible stack - resizes live, trading space
  // only between the two sessions either side of it.
  function handleDividerMove(
    e: React.PointerEvent<HTMLDivElement>,
    divider: (typeof activeDividers)[number]
  ): void {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const container = e.currentTarget.parentElement
    if (!container) return
    const box = container.getBoundingClientRect()
    const { rect } = divider
    const fraction =
      divider.dir === 'row'
        ? ((e.clientX - box.left) / box.width - rect.x) / rect.w
        : ((e.clientY - box.top) / box.height - rect.y) / rect.h
    setGroups((prev) =>
      prev.map((g, i) =>
        i === activeGroupIndex ? resizeSplit(g, divider.path, divider.index, fraction) : g
      )
    )
  }

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
              />
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
            {!hidden && <StatusPanel cluster={cluster} reachability={reachability} />}
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
          const group = groupLeaves.find((g) => g.includes(tabId))
          const others = allTabs.filter((id) => id !== tabId && id !== primaryTabId)
          return (
            <TabContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onDismiss={() => setContextMenu(null)}
              onRename={() => startRename(tabId)}
              onSplit={() => handleSplitTab(tabId)}
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
