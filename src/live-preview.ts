import { type EditorMappedNode, type EditorSession, createEditorSession } from '@markup-carve/carve'
import { EditorSelection, EditorState, type Extension, Prec, type SelectionRange, StateEffect, StateField, type Transaction, type TransactionSpec } from '@codemirror/state'
import { type Command, Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap } from '@codemirror/view'
import { substitutionBounds } from './substitution.js'

export type LivePresentation =
  | { kind: 'heading'; from: number; to: number; level: number }
  | { kind: 'line'; at: number; className: string }
  | { kind: 'hide'; from: number; to: number }
  | { kind: 'mark'; from: number; to: number; className: string }
  | { kind: 'widget'; at: number; label: string; className: string }
  | { kind: 'task'; at: number; state: string }
  | { kind: 'image'; at: number; destination: string; alt: string }

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

interface TaskBox { state: string; hideEnd: number; content: { start: number; end: number } | null }

/**
 * The task box of a list item. A box with nothing after it (`- [ ] `, what Enter
 * writes after a task) is a plain item whose text is `[ ]` to the engine, since a
 * task needs content; it is still drawn as a checkbox while the author fills it in.
 */
function taskBox(source: string, node: EditorMappedNode, children: readonly EditorMappedNode[] | undefined): TaskBox | null {
  const content = children?.find((candidate) => candidate.type === 'paragraph')
  if (!content || content.start <= node.start) return null
  const marker = source.slice(node.start, content.start)
  const task = /^[-*] [ \t]*\[([ xX_>?-])\]( [ \t]*)$/.exec(marker)
  if (task) return { state: task[1]!, hideEnd: content.start, content }
  const pending = /^\[([ xX_>?-])\]$/.exec(source.slice(content.start, content.end))
  // Only a box and, at most, nested lists: a later paragraph makes it ordinary item text.
  if (!pending || !/^[-*] [ \t]*$/.test(marker) || children!.some((child) => child !== content && child.type !== 'list')) return null
  const blank = /^[ \t]*/.exec(source.slice(content.end))![0]
  return { state: pending[1]!, hideEnd: content.end + blank.length, content: null }
}

function childrenByParent(nodes: readonly EditorMappedNode[]): Map<string, EditorMappedNode[]> {
  const byParent = new Map<string, EditorMappedNode[]>()
  for (const node of nodes) {
    const slash = node.path.lastIndexOf('/')
    const parent = slash < 0 ? '' : node.path.slice(0, slash)
    const siblings = byParent.get(parent) ?? []
    siblings.push(node)
    byParent.set(parent, siblings)
  }
  return byParent
}

export interface TaskMarker { from: number; to: number; content: { start: number; end: number } | null }

/** The hidden `- [ ] ` of every task item: from the bullet to where the item's text starts. */
export function liveTaskMarkers(source: string, mapped?: readonly EditorMappedNode[]): TaskMarker[] {
  const nodes = mapped ?? createEditorSession(source).snapshot().nodes
  const byParent = childrenByParent(nodes)
  const markers: TaskMarker[] = []
  for (const node of nodes) {
    if (node.type !== 'list_item') continue
    const box = taskBox(source, node, byParent.get(`${node.path}/children`))
    if (box) markers.push({ from: node.start, to: box.hideEnd, content: box.content })
  }
  return markers
}

/** Semantic presentation derived from carve-js's document-space source map. */
export function livePresentations(
  source: string,
  selections: readonly Pick<SelectionRange, 'from' | 'to'>[],
  mapped?: readonly EditorMappedNode[],
): LivePresentation[] {
  const nodes = mapped ?? createEditorSession(source).snapshot().nodes
  const all: LivePresentation[] = []
  const byParent = childrenByParent(nodes)
  const textByAncestor = new Map<string, { start: number; end: number }>()
  for (const node of nodes) {
    if (node.type !== 'text') continue
    let ancestor = node.path.slice(0, Math.max(0, node.path.lastIndexOf('/')))
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
  // A node under the cursor reveals its markers but keeps its line styling, so
  // a heading does not change size (and shift the text below) on click.
  const lineOnly: Pick<LivePresentation[], 'push'> = { push: (...items) => all.push(...items.filter((item) => item.kind === 'heading' || item.kind === 'line')) }
  for (const node of nodes) {
    if (!node.type) continue
    const box = node.type === 'list_item' ? taskBox(source, node, byParent.get(`${node.path}/children`)) : null
    // A task keeps its checkbox under the cursor, as in Obsidian: the caret never rests on the
    // marker, so only a selection across the marker reveals it.
    const revealed = box ? selections.some((selection) => selection.from < selection.to && selection.from < box.hideEnd && selection.to > node.start) : active(node, selections)
    const presentations = node.type !== 'text' && revealed ? lineOnly : all
    const authored = source.slice(node.start, node.end)
    for (const token of node.tokens) {
      if (token.role !== 'attribute' || active(token, selections)) continue
      const label = source.slice(token.start + 1, token.end - 1)
      presentations.push({ kind: 'line', at: token.start, className: 'carve-live-attribute-line' })
      presentations.push({ kind: 'widget', at: token.start, label, className: 'carve-live-attribute' })
      presentations.push({ kind: 'hide', from: token.start, to: token.end })
    }
    if (node.type === 'text') {
      const wikilink = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
      for (const match of authored.matchAll(wikilink)) {
        const start = node.start + match.index!
        const end = start + match[0].length
        if (active({ start, end }, selections)) continue
        const embed = match[1] === '!'
        if (embed) presentations.push({ kind: 'image', at: start, destination: match[2]!, alt: match[3] ?? match[2]! })
        else presentations.push({ kind: 'widget', at: start, label: `↗ ${match[3] ?? match[2]}`, className: 'carve-live-wikilink' })
        presentations.push({ kind: 'hide', from: start, to: end })
      }
      continue
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
      if (box) {
        presentations.push({ kind: 'line', at: node.start, className: 'carve-live-list-item' })
        presentations.push({ kind: 'task', at: node.start, state: box.state })
        presentations.push({ kind: 'hide', from: node.start, to: box.hideEnd })
        if (box.content && /[xX-]/.test(box.state)) presentations.push({ kind: 'mark', from: box.content.start, to: box.content.end, className: box.state === '-' ? 'carve-live-task-cancelled' : 'carve-live-task-done' })
        continue
      }
      const content = byParent.get(`${node.path}/children`)?.find((candidate) => candidate.type === 'paragraph')
      if (!content || content.start <= node.start) continue
      const marker = source.slice(node.start, content.start)
      const ordered = /^(\d+|[A-Za-z])[.)][ \t]+$/.exec(marker)
      const bullet = /^[-*] [ \t]*$/.exec(marker)
      if (!ordered && !bullet) continue
      presentations.push({ kind: 'line', at: node.start, className: 'carve-live-list-item' })
      presentations.push({ kind: 'widget', at: node.start, label: ordered ? marker.trim() : '•', className: 'carve-live-list-marker' })
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
      presentations.push({ kind: 'image', at: node.start, destination: image[2]!, alt: image[1] || image[2]! })
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
      const { oldStart, oldEnd, newStart, newEnd } = substitutionBounds(nodes, node)
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
  return all
}

class MarkerWidget extends WidgetType {
  constructor(private label: string, private className: string) { super() }
  toDOM(): HTMLElement { const span = document.createElement('span'); span.className = this.className; span.textContent = this.label; return span }
  eq(other: MarkerWidget): boolean { return this.label === other.label && this.className === other.className }
}

/** The edit that toggles the task marker of the list item starting at `at`: `x` unchecks, any other state checks. */
export function taskToggle(source: string, at: number): { from: number; to: number; insert: string } | null {
  const marker = /^[-*] [ \t]*\[([ xX_>?-])\]/.exec(source.slice(at, at + 64))
  if (!marker) return null
  const from = at + marker[0].length - 2
  return { from, to: from + 1, insert: /[xX]/.test(marker[1]!) ? ' ' : 'x' }
}

class TaskWidget extends WidgetType {
  constructor(private state: string) { super() }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'task-list-item-checkbox carve-live-task-checkbox'
    box.checked = /[xX]/.test(this.state)
    box.tabIndex = -1
    if (!/[ xX]/.test(this.state)) box.dataset.taskState = this.state
    // Keep the caret where it is; the click edits the source, like Obsidian's own tasks.
    box.addEventListener('mousedown', (event) => event.preventDefault())
    // The box only mirrors the source: a native toggle would outlive an undo, since eq() reuses this DOM.
    box.addEventListener('click', (event) => {
      event.preventDefault()
      const change = view.state.readOnly ? null : taskToggle(view.state.doc.toString(), view.posAtDOM(box))
      if (change) view.dispatch({ changes: change, userEvent: 'input' })
    })
    return box
  }
  eq(other: TaskWidget): boolean { return this.state === other.state }
}

/** Where a caret left of a task box belongs: the indentation before the bullet counts too. */
function caretZoneStart(source: string, marker: Pick<TaskMarker, 'from'>): number {
  const lineStart = source.lastIndexOf('\n', marker.from - 1) + 1
  return /^[ \t]*$/.test(source.slice(lineStart, marker.from)) ? lineStart : marker.from
}

/** Where a caret that landed left of a task box, or on its hidden marker, goes: after the box. */
export function taskCaretTarget(source: string, markers: readonly Pick<TaskMarker, 'from' | 'to'>[], head: number): number | null {
  for (const marker of markers) {
    if (marker.from < marker.to && head >= caretZoneStart(source, marker) && head < marker.to) return marker.to
  }
  return null
}

export interface TaskBackspaceEdit { changes: { from: number; to: number; insert: string }[]; head: number }

const BLANK_LINE = /^[ \t>]*$/

/**
 * Backspace at the start of a task's text removes the box and the bullet together.
 * The text becomes its own paragraph, so it gets blank lines where the engine would
 * otherwise fold it into the item above or the next item into it. An empty task
 * line loses its marker, like Enter on it. Null when `head` is not at a task's text.
 */
export function taskBackspaceEdit(source: string, head: number): TaskBackspaceEdit | null {
  const lineStart = source.lastIndexOf('\n', head - 1) + 1
  if (!/^[ \t>]*[-*] [ \t]*\[[ xX_>?-]\][ \t]*$/.test(source.slice(lineStart, head))) return null
  const marker = liveTaskMarkers(source).find((candidate) => candidate.to === head)
  if (!marker) return null
  const prefix = source.slice(lineStart, marker.from)
  if (!/^[ \t>]*$/.test(prefix)) return null
  const lineEnd = source.indexOf('\n', head) < 0 ? source.length : source.indexOf('\n', head)
  if (!marker.content) return { changes: [{ from: lineStart, to: lineEnd, insert: '' }], head: lineStart }
  // A blank line inside a quote keeps the quote markers.
  const blank = prefix.includes('>') ? prefix.replace(/[ \t]+$/, '') : ''
  const changes: TaskBackspaceEdit['changes'] = []
  let shift = 0
  if (lineStart > 0) {
    const previousStart = source.lastIndexOf('\n', lineStart - 2) + 1
    if (!BLANK_LINE.test(source.slice(previousStart, lineStart - 1))) { changes.push({ from: lineStart, to: lineStart, insert: `${blank}\n` }); shift = blank.length + 1 }
  }
  changes.push({ from: marker.from, to: marker.to, insert: '' })
  const paragraphEnd = source.indexOf('\n', marker.content.end)
  if (paragraphEnd >= 0) {
    const nextEnd = source.indexOf('\n', paragraphEnd + 1)
    const next = source.slice(paragraphEnd + 1, nextEnd < 0 ? source.length : nextEnd)
    if (!BLANK_LINE.test(next)) changes.push({ from: paragraphEnd, to: paragraphEnd, insert: `\n${blank}` })
  }
  const result = { changes, head: marker.from + shift }
  // The engine decides: the text must now open a paragraph of its own.
  let next = source
  for (const change of [...changes].reverse()) next = next.slice(0, change.from) + change.insert + next.slice(change.to)
  return createEditorSession(next).snapshot().nodes.some((node) => node.type === 'paragraph' && node.start === result.head) ? result : null
}

const setTaskMarkers = StateEffect.define<DecorationSet>()
const TASK_MARKER = Decoration.mark({})

/** The hidden task markers, refreshed with the decorations and mapped through edits in between. */
const taskMarkerField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setTaskMarkers)) return effect.value
    return tr.docChanged ? value.map(tr.changes) : value
  },
})

function markerList(set: DecorationSet): Array<{ from: number; to: number }> {
  const list: Array<{ from: number; to: number }> = []
  for (const cursor = set.iter(); cursor.value; cursor.next()) list.push({ from: cursor.from, to: cursor.to })
  return list
}

/** A caret never rests on a hidden task marker or left of its box, as in Obsidian. */
const taskCaretFilter = EditorState.transactionFilter.of((tr): Transaction | readonly (Transaction | TransactionSpec)[] => {
  const effect = tr.effects.find((candidate) => candidate.is(setTaskMarkers))
  if (!tr.selection && !tr.docChanged && !effect) return tr
  const set = (effect?.value as DecorationSet | undefined) ?? tr.startState.field(taskMarkerField, false)?.map(tr.changes)
  if (!set || set.size === 0) return tr
  const markers = markerList(set)
  const source = tr.newDoc.toString()
  let changed = false
  const ranges = tr.newSelection.ranges.map((range) => {
    if (!range.empty) return range
    const target = taskCaretTarget(source, markers, range.head)
    if (target === null) return range
    changed = true
    return EditorSelection.cursor(target)
  })
  return changed ? [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex), sequential: true }] : tr
})

/** ArrowLeft at a task's text goes to the end of the line above, not onto the box. */
const leftOverTask: Command = (view) => {
  const selection = view.state.selection.main
  if (!selection.empty || view.state.selection.ranges.length > 1) return false
  const marker = markerList(view.state.field(taskMarkerField)).find((candidate) => candidate.from < candidate.to && candidate.to === selection.head)
  if (!marker) return false
  const zone = caretZoneStart(view.state.doc.toString(), marker)
  if (zone > 0) view.dispatch({ selection: EditorSelection.cursor(zone - 1), scrollIntoView: true, userEvent: 'select' })
  return true
}

const backspaceTask: Command = (view) => {
  const selection = view.state.selection.main
  if (!selection.empty || view.state.readOnly) return false
  const edit = taskBackspaceEdit(view.state.doc.toString(), selection.head)
  if (!edit) return false
  view.dispatch({ changes: edit.changes, selection: EditorSelection.cursor(edit.head), scrollIntoView: true, userEvent: 'delete.backward' })
  return true
}

class ImageWidget extends WidgetType {
  constructor(private source: string | null, private alt: string) { super() }
  toDOM(): HTMLElement {
    if (!this.source) { const badge = document.createElement('span'); badge.className = 'carve-live-image'; badge.textContent = `🖼 ${this.alt}`; return badge }
    const image = document.createElement('img'); image.className = 'carve-live-image-preview'; image.src = this.source; image.alt = this.alt; image.loading = 'lazy'; return image
  }
  eq(other: ImageWidget): boolean { return this.source === other.source && this.alt === other.alt }
}

export type ImageResolver = (destination: string) => string | null

function decorations(session: EditorSession, selections: readonly SelectionRange[], resolveImage?: ImageResolver): DecorationSet {
  const snapshot = session.snapshot()
  const ranges = livePresentations(snapshot.source, selections, snapshot.nodes).flatMap((item) => {
    if (item.kind === 'hide') return [Decoration.replace({}).range(item.from, item.to)]
    if (item.kind === 'mark') return [Decoration.mark({ class: item.className }).range(item.from, item.to)]
    if (item.kind === 'widget') return [Decoration.widget({ widget: new MarkerWidget(item.label, item.className), side: -1 }).range(item.at)]
    if (item.kind === 'task') return [Decoration.widget({ widget: new TaskWidget(item.state), side: -1 }).range(item.at)]
    if (item.kind === 'image') return [Decoration.widget({ widget: new ImageWidget(resolveImage?.(item.destination) ?? null, item.alt), side: -1 }).range(item.at)]
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
  constructor(view: EditorView, private resolveImage?: ImageResolver) {
    this.source = view.state.doc.toString()
    this.schedule(view)
  }


  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.source = update.state.doc.toString()
      this.decorations = this.decorations.map(update.changes)
      this.schedule(update.view)
    }
    if (update.selectionSet && this.session?.snapshot().source === this.source) this.decorations = decorations(this.session, update.state.selection.ranges, this.resolveImage)
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
      const snapshot = this.session.snapshot()
      const markers = Decoration.set(liveTaskMarkers(snapshot.source, snapshot.nodes).filter((marker) => marker.from < marker.to).map((marker) => TASK_MARKER.range(marker.from, marker.to)), true)
      this.decorations = decorations(this.session, view.state.selection.ranges, this.resolveImage)
      // Also asks CodeMirror to sample the updated provider. A caret the markers now
      // cover moves after its box, and update() redraws for that selection.
      view.dispatch({ effects: setTaskMarkers.of(markers) })
    }, delay)
  }
}

/** Live Preview that keeps Carve source authoritative and reveals syntax at the cursor. */
export function createCarveLivePreview(resolveImage?: ImageResolver): Extension {
  return [
    taskMarkerField,
    taskCaretFilter,
    EditorView.atomicRanges.of((view) => view.state.field(taskMarkerField)),
    Prec.high(keymap.of([{ key: 'Backspace', run: backspaceTask }, { key: 'ArrowLeft', run: leftOverTask }])),
    ViewPlugin.define((view) => new LivePreviewState(view, resolveImage), { decorations: (value) => value.decorations }),
  ]
}

export const carveLivePreview: Extension = createCarveLivePreview()
