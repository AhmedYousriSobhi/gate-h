import TabContextMenu from '../terminal/TabContextMenu'

export default function MainPanelContextMenu({
  contextMenu,
  primaryTabId,
  groupLeaves,
  allTabs,
  onDismiss,
  startRename,
  handleSplitTab,
  handleDuplicateTab,
  extractToStandaloneGroup,
  handleCloseTab,
  handleCloseOtherTabs,
  handleCloseAllTabs
}: {
  contextMenu: { tabId: string; x: number; y: number }
  primaryTabId: string
  groupLeaves: string[][]
  allTabs: string[]
  onDismiss: () => void
  startRename: (id: string) => void
  handleSplitTab: (id: string) => void
  handleDuplicateTab: (id: string) => void
  extractToStandaloneGroup: (id: string) => void
  handleCloseTab: (id: string) => void
  handleCloseOtherTabs: (id: string) => void
  handleCloseAllTabs: () => void
}): React.JSX.Element {
  const { tabId } = contextMenu
  const isPrimary = tabId === primaryTabId
  const group = groupLeaves.find((g) => g.includes(tabId))
  const others = allTabs.filter((id) => id !== tabId && id !== primaryTabId)
  return (
    <TabContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      onDismiss={onDismiss}
      onRename={() => startRename(tabId)}
      onSplit={() => handleSplitTab(tabId)}
      onDuplicate={() => handleDuplicateTab(tabId)}
      onUnstack={group && group.length > 1 ? () => extractToStandaloneGroup(tabId) : null}
      onCloseTab={isPrimary ? null : () => handleCloseTab(tabId)}
      onCloseOthers={others.length > 0 ? () => handleCloseOtherTabs(tabId) : null}
      onCloseAll={others.length > 0 ? () => handleCloseAllTabs() : null}
    />
  )
}
