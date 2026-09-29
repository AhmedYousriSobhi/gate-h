// A stack of terminal sessions is a small split tree (like VS Code editor groups or tmux panes),
// so one stack can mix directions - e.g. two sessions side by side above a third full-width one.
// Leaves are session tab ids; a split's children share its space by `sizes` (equal when unset),
// which dragging a divider sets. Any structural change to a split resets its sizes to equal.

export type SplitDir = 'row' | 'column'
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type LayoutNode =
  | { kind: 'leaf'; id: string }
  | { kind: 'split'; dir: SplitDir; children: LayoutNode[]; sizes?: number[] }
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
  if (children.length === 1) return children[0]
  const sizes = children.length === node.children.length ? node.sizes : undefined
  return { ...node, children, sizes }
}

function sizesOf(node: Extract<LayoutNode, { kind: 'split' }>): number[] {
  return node.sizes ?? node.children.map(() => 1 / node.children.length)
}

export function removeLeaf(node: LayoutNode, id: string): LayoutNode | null {
  if (node.kind === 'leaf') return node.id === id ? null : node
  const children = node.children
    .map((c) => removeLeaf(c, id))
    .filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  const sizes = children.length === node.children.length ? node.sizes : undefined
  return normalize({ ...node, children, sizes })
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
    return { ...node, children, sizes: undefined }
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

function childRects(node: Extract<LayoutNode, { kind: 'split' }>, rect: Rect): Rect[] {
  let offset = 0
  return sizesOf(node).map((size) => {
    const r =
      node.dir === 'row'
        ? { x: rect.x + rect.w * offset, y: rect.y, w: rect.w * size, h: rect.h }
        : { x: rect.x, y: rect.y + rect.h * offset, w: rect.w, h: rect.h * size }
    offset += size
    return r
  })
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
  const rects = childRects(node, rect)
  node.children.forEach((child, i) => layoutRects(child, rects[i], out))
  return out
}

/** A draggable boundary between children `index` and `index + 1` of the split at `path` (child
 *  indices from the root). `at` is the boundary's position in the stack, `rect` the split's. */
export interface Divider {
  path: number[]
  index: number
  dir: SplitDir
  rect: Rect
  at: number
}

export function dividers(
  node: LayoutNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
  path: number[] = [],
  out: Divider[] = []
): Divider[] {
  if (node.kind === 'leaf') return out
  const rects = childRects(node, rect)
  node.children.forEach((child, i) => {
    if (i > 0) {
      const at = node.dir === 'row' ? rects[i].x : rects[i].y
      out.push({ path, index: i - 1, dir: node.dir, rect, at })
    }
    dividers(child, rects[i], [...path, i], out)
  })
  return out
}

// Smallest share either neighbour can be squeezed to while dragging a divider.
const MIN_SIZE = 0.1

/** Moves the boundary after child `index` of the split at `path` to `fraction` (0..1 across that
 *  split), trading space only between the two children beside it. */
export function resizeSplit(
  node: LayoutNode,
  path: number[],
  index: number,
  fraction: number
): LayoutNode {
  if (node.kind === 'leaf') return node
  if (path.length > 0) {
    const [head, ...rest] = path
    return {
      ...node,
      children: node.children.map((c, i) =>
        i === head ? resizeSplit(c, rest, index, fraction) : c
      )
    }
  }
  const sizes = [...sizesOf(node)]
  const start = sizes.slice(0, index).reduce((a, b) => a + b, 0)
  const end = start + sizes[index] + sizes[index + 1]
  const at = Math.min(end - MIN_SIZE, Math.max(start + MIN_SIZE, fraction))
  sizes[index] = at - start
  sizes[index + 1] = end - at
  return { ...node, sizes }
}
