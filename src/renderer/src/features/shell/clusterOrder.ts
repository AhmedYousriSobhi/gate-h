import type { ClusterOrder } from '../../../../shared/types'

/** Applies a saved display order to a cluster list. A cluster id missing from `order` (new, or
 *  before the first reorder) keeps its incoming relative position, appended after every cluster
 *  that *is* in `order` - so a freshly added cluster shows up rather than vanishing from the list
 *  until the user manually places it. */
export function orderClusters<T extends { id: string }>(clusters: T[], order: ClusterOrder): T[] {
  const byId = new Map(clusters.map((c) => [c.id, c]))
  const ordered: T[] = []
  for (const id of order) {
    const c = byId.get(id)
    if (c) {
      ordered.push(c)
      byId.delete(id)
    }
  }
  for (const c of clusters) if (byId.has(c.id)) ordered.push(c)
  return ordered
}

/** Moves `draggedId` to just before `targetId` in `order` (a complete id list, e.g. the result of
 *  mapping an already-ordered cluster list) - the new order to persist after a drag-and-drop
 *  reorder. */
export function moveClusterId(
  order: ClusterOrder,
  draggedId: string,
  targetId: string
): ClusterOrder {
  if (draggedId === targetId) return order
  const withoutDragged = order.filter((id) => id !== draggedId)
  const targetIndex = withoutDragged.indexOf(targetId)
  if (targetIndex === -1) return order
  return [...withoutDragged.slice(0, targetIndex), draggedId, ...withoutDragged.slice(targetIndex)]
}
