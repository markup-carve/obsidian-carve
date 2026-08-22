import { type EditorSession, createEditorSession } from '@markup-carve/carve'
import { type Extension, type SelectionRange } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

export type LivePresentation =
  | { kind: 'heading'; from: number; to: number; level: number }
  | { kind: 'hide'; from: number; to: number }
  | { kind: 'mark'; from: number; to: number; className: string }

function active(range: { start: number; end: number }, selections: readonly Pick<SelectionRange, 'from' | 'to'>[]): boolean {
  return selections.some((selection) => selection.from === selection.to
    ? selection.from >= range.start && selection.from < range.end
    : selection.from < range.end && selection.to > range.start)
}

/** Semantic presentation derived from carve-js's document-space source map. */
export function livePresentations(source: string, selections: readonly Pick<SelectionRange, 'from' | 'to'>[]): LivePresentation[] {
  const snapshot = createEditorSession(source).snapshot()
  const presentations: LivePresentation[] = []
  for (const node of snapshot.nodes) {
    if (!node.type || active(node, selections)) continue
    const authored = source.slice(node.start, node.end)
    if (node.type === 'heading') {
      const marker = /^(#{1,6})[ \t]+/.exec(authored)
      if (marker) {
        presentations.push({ kind: 'heading', from: node.start, to: node.end, level: marker[1]!.length })
        presentations.push({ kind: 'hide', from: node.start, to: node.start + marker[0].length })
      }
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

function decorations(source: string, selections: readonly SelectionRange[]): DecorationSet {
  const ranges = livePresentations(source, selections).flatMap((item) => {
    if (item.kind === 'hide') return [Decoration.replace({}).range(item.from, item.to)]
    if (item.kind === 'mark') return [Decoration.mark({ class: item.className }).range(item.from, item.to)]
    return [Decoration.line({ class: `carve-live-heading carve-live-heading-${item.level}` }).range(item.from)]
  })
  return Decoration.set(ranges, true)
}

class LivePreviewState {
  decorations: DecorationSet
  private session: EditorSession

  constructor(view: EditorView) {
    this.session = createEditorSession(view.state.doc.toString())
    this.decorations = decorations(this.session.snapshot().source, view.state.selection.ranges)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      const changes: Array<{ from: number; to: number; insert: string }> = []
      update.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, insert: inserted.toString() }))
      this.session.update(changes)
    }
    if (update.docChanged || update.selectionSet) this.decorations = decorations(this.session.snapshot().source, update.state.selection.ranges)
  }
}

/** Live Preview that keeps Carve source authoritative and reveals syntax at the cursor. */
export const carveLivePreview: Extension = ViewPlugin.fromClass(LivePreviewState, {
  decorations: (value) => value.decorations,
})
