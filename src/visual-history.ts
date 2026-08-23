export interface VisualSelectionPoint { path: number[]; offset: number }
export interface VisualSnapshot { html: string; anchor?: VisualSelectionPoint; focus?: VisualSelectionPoint }

function point(root: HTMLElement, node: Node | null, offset: number): VisualSelectionPoint | undefined {
  if (!node || !root.contains(node)) return undefined
  const path: number[] = []; let current: Node | null = node
  while (current && current !== root) {
    const parent: Node | null = current.parentNode
    if (!parent) return undefined
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current)); current = parent
  }
  return current === root ? { path, offset } : undefined
}

function nodeAt(root: HTMLElement, path: readonly number[]): Node | null {
  let current: Node = root
  for (const index of path) { const next: ChildNode | undefined = current.childNodes[index]; if (!next) return null; current = next }
  return current
}

function boundedOffset(node: Node, offset: number): number {
  return Math.max(0, Math.min(offset, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length))
}

export function captureVisualSnapshot(root: HTMLElement, selection: Selection | null = document.getSelection()): VisualSnapshot {
  return {
    html: root.innerHTML,
    anchor: point(root, selection?.anchorNode ?? null, selection?.anchorOffset ?? 0),
    focus: point(root, selection?.focusNode ?? null, selection?.focusOffset ?? 0),
  }
}

export function restoreVisualSnapshot(root: HTMLElement, snapshot: VisualSnapshot, selection: Selection | null = document.getSelection()): boolean {
  root.innerHTML = snapshot.html
  const anchor = snapshot.anchor && nodeAt(root, snapshot.anchor.path)
  const focus = snapshot.focus && nodeAt(root, snapshot.focus.path)
  if (!selection || !anchor || !focus || !snapshot.anchor || !snapshot.focus) return false
  selection.setBaseAndExtent(anchor, boundedOffset(anchor, snapshot.anchor.offset), focus, boundedOffset(focus, snapshot.focus.offset))
  return true
}
