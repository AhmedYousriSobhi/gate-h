// A stack of terminal sessions is a small split tree (like VS Code editor groups or tmux panes),
// so one stack can mix directions - e.g. two sessions side by side above a third full-width one.
// Leaves are session tab ids; a split's children share its space equally along its direction.

export type SplitDir = 'row' | 'column'
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type LayoutNode =
  { kind: 'leaf'; id: string } | { kind: 'split'; dir: SplitDir; children: LayoutNode[] }
/** Fractions (0..1) of the stack's area. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function leaf(id: string): LayoutNode {
  return { kind: 'leaf', id }
}

/** Reading order - also the order a stack's tabs are listed in the tab strip. */
export function leaves(node: LayoutNode): string[] {
  return node.kind === 'leaf' ? [node.id] : node.children.flatMap(leaves)
}

export function edgeDir(edge: Edge): SplitDir {
  return edge === 'left' || edge === 'right' ? 'row' : 'column'
}

// Collapses one-child splits and folds a child split into its parent when both run the same
// direction, so the tree never carries structure that has no visible effect.
function normalize(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node
  const children = node.children
    .map(normalize)
    .flatMap((c) => (c.kind === 'split' && c.dir === node.dir ? c.children : [c]))
  return children.length === 1 ? children[0] : { ...node, children }
}

export function removeLeaf(node: LayoutNode, id: string): LayoutNode | null {
  if (node.kind === 'leaf') return node.id === id ? null : node
  const children = node.children
    .map((c) => removeLeaf(c, id))
    .filter((c): c is LayoutNode => c !== null)
  return children.length === 0 ? null : normalize({ ...node, children })
}

/** Places `newId` on `edge`'s side of `targetId`: a new sibling when the surrounding split
 *  already runs that way, otherwise a nested split replacing the target. */
export function insertBeside(
  node: LayoutNode,
  targetId: string,
  newId: string,
  edge: Edge
): LayoutNode {
  const dir = edgeDir(edge)
  const before = edge === 'left' || edge === 'top'
  if (node.kind === 'leaf') {
    if (node.id !== targetId) return node
    return { kind: 'split', dir, children: before ? [leaf(newId), node] : [node, leaf(newId)] }
  }
  const index = node.children.findIndex((c) => c.kind === 'leaf' && c.id === targetId)
  if (index !== -1 && node.dir === dir) {
    const children = [...node.children]
    children.splice(before ? index : index + 1, 0, leaf(newId))
    return { ...node, children }
  }
  return normalize({
    ...node,
    children: node.children.map((c) => insertBeside(c, targetId, newId, edge))
  })
}

export function swapLeaves(node: LayoutNode, a: string, b: string): LayoutNode {
  if (node.kind === 'leaf') {
    return node.id === a ? leaf(b) : node.id === b ? leaf(a) : node
  }
  return { ...node, children: node.children.map((c) => swapLeaves(c, a, b)) }
}

/** Flips the stack's outermost split - what the layout menu's "Split sessions" choice changes. */
export function setRootDir(node: LayoutNode, dir: SplitDir): LayoutNode {
  return node.kind === 'leaf' ? node : normalize({ ...node, dir })
}

export function layoutRects(
  node: LayoutNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
  out: Map<string, Rect> = new Map()
): Map<string, Rect> {
  if (node.kind === 'leaf') {
    out.set(node.id, rect)
    return out
  }
  const n = node.children.length
  node.children.forEach((child, i) => {
    layoutRects(
      child,
      node.dir === 'row'
        ? { x: rect.x + (rect.w * i) / n, y: rect.y, w: rect.w / n, h: rect.h }
        : { x: rect.x, y: rect.y + (rect.h * i) / n, w: rect.w, h: rect.h / n },
      out
    )
  })
  return out
}
