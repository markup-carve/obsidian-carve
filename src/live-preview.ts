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
    if (node.type === 'image') {
      const image = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(authored)
      if (!image) continue
      presentations.push({ kind: 'widget', at: node.start, label: `🖼 ${image[1] || image[2]}`, className: 'carve-live-image' })
      presentations.push({ kind: 'hide', from: node.start, to: node.end })
      continue
    }
    if (node.type === 'footnote_ref') {
      const reference = /^\[\^([^\]]+)\]$/.exec(authored)
      if (!reference) continue
      presentations.push({ kind: 'widget', at: node.start, label: reference[1]!, className: 'carve-live-footnote-ref' })
      presentations.push({ kind: 'hide', from: node.start, to: node.end })
      continue
    }
    if (node.type === 'footnote') {
      const content = byParent.get(`${node.path}/children`)?.[0]
      const marker = /^\[\^([^\]]+)\]:[ \t]*/.exec(authored)
      if (!content || !marker || content.start <= node.start) continue
      presentations.push({ kind: 'widget', at: node.start, label: `↳ ${marker[1]}`, className: 'carve-live-footnote-def' })
      presentations.push({ kind: 'hide', from: node.start, to: content.start })
      continue
    }
    if (node.type === 'admonition') {
      const firstBreak = authored.indexOf('\n')
      const lastBreak = authored.lastIndexOf('\n')
      if (firstBreak < 0 || lastBreak <= firstBreak || !authored.startsWith(':::')) continue
      const label = authored.slice(3, firstBreak).trim() || 'block'
      presentations.push({ kind: 'widget', at: node.start, label, className: 'carve-live-container-label' })
      presentations.push({ kind: 'hide', from: node.start, to: node.start + firstBreak + 1 })
      presentations.push({ kind: 'line', at: node.start + firstBreak + 1, className: 'carve-live-container' })
      presentations.push({ kind: 'hide', from: node.start + lastBreak, to: node.end })
      continue
    }
    if (node.type === 'figure') {
      const target = byParent.get(node.path)?.find((candidate) => candidate.path === `${node.path}/target`)
      const caption = textBounds({ ...node, path: `${node.path}/caption` })
      if (target && caption && target.end < caption.start) {
        presentations.push({ kind: 'hide', from: target.end, to: caption.start })
        presentations.push({ kind: 'mark', from: caption.start, to: caption.end, className: 'carve-live-caption' })
      }
      continue
    }
    if (node.type === 'math') {
      const math = /^(\$+`)([\s\S]*)(`)$/.exec(authored)
      if (!math) continue
      const contentStart = node.start + math[1]!.length
      const contentEnd = node.end - math[3]!.length
      presentations.push({ kind: 'hide', from: node.start, to: contentStart })
      presentations.push({ kind: 'mark', from: contentStart, to: contentEnd, className: 'carve-live-math' })
      presentations.push({ kind: 'hide', from: contentEnd, to: node.end })
      continue
    }
    if (node.type === 'comment') {
      if (authored.startsWith('{%') && authored.endsWith('%}')) {
        presentations.push({ kind: 'hide', from: node.start, to: node.start + 2 })
        presentations.push({ kind: 'mark', from: node.start + 2, to: node.end - 2, className: 'carve-live-comment' })
        presentations.push({ kind: 'hide', from: node.end - 2, to: node.end })
      } else if (authored.startsWith('%%')) {
        const marker = /^%%[ \t]*/.exec(authored)![0]
        presentations.push({ kind: 'hide', from: node.start, to: node.start + marker.length })
        presentations.push({ kind: 'mark', from: node.start + marker.length, to: node.end, className: 'carve-live-comment' })
      }
      continue
    }
    if (node.type === 'insert' || node.type === 'delete') {
      const content = textBounds(node)
      if (!content) continue
      presentations.push({ kind: 'hide', from: node.start, to: content.start })
      presentations.push({ kind: 'mark', from: content.start, to: content.end, className: node.type === 'insert' ? 'carve-live-insert' : 'carve-live-delete' })
      presentations.push({ kind: 'hide', from: content.end, to: node.end })
      continue
    }
    if (node.type === 'substitution') {
      const substitution = /^\{~([\s\S]*)~>([\s\S]*)~\}$/.exec(authored)
      if (!substitution) continue
      const oldStart = node.start + 2
      const oldEnd = oldStart + substitution[1]!.length
      const newStart = oldEnd + 2
      const newEnd = newStart + substitution[2]!.length
      presentations.push({ kind: 'hide', from: node.start, to: oldStart })
      presentations.push({ kind: 'mark', from: oldStart, to: oldEnd, className: 'carve-live-delete' })
      presentations.push({ kind: 'hide', from: oldEnd, to: newStart })
      presentations.push({ kind: 'mark', from: newStart, to: newEnd, className: 'carve-live-insert' })
      presentations.push({ kind: 'hide', from: newEnd, to: node.end })
      continue
    }
    if (node.type === 'critic_comment' && authored.startsWith('{#') && authored.endsWith('#}')) {
      presentations.push({ kind: 'hide', from: node.start, to: node.start + 2 })
      presentations.push({ kind: 'mark', from: node.start + 2, to: node.end - 2, className: 'carve-live-comment' })
      presentations.push({ kind: 'hide', from: node.end - 2, to: node.end })
      continue
    }
    if ((node.type === 'tag' && authored.startsWith('#')) || (node.type === 'mention' && authored.startsWith('@'))) {
      presentations.push({ kind: 'hide', from: node.start, to: node.start + 1 })
      presentations.push({ kind: 'mark', from: node.start + 1, to: node.end, className: node.type === 'tag' ? 'carve-live-tag' : 'carve-live-mention' })
      continue
    }
    if (node.type === 'raw_inline') {
      const raw = /^`([\s\S]*)`\{=([^}]+)\}$/.exec(authored)
      if (!raw) continue
      const contentStart = node.start + 1
      const contentEnd = contentStart + raw[1]!.length
      presentations.push({ kind: 'widget', at: node.start, label: raw[2]!, className: 'carve-live-raw-format' })
      presentations.push({ kind: 'hide', from: node.start, to: contentStart })
      presentations.push({ kind: 'mark', from: contentStart, to: contentEnd, className: 'carve-live-raw' })
      presentations.push({ kind: 'hide', from: contentEnd, to: node.end })
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
