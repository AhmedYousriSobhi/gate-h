import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { SessionStatus } from '../terminal/TerminalPanel'
import { useSessionDrag } from '../terminal/useSessionDrag'
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
  type Divider,
  type Edge,
  type LayoutNode,
  type Rect,
  type SplitDir
} from '../terminal/splitLayout'

const TAB_BAR_MIN_WIDTH = 120
const TAB_BAR_MAX_WIDTH = 480

const removeEverywhere = (prev: LayoutNode[], ids: Set<string>): LayoutNode[] =>
  prev
    .map((g) => [...ids].reduce<LayoutNode | null>((n, id) => (n ? removeLeaf(n, id) : n), g))
    .filter((g): g is LayoutNode => g !== null)

interface ContextMenuTarget {
  tabId: string
  x: number
  y: number
}

interface UseTerminalTabsResult {
  primaryTabId: string
  groupLeaves: string[][]
  tabNumbers: Map<string, number>
  tabStatuses: Map<string, SessionStatus>
  setTabStatuses: Dispatch<SetStateAction<Map<string, SessionStatus>>>
  tabLabels: Map<string, string>
  activeTabId: string
  setActiveTabId: Dispatch<SetStateAction<string>>
  tabOrientation: 'horizontal' | 'vertical'
  setTabOrientation: Dispatch<SetStateAction<'horizontal' | 'vertical'>>
  splitOrientation: 'horizontal' | 'vertical'
  renamingId: string | null
  setRenamingId: Dispatch<SetStateAction<string | null>>
  renameValue: string
  setRenameValue: Dispatch<SetStateAction<string>>
  handleAddTab: () => void
  handleSplitTab: (sourceId: string) => void
  handleCloseTab: (id: string) => void
  handleCloseOtherTabs: (keepId: string) => void
  handleCloseAllTabs: () => void
  handleDuplicateTab: (sourceId: string) => void
  extractToStandaloneGroup: (id: string) => void
  sessionDrag: ReturnType<typeof useSessionDrag>
  startRename: (id: string) => void
  commitRename: () => void
  contextMenu: ContextMenuTarget | null
  setContextMenu: Dispatch<SetStateAction<ContextMenuTarget | null>>
  handleSplitOrientationChange: (next: 'horizontal' | 'vertical') => void
  tabBarWidth: number | null
  setTabBarWidth: Dispatch<SetStateAction<number | null>>
  handleTabBarResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void
  tabOrder: string[]
  allTabs: string[]
  activeRects: Map<string, Rect>
  activeIsSplit: boolean
  zoomedId: string | null
  handleCycleTab: (direction: 1 | -1) => void
  setShellTitles: Dispatch<SetStateAction<Map<string, string>>>
  activeDividers: Divider[]
  handleDividerMove: (e: React.PointerEvent<HTMLDivElement>, divider: Divider) => void
  setMaximizedId: Dispatch<SetStateAction<string | null>>
}

/** MainPanel's tab-group/split-layout state machine - the sessions a cluster's terminal pane
 *  shows, how they're grouped into stacks, and the stacks' own split tree (see splitLayout.ts).
 *  Pulled out of MainPanel into a hook (not a child component) deliberately: every one of these
 *  pieces of state closes over several of the others, and a hook keeps the exact same render tree
 *  - no new component boundary that could remount a session or shift effect timing - while still
 *  getting the state/handlers out of MainPanel's own function body. */
export function useTerminalTabs({
  activeMonitoring,
  onLiveSessionCountChange
}: {
  activeMonitoring: boolean
  onLiveSessionCountChange?: (count: number) => void
}): UseTerminalTabsResult {
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
  const liveSessionCount = activeMonitoring
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
  // Null until the side tab list's divider is dragged - it then keeps the dragged width.
  const [tabBarWidth, setTabBarWidth] = useState<number | null>(null)
  // Direction for splits that don't come with one of their own (the split button/shortcut, a
  // tab-strip merge). Dropping on a panel's edge picks its own direction instead.
  const [defaultSplit, setDefaultSplit] = useState<SplitDir>('column')
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
  const splitOrientation: 'horizontal' | 'vertical' =
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

  // The side tab list's divider: its width follows the pointer from the list's left edge, within
  // bounds that keep both titles and the terminal usable. Double-click returns it to auto width.
  function handleTabBarResizeMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.buttons !== 1) return
    const tabBar = e.currentTarget.previousElementSibling
    if (!tabBar) return
    const left = tabBar.getBoundingClientRect().left
    setTabBarWidth(
      Math.round(Math.min(TAB_BAR_MAX_WIDTH, Math.max(TAB_BAR_MIN_WIDTH, e.clientX - left)))
    )
  }

  return {
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
  }
}
