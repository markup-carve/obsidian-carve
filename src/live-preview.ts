import { type EditorMappedNode, type EditorSession, createEditorSession } from '@markup-carve/carve'
import { type Extension, type SelectionRange } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'

export type LivePresentation =
  | { kind: 'heading'; from: number; to: number; level: number }
  | { kind: 'line'; at: number; className: string }
  | { kind: 'hide'; from: number; to: number }
  | { kind: 'mark'; from: number; to: number; className: string }
  | { kind: 'widget'; at: number; label: string; className: string }

export const LIVE_PREVIEW_IDLE_MS = 120
export const LIVE_PREVIEW_MAX_SOURCE_LENGTH = 250_000
export function livePreviewDelay(sourceLength: number): number | null {
  return sourceLength <= LIVE_PREVIEW_MAX_SOURCE_LENGTH ? LIVE_PREVIEW_IDLE_MS : null
}

function active(range: { start: number; end: number }, selections: readonly Pick<SelectionRange, 'from' | 'to'>[]): boolean {
  return selections.some((selection) => selection.from === selection.to
    ? selection.from >= range.start && selection.from < range.end
    : selection.from < range.end && selection.to > range.start)
}

/** Semantic presentation derived from carve-js's document-space source map. */
export function livePresentations(
  source: string,
  selections: readonly Pick<SelectionRange, 'from' | 'to'>[],
  mapped?: readonly EditorMappedNode[],
): LivePresentation[] {
  const nodes = mapped ?? createEditorSession(source).snapshot().nodes
  const presentations: LivePresentation[] = []
  const byParent = new Map<string, EditorMappedNode[]>()
  const textByAncestor = new Map<string, { start: number; end: number }>()
  for (const node of nodes) {
    const slash = node.path.lastIndexOf('/')
    const parent = slash < 0 ? '' : node.path.slice(0, slash)
    const siblings = byParent.get(parent) ?? []
    siblings.push(node)
    byParent.set(parent, siblings)
    if (node.type !== 'text') continue
    let ancestor = parent
    while (ancestor) {
      const bounds = textByAncestor.get(ancestor)
      textByAncestor.set(ancestor, bounds
        ? { start: Math.min(bounds.start, node.start), end: Math.max(bounds.end, node.end) }
        : { start: node.start, end: node.end })
      ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'))
    }
  }
  const textBounds = (node: EditorMappedNode): { start: number; end: number } | null => {
    return textByAncestor.get(node.path) ?? null
  }
  for (const node of nodes) {
    if (!node.type || active(node, selections)) continue
    const authored = source.slice(node.start, node.end)
    for (const token of node.tokens) {
      if (token.role !== 'attribute' || active(token, selections)) continue
      const label = source.slice(token.start + 1, token.end - 1)
      presentations.push({ kind: 'line', at: token.start, className: 'carve-live-attribute-line' })
      presentations.push({ kind: 'widget', at: token.start, label, className: 'carve-live-attribute' })
      presentations.push({ kind: 'hide', from: token.start, to: token.end })
    }
    if (node.type === 'heading') {
      const marker = /^(#{1,6})[ \t]+/.exec(authored)
      if (marker) {
        presentations.push({ kind: 'heading', from: node.start, to: node.end, level: marker[1]!.length })
        presentations.push({ kind: 'hide', from: node.start, to: node.start + marker[0].length })
      }
      continue
    }
    if (node.type === 'list_item') {
      const content = byParent.get(`${node.path}/children`)?.find((candidate) => candidate.type === 'paragraph')
      if (!content || content.start <= node.start) continue
      const marker = source.slice(node.start, content.start)
      const task = /^[-+*][ \t]+\[([ xX-])\][ \t]+$/.exec(marker)
      const ordered = /^(\d+|[A-Za-z])[.)][ \t]+$/.exec(marker)
      const bullet = /^[-+*][ \t]+$/.exec(marker)
      if (!task && !ordered && !bullet) continue
      const label = task ? (task[1]!.toLowerCase() === 'x' ? '☑' : task[1] === '-' ? '⊟' : '☐') : ordered ? marker.trim() : '•'
      presentations.push({ kind: 'line', at: node.start, className: 'carve-live-list-item' })
      presentations.push({ kind: 'widget', at: node.start, label, className: task ? 'carve-live-task-marker' : 'carve-live-list-marker' })
      presentations.push({ kind: 'hide', from: node.start, to: content.start })
      continue
    }
    if (node.type === 'link') {
      const text = textBounds(node)
      if (!text || source[node.start] !== '[' || source[text.end] !== ']') continue
      presentations.push({ kind: 'hide', from: node.start, to: text.start })
      presentations.push({ kind: 'mark', from: text.start, to: text.end, className: 'carve-live-link' })
      presentations.push({ kind: 'hide', from: text.end, to: node.end })
      continue
    }
    if (node.type === 'table_row') {
      const cells = byParent.get(`${node.path}/cells`)?.filter((candidate) => candidate.type === 'table_cell') ?? []
      if (!cells.length) continue
      presentations.push({ kind: 'line', at: node.start, className: 'carve-live-table-row' })
      let cursor = node.start
      for (const cell of cells) {
        if (cursor < cell.start) presentations.push({ kind: 'hide', from: cursor, to: cell.start })
        const text = textBounds(cell)
        if (text) {
          if (cell.start < text.start) presentations.push({ kind: 'hide', from: cell.start, to: text.start })
          presentations.push({ kind: 'mark', from: text.start, to: text.end, className: source.slice(cell.start, text.start).includes('=') ? 'carve-live-table-header' : 'carve-live-table-cell' })
          if (text.end < cell.end) presentations.push({ kind: 'hide', from: text.end, to: cell.end })
        }
        cursor = cell.end
      }
      if (cursor < node.end) presentations.push({ kind: 'hide', from: cursor, to: node.end })
      continue
    }
    if (node.type === 'code_block') {
      const firstBreak = authored.indexOf('\n')
      const lastBreak = authored.lastIndexOf('\n')
      if (firstBreak < 0 || lastBreak <= firstBreak || !/^`{3,}/.test(authored)) continue
      presentations.push({ kind: 'hide', from: node.start, to: node.start + firstBreak + 1 })
      presentations.push({ kind: 'line', at: node.start + firstBreak + 1, className: 'carve-live-code-block' })
      presentations.push({ kind: 'mark', from: node.start + firstBreak + 1, to: node.start + lastBreak, className: 'carve-live-code-block-content' })
      presentations.push({ kind: 'hide', from: node.start + lastBreak, to: node.end })
      continue
    }
    const classes: Record<string, string> = {
      emphasis: 'carve-live-emphasis', strong: 'carve-live-strong',
      strikethrough: 'carve-live-strikethrough', code: 'carve-live-code',
    }
    const className = classes[node.type]
    if (!className || authored.length < 2 || authored[0] !== authored.at(-1)) continue
    presentations.push({ kind: 'hide', from: node.start, to: node.start + 1 })
    presentations.push({ kind: 'mark', from: node.start + 1, to: node.end - 1, className })
    presentations.push({ kind: 'hide', from: node.end - 1, to: node.end })
  }
  return presentations
}

class MarkerWidget extends WidgetType {
  constructor(private label: string, private className: string) { super() }
  toDOM(): HTMLElement { const span = document.createElement('span'); span.className = this.className; span.textContent = this.label; return span }
  eq(other: MarkerWidget): boolean { return this.label === other.label && this.className === other.className }
}

function decorations(session: EditorSession, selections: readonly SelectionRange[]): DecorationSet {
  const snapshot = session.snapshot()
  const ranges = livePresentations(snapshot.source, selections, snapshot.nodes).flatMap((item) => {
    if (item.kind === 'hide') return [Decoration.replace({}).range(item.from, item.to)]
    if (item.kind === 'mark') return [Decoration.mark({ class: item.className }).range(item.from, item.to)]
    if (item.kind === 'widget') return [Decoration.widget({ widget: new MarkerWidget(item.label, item.className), side: -1 }).range(item.at)]
    if (item.kind === 'line') return [Decoration.line({ class: item.className }).range(item.at)]
    return [Decoration.line({ class: `carve-live-heading carve-live-heading-${item.level}` }).range(item.from)]
  })
  return Decoration.set(ranges, true)
}

class LivePreviewState {
  decorations: DecorationSet = Decoration.none
  private session: EditorSession | null = null
  private source: string
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(view: EditorView) {
    this.source = view.state.doc.toString()
    this.schedule(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.source = update.state.doc.toString()
      this.decorations = this.decorations.map(update.changes)
      this.schedule(update.view)
    }
    if (update.selectionSet && this.session?.snapshot().source === this.source) this.decorations = decorations(this.session, update.state.selection.ranges)
  }

  destroy(): void { if (this.timer !== null) clearTimeout(this.timer) }

  private schedule(view: EditorView): void {
    if (this.timer !== null) clearTimeout(this.timer)
    const delay = livePreviewDelay(this.source.length)
    if (delay === null) {
      this.session = null
      this.decorations = Decoration.none
      return
    }
    const expected = this.source
    this.timer = setTimeout(() => {
      this.timer = null
      if (view.state.doc.toString() !== expected) return
      this.session = createEditorSession(expected)
      this.decorations = decorations(this.session, view.state.selection.ranges)
      // A no-op transaction asks CodeMirror to sample the updated provider.
      view.dispatch({})
    }, delay)
  }
}

/** Live Preview that keeps Carve source authoritative and reveals syntax at the cursor. */
export const carveLivePreview: Extension = ViewPlugin.fromClass(LivePreviewState, {
  decorations: (value) => value.decorations,
})
