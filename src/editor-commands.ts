import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'
import { parse, type Document, type Position } from '@markup-carve/carve'
import { BARE_CONTINUATION_MARKER, continuationPrefix, listContinuationEdits, listIndentEdits, type ContinuationEdit } from '@markup-carve/carve-lsp/browser'

export interface FormatEdit {
  changes: Array<{ from: number; to: number; insert: string }>
  anchor: number
  head: number
}

export type TableDirection = 'row-before' | 'row-after' | 'column-before' | 'column-after' | 'delete-row' | 'delete-column'

/** Smallest-range source edit for toggling an authored inline delimiter. */
export function inlineFormatEdit(source: string, from: number, to: number, open: string, close = open): FormatEdit {
  const wrapped = from >= open.length && source.slice(from - open.length, from) === open && source.slice(to, to + close.length) === close
  if (wrapped) return {
    changes: [{ from: from - open.length, to: from, insert: '' }, { from: to, to: to + close.length, insert: '' }],
    anchor: from - open.length,
    head: to - open.length,
  }
  return {
    changes: [{ from, to: from, insert: open }, { from: to, to, insert: close }],
    anchor: from + open.length,
    head: to + open.length,
  }
}

export function headingEdit(source: string, lineFrom: number, lineTo: number, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): FormatEdit {
  const line = source.slice(lineFrom, lineTo)
  const marker = /^(#{1,6})[ \t]+/.exec(line)?.[0] ?? ''
  const insert = level === 0 ? '' : `${'#'.repeat(level)} `
  return { changes: [{ from: lineFrom, to: lineFrom + marker.length, insert }], anchor: lineFrom + insert.length, head: lineFrom + insert.length }
}

export function linkFormatEdit(source: string, from: number, to: number): FormatEdit {
  const edit = inlineFormatEdit(source, from, to, '[', ']()')
  const destination = edit.head + 2
  return { ...edit, anchor: destination, head: destination }
}

export function simpleTableEdit(source: string, at: number, direction: TableDirection): FormatEdit | null {
  const lineStart = source.lastIndexOf('\n', Math.max(0, at - 1)) + 1
  const lineEndMatch = source.indexOf('\n', at)
  const lineEnd = lineEndMatch < 0 ? source.length : lineEndMatch
  const line = source.slice(lineStart, lineEnd).replace(/\r$/, '')
  if (!/^\|[^\r\n]*\|$/.test(line) || /\\\|/.test(line)) return null
  const cells = line.slice(1, -1).split('|')
  let blockStart = lineStart
  while (blockStart > 0) {
    const previousEnd = blockStart - 1
    const previousStart = source.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1
    const previous = source.slice(previousStart, previousEnd).replace(/\r$/, '')
    if (!/^\|[^\r\n]*\|$/.test(previous) || /\\\|/.test(previous)) break
    blockStart = previousStart
  }
  let blockEnd = lineEnd
  while (blockEnd < source.length) {
    const nextStart = blockEnd + 1
    const nextBreak = source.indexOf('\n', nextStart)
    const nextEnd = nextBreak < 0 ? source.length : nextBreak
    const next = source.slice(nextStart, nextEnd).replace(/\r$/, '')
    if (!/^\|[^\r\n]*\|$/.test(next) || /\\\|/.test(next)) break
    blockEnd = nextEnd
  }
  if (direction === 'delete-row') {
    if (source.slice(blockStart, blockEnd).split('\n').length <= 1) return null
    let from = lineStart
    let to = lineEnd
    if (to < source.length) to += 1
    else if (from > 0) from -= 1
    return { changes: [{ from, to, insert: '' }], anchor: from, head: from }
  }
  if (direction.startsWith('row-')) {
    const row = `|${cells.map(() => '  ').join('|')}|`
    const before = direction === 'row-before'
    const from = before ? lineStart : lineEnd
    const insert = before ? `${row}\n` : `\n${row}`
    return { changes: [{ from, to: from, insert }], anchor: from + (before ? 2 : 3), head: from + (before ? 2 : 3) }
  }
  const relative = Math.max(1, Math.min(line.length - 1, at - lineStart))
  const cellIndex = line.slice(1, relative).split('|').length - 1 + (direction === 'column-after' ? 1 : 0)
  const block = source.slice(blockStart, blockEnd)
  const lines = block.split('\n')
  if (lines.some((row) => row.slice(1, -1).split('|').length !== cells.length)) return null
  if (direction === 'delete-column' && cells.length <= 1) return null
  const replacement = lines.map((row) => {
    const rowCells = row.replace(/\r$/, '').slice(1, -1).split('|')
    if (direction === 'delete-column') rowCells.splice(Math.min(cellIndex, rowCells.length - 1), 1)
    else rowCells.splice(cellIndex, 0, '  ')
    return `|${rowCells.join('|')}|${row.endsWith('\r') ? '\r' : ''}`
  }).join('\n')
  return { changes: [{ from: blockStart, to: blockEnd, insert: replacement }], anchor: at, head: at }
}

export type LinePrefix = 'bullet' | 'ordered' | 'task' | 'quote'
export function linePrefixEdit(source: string, lineFrom: number, lineTo: number, kind: LinePrefix): FormatEdit {
  const line = source.slice(lineFrom, lineTo)
  const prefixes: Record<LinePrefix, RegExp> = { bullet: /^[-*] [ \t]*/, ordered: /^(?:\.|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]) [ \t]*/, task: /^[-*] [ \t]*\[[ xX_>?-]\] [ \t]*/, quote: /^>[ \t]+/ }
  const insertions: Record<LinePrefix, string> = { bullet: '- ', ordered: '1. ', task: '- [ ] ', quote: '> ' }
  const own = prefixes[kind].exec(line)?.[0] ?? ''
  const any = /^(?:[-*] [ \t]*(?:\[[ xX_>?-]\] [ \t]*)?|>[ \t]+)/.exec(line)?.[0] ?? ''
  const insert = own ? '' : insertions[kind]
  return { changes: [{ from: lineFrom, to: lineFrom + (own ? own.length : any.length), insert }], anchor: lineFrom + insert.length, head: lineFrom + insert.length }
}

export function fencedBlockEdit(source: string, from: number, to: number, language = ''): FormatEdit {
  const selected = source.slice(from, to)
  const open = `\`\`\`${language}\n`
  const close = `${selected.endsWith('\n') ? '' : '\n'}\`\`\``
  return { changes: [{ from, to: from, insert: open }, { from: to, to, insert: close }], anchor: from + open.length, head: to + open.length }
}

function applyInline(open: string, close = open): Command {
  return (view: EditorView): boolean => {
    const selection = view.state.selection.main
    const edit = inlineFormatEdit(view.state.doc.toString(), selection.from, selection.to, open, close)
    view.dispatch({ changes: edit.changes, selection: EditorSelection.single(edit.anchor, edit.head), scrollIntoView: true })
    return true
  }
}

export function setHeading(view: EditorView, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const edit = headingEdit(view.state.doc.toString(), line.from, line.to, level)
  view.dispatch({ changes: edit.changes, scrollIntoView: true })
  return true
}

export const toggleStrong = applyInline('*')
export const toggleEmphasis = applyInline('/')
export const toggleStrike = applyInline('~')
export const toggleCode = applyInline('`')
export const toggleHighlight = applyInline('=')
export const createLink: Command = (view): boolean => {
  const selection = view.state.selection.main
  const edit = linkFormatEdit(view.state.doc.toString(), selection.from, selection.to)
  view.dispatch({ changes: edit.changes, selection: EditorSelection.single(edit.anchor, edit.head), scrollIntoView: true })
  return true
}

export function editTable(view: EditorView, direction: TableDirection): boolean {
  const edit = simpleTableEdit(view.state.doc.toString(), view.state.selection.main.head, direction)
  if (!edit) return false
  view.dispatch({ changes: edit.changes, scrollIntoView: true })
  return true
}

export function setLinePrefix(view: EditorView, kind: LinePrefix): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const edit = linePrefixEdit(view.state.doc.toString(), line.from, line.to, kind)
  view.dispatch({ changes: edit.changes, scrollIntoView: true })
  return true
}

export const wrapCodeBlock: Command = (view): boolean => {
  const selection = view.state.selection.main
  const edit = fencedBlockEdit(view.state.doc.toString(), selection.from, selection.to)
  view.dispatch({ changes: edit.changes, selection: EditorSelection.single(edit.anchor, edit.head), scrollIntoView: true })
  return true
}

export const insertHorizontalRule: Command = (view): boolean => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({ changes: { from: line.from, to: line.to, insert: '***' }, scrollIntoView: true })
  return true
}

export const insertSimpleTable: Command = (view): boolean => {
  const selection = view.state.selection.main
  const table = '| Header | Header |\n|  |  |'
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert: table }, selection: EditorSelection.cursor(selection.from + 2), scrollIntoView: true })
  return true
}

export const wrapCallout: Command = (view): boolean => {
  const selection = view.state.selection.main
  const selected = view.state.sliceDoc(selection.from, selection.to)
  const open = '::: note "Note"\n'
  const close = `${selected.endsWith('\n') ? '' : '\n'}:::`
  view.dispatch({ changes: [{ from: selection.from, insert: open }, { from: selection.to, insert: close }], selection: EditorSelection.single(selection.from + open.length, selection.to + open.length), scrollIntoView: true })
  return true
}

// The separator must open with a space and roman numerals are single-case, as the
// parser reads them; `+` is the continuation marker, not a bullet.
const ITEM_MARKER = /^([ \t]*)([-*]|\.|(?:[0-9]+|[A-Za-z]+)[.)])( [ \t]*)/
// Alpha and roman stay disjoint so a pattern that repeats a marker cannot backtrack exponentially.
export const BULLET_MARKER = '[-*]'
export const ORDERED_MARKER = String.raw`(?:\.|(?:[0-9]+|[A-Za-z]|[ivxlcdm]{2,}|[IVXLCDM]{2,})[.)])`
export const TASK_BOX_MARKER = String.raw`\[[ xX_>?-]\]`
const BARE_MARKER = new RegExp(String.raw`^[ \t]*(?:${BULLET_MARKER} [ \t]*(?:${TASK_BOX_MARKER} [ \t]*)?|${ORDERED_MARKER} [ \t]*)$`)
// A content-less marker parses as lazy text, so it is measured with a placeholder.
const PLACEHOLDER = 'x'

interface SourceList { previous: SourceList | null; ordered: boolean; olType?: string; delim?: string; bulletChar?: string; items: SourceItem[]; parent: SourceItem | null }
interface SourceItem { line: number; end: number; list: SourceList; index: number; childList: SourceList | null }
interface SourceLists { items: Map<number, SourceItem>; code: Set<number> }

function sourceLists(source: string): SourceLists | null {
  let doc: Document
  try { doc = parse(source, { positions: true }) } catch { return null }
  const result: SourceLists = { items: new Map(), code: new Set() }
  type Node = { type?: unknown; pos?: Position; items?: unknown[]; children?: unknown[]; ordered?: boolean; olType?: string; delim?: string; bulletChar?: string }
  const visitList = (node: Node, parent: SourceItem | null): SourceList => {
    const list: SourceList = { previous: null, ordered: node.ordered === true, olType: node.olType, delim: node.delim, bulletChar: node.bulletChar, items: [], parent }
    for (const entry of node.items ?? []) {
      const itemNode = entry as Node
      if (itemNode.pos?.startLine === undefined || itemNode.pos.endLine === undefined) continue
      const item: SourceItem = { line: itemNode.pos.startLine - 1, end: itemNode.pos.endLine - 1, list, index: list.items.length, childList: null }
      list.items.push(item)
      if (!result.items.has(item.line)) result.items.set(item.line, item)
      item.childList = visitBlocks(itemNode.children ?? [], item)
    }
    return list
  }
  // Returns the list that ends the block sequence, if any.
  const visitBlocks = (blocks: unknown[], parent: SourceItem | null): SourceList | null => {
    let previous: SourceList | null = null
    for (const block of blocks) {
      const list = visit(block, parent)
      if (list) list.previous = previous
      previous = list
    }
    return previous
  }
  const visit = (value: unknown, parent: SourceItem | null): SourceList | null => {
    if (Array.isArray(value)) { visitBlocks(value, parent); return null }
    if (value === null || typeof value !== 'object') return null
    const node = value as Node
    if ((node.type === 'code_block' || node.type === 'raw_block') && node.pos?.startLine !== undefined && node.pos.endLine !== undefined) {
      for (let line = node.pos.startLine - 1; line < node.pos.endLine; line++) result.code.add(line)
      return null
    }
    if (node.type === 'list') return visitList(node, parent)
    for (const key of Object.keys(node)) if (key !== 'pos') visit((node as Record<string, unknown>)[key], parent)
    return null
  }
  visit(doc.children, null)
  return result
}

/** Zero-based lines inside a code or raw block, or null when the source does not parse. */
export function codeBlockLines(source: string): ReadonlySet<number> | null {
  return sourceLists(source)?.code ?? null
}

function columns(text: string, start = 0): number {
  let column = start
  for (const char of text) column = char === '\t' ? column + 4 - (column % 4) : column + 1
  return column - start
}

function splitLines(source: string): { lines: string[]; eols: string[] } {
  const lines = source.split('\n')
  const eols = lines.map((line) => (line.endsWith('\r') ? '\r' : ''))
  return { lines: lines.map((line, index) => (eols[index] ? line.slice(0, -1) : line)), eols }
}

interface ItemParts { indent: number; marker: string; separator: string; rest: string; content: number }
function itemParts(line: string): ItemParts | null {
  const match = ITEM_MARKER.exec(line)
  if (!match) return null
  const indent = columns(match[1]!)
  const content = indent + match[2]!.length + columns(match[3]!, indent + match[2]!.length)
  return { indent, marker: match[2]!, separator: match[3]!, rest: line.slice(match[0].length), content }
}

function sameListKind(a: SourceList, aMarker: string, b: SourceList, bMarker: string): boolean {
  if (a.ordered !== b.ordered) return false
  if (!a.ordered) return a.bulletChar === b.bulletChar
  return a.delim === b.delim && a.olType === b.olType && (aMarker === '.') === (bMarker === '.')
}

function firstOrdinal(list: SourceList, marker: string): string {
  if (!list.ordered) return marker
  if (marker === '.') return '.'
  const ordinal = list.olType === 'a' || list.olType === 'A' || list.olType === 'i' || list.olType === 'I' ? list.olType : '1'
  return ordinal + marker.slice(-1)
}

function nextOrdinal(list: SourceList, marker: string): string | null {
  if (!list.ordered || marker === '.') return marker
  const next = increment(marker.slice(0, -1), list.olType)
  return next === null ? null : next + marker.slice(-1)
}

function increment(ordinal: string, olType: string | undefined): string | null {
  if (/^[0-9]+$/.test(ordinal)) return (BigInt(ordinal) + 1n).toString().padStart(ordinal.length, '0')
  if (olType === 'i' || olType === 'I') {
    const value = fromRoman(ordinal.toLowerCase())
    if (value === null) return null
    const roman = toRoman(value + 1)
    return olType === 'I' ? roman.toUpperCase() : roman
  }
  if ((olType === 'a' || olType === 'A') && ordinal.length === 1 && !/[zZ]/.test(ordinal)) return String.fromCharCode(ordinal.charCodeAt(0) + 1)
  return null
}

const ROMAN: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
function toRoman(value: number): string {
  let out = ''
  for (const [amount, digits] of ROMAN) while (value >= amount) { out += digits; value -= amount }
  return out
}
function fromRoman(text: string): number | null {
  let value = 0; let rest = text
  for (const [amount, digits] of ROMAN) while (rest.startsWith(digits)) { value += amount; rest = rest.slice(digits.length) }
  return rest === '' && value > 0 ? value : null
}

function shiftLine(line: string, delta: number): string {
  if (delta === 0 || line.trim() === '') return line
  const leading = /^[ \t]*/.exec(line)![0]
  if (delta > 0 && !leading.includes('\t')) return ' '.repeat(delta) + line
  return ' '.repeat(Math.max(0, columns(leading) + delta)) + line.slice(leading.length)
}

interface ItemMove { item: SourceItem; column: number; marker: string; parentLine: number | null }

/** Where one Tab or Shift+Tab sends the item that starts at `item.line`, or null. */
function planMove(lines: string[], item: SourceItem, parts: ItemParts, outdent: boolean, run: ItemMove | null): ItemMove | null {
  // A selected item right after a moved sibling follows it into the same list.
  if (run && run.item.list === item.list && run.item.index === item.index - 1) {
    const marker = nextOrdinal(item.list, run.marker)
    return marker === null ? null : { item, column: run.column, marker, parentLine: run.parentLine }
  }
  if (outdent) {
    const parent = item.list.parent
    const parentParts = parent && itemParts(lines[parent.line]!)
    if (!parent || !parentParts) return null
    const marker = sameListKind(item.list, parts.marker, parent.list, parentParts.marker) ? nextOrdinal(parent.list, parentParts.marker) : firstOrdinal(item.list, parts.marker)
    return marker === null ? null : { item, column: parentParts.indent, marker, parentLine: parent.list.parent?.line ?? null }
  }
  // A list right after another one (`1. a` then `- b`) nests under its last item.
  const sibling = item.index > 0 ? item.list.items[item.index - 1] : item.list.previous?.items.at(-1)
  const siblingParts = sibling && itemParts(lines[sibling.line]!)
  if (!sibling || !siblingParts) return null
  const child = sibling.childList?.items.at(-1)
  const childParts = child && itemParts(lines[child.line]!)
  let column = siblingParts.content
  let marker: string | null = firstOrdinal(item.list, parts.marker)
  if (child && childParts) {
    column = childParts.indent
    if (sameListKind(item.list, parts.marker, child.list, childParts.marker)) marker = nextOrdinal(child.list, childParts.marker)
  }
  if (marker === null || column <= parts.indent) return null
  return { item, column, marker, parentLine: sibling.line }
}

/** Tab or Shift+Tab over lines `first..last`: two parses however many items move. */
function indentItems(original: string[], first: number, last: number, outdent: boolean): string[] | null {
  // A content-less marker parses as lazy text, so it is measured with a placeholder.
  const placeholders = new Set<number>()
  const lines = original.slice()
  for (let line = first; line <= last; line++) if (BARE_MARKER.test(lines[line] ?? '')) { lines[line] += PLACEHOLDER; placeholders.add(line) }
  const lists = sourceLists(lines.join('\n'))
  if (!lists) return null
  const next = lines.slice()
  const moves: ItemMove[] = []
  let run: ItemMove | null = null
  for (let line = first; line <= last; line++) {
    const item = lists.items.get(line)
    const parts = item && itemParts(lines[line]!)
    if (!item || !parts || lists.code.has(line)) continue
    const move = planMove(lines, item, parts, outdent, run)
    if (!move) continue
    const content = move.column + move.marker.length + columns(parts.separator, move.column + move.marker.length)
    next[line] = ' '.repeat(move.column) + move.marker + parts.separator + parts.rest
    for (let index = line + 1; index <= item.end; index++) next[index] = shiftLine(next[index]!, content - parts.content)
    moves.push(move); run = move
    line = item.end
  }
  if (!moves.length) return null
  // The engine decides: the edit stands only if every item reparses where it was sent.
  const moved = sourceLists(next.join('\n'))
  for (const move of moves) {
    const reparsed = moved?.items.get(move.item.line)
    if (!reparsed || (reparsed.list.parent?.line ?? null) !== move.parentLine) return null
  }
  for (const line of placeholders) if (next[line]!.endsWith(PLACEHOLDER)) next[line] = next[line]!.slice(0, -PLACEHOLDER.length)
  return next
}

function lineDiff(before: string[], after: string[], eols: string[]): FormatEdit['changes'] {
  const changes: FormatEdit['changes'] = []
  let offset = 0
  for (let index = 0; index < before.length; index++) {
    const old = before[index]!; const updated = after[index]!
    if (old !== updated) {
      let prefix = 0
      while (prefix < old.length && prefix < updated.length && old[prefix] === updated[prefix]) prefix++
      let suffix = 0
      while (suffix < old.length - prefix && suffix < updated.length - prefix && old[old.length - 1 - suffix] === updated[updated.length - 1 - suffix]) suffix++
      changes.push({ from: offset + prefix, to: offset + old.length - suffix, insert: updated.slice(prefix, updated.length - suffix) })
    }
    offset += old.length + eols[index]!.length + 1
  }
  return changes
}

/**
 * Tab nests each selected list item under its previous sibling's content column;
 * Shift+Tab moves it to the parent item's marker column. Continuation lines and
 * child items move with it. Null when no selected line is an item that can move.
 */
export function listIndentEdit(source: string, lineFrom: number, lineTo: number, outdent = false): FormatEdit | null {
  const { lines, eols } = splitLines(source)
  const lineAt = (offset: number): number => source.slice(0, offset).split('\n').length - 1
  const first = lineAt(lineFrom); const last = lineAt(Math.max(lineFrom, lineTo))
  // One line goes through carve-lsp's rule, which also reaches items inside a
  // quote; a selection of several items keeps the local planner, which moves
  // them together.
  if (first === last) {
    const edits = listIndentEdits(source, first, outdent ? 'outdent' : 'indent')
    if (edits?.length) return lspEdit(source, edits, lineFrom)
  }
  const current = indentItems(lines, first, last, outdent)
  if (!current) return null
  const changes = lineDiff(lines, current, eols)
  if (!changes.length) return null
  let anchor = lineFrom
  for (const change of changes) if (change.to <= lineFrom) anchor += change.insert.length - (change.to - change.from)
  return { changes, anchor, head: anchor }
}

/** Offset of an LSP position in `text`. */
function offsetOf(text: string, position: { line: number; character: number }): number {
  let offset = 0
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf('\n', offset)
    if (next === -1) return text.length
    offset = next + 1
  }
  return offset + position.character
}

/** Applies carve-lsp edits to `text`, mapping `cursor` through them (after an insertion at it). */
function applyLspEdits(text: string, edits: readonly ContinuationEdit[], cursor: number): { text: string; cursor: number } {
  const changes = edits.map((edit) => ({ from: offsetOf(text, edit.range.start), to: offsetOf(text, edit.range.end), insert: edit.newText })).sort((a, b) => a.from - b.from)
  let out = ''
  let at = 0
  let mapped = cursor
  for (const change of changes) {
    out += text.slice(at, change.from) + change.insert
    if (change.to <= cursor) mapped += change.insert.length - (change.to - change.from)
    else if (change.from < cursor) mapped = out.length
    at = change.to
  }
  return { text: out + text.slice(at), cursor: mapped }
}

/** The smallest single change turning `before` into `after`. */
function diffEdit(before: string, after: string, cursor: number): FormatEdit {
  let prefix = 0
  const limit = Math.min(before.length, after.length)
  while (prefix < limit && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return { changes: [{ from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) }], anchor: cursor, head: cursor }
}

function lspEdit(source: string, edits: readonly ContinuationEdit[], cursor: number): FormatEdit {
  const applied = applyLspEdits(source, edits, cursor)
  return diffEdit(source, applied.text, applied.cursor)
}

// Quote markers and indent ahead of a line's own marker.
const CONTAINER_LEAD = /^(?:[ \t]*> ?)*[ \t]*/
// A content-less marker, checked boxes included, or carve-lsp's own set (which adds `: `).
const BARE_ENTER_MARKER = { test: (rest: string): boolean => BARE_MARKER.test(rest) || BARE_CONTINUATION_MARKER.test(rest) }

// The line starts of everything carve-lsp continues: list, quote, description,
// footnote and table lines, and code or colon fence openers.
const CONTINUABLE = /^[ \t]*(?:>|[-*.]|[0-9]+[.)]|[A-Za-z]+[.)]|:|\[\^|\||`{3,}|~{3,})/

/** True when `lineText`, after its quote markers and indent, is only a content-less marker. */
export function isBareMarkerLine(lineText: string): boolean {
  const rest = lineText.slice(CONTAINER_LEAD.exec(lineText)![0].length)
  return rest !== '' && BARE_ENTER_MARKER.test(rest)
}

/**
 * Enter, following carve-lsp's on-type rules: the next list marker (also in a
 * quote, after an attributed marker or in a description list), the quote or
 * table prefix, and the closer of a code or colon fence opened on the line.
 * A content-less marker or quote line is cleared instead, which ends the list
 * or quote. The text after the caret moves to the new line behind the prefix.
 *
 * Null when the caret sits inside the line's container lead or marker, or the
 * line continues nothing, so the default Enter runs.
 */
export function listContinuationEdit(source: string, lineFrom: number, lineTo: number, head: number): FormatEdit | null {
  const before = source.slice(lineFrom, head)
  const tail = source.slice(head, lineTo)
  const lead = CONTAINER_LEAD.exec(before)![0]
  const rest = before.slice(lead.length)
  if (tail !== '' && (rest === '' || BARE_ENTER_MARKER.test(rest))) return null
  // Every rule below parses the whole document; a line no rule can continue skips that.
  if (!CONTINUABLE.test(before)) return null
  // Zero-based index of the line Enter creates.
  let line = 1
  for (let index = source.indexOf('\n'); index !== -1 && index < lineFrom; index = source.indexOf('\n', index + 1)) line++
  // Measured with the tail removed, so the new line is blank the way the rules expect.
  const blank = source.slice(0, head) + '\n' + source.slice(lineTo)
  const list = listContinuationEdits(blank, { line, character: 0 })
  if (list) {
    const applied = applyLspEdits(blank, list, head + 1)
    const after = applied.text.slice(0, applied.cursor) + tail + applied.text.slice(applied.cursor)
    return diffEdit(source, after, applied.cursor)
  }
  const prefix = continuationPrefix(source.slice(0, head) + '\n' + source.slice(head), line)
  if (!prefix) return null
  // A pipe-led line that is neither a table row nor a line-block line is text,
  // and a row split mid-cell is not a new row.
  if (/^[ \t]*\| $/.test(prefix) && (tail !== '' || (!/^[ \t]*\|.*\|[ \t]*$/.test(before) && !/^[ \t]*\| /.test(before)))) return null
  const newline = prefix.indexOf('\n')
  const ahead = newline === -1 ? prefix : prefix.slice(0, newline)
  const behind = newline === -1 ? '' : prefix.slice(newline)
  const cursor = head + 1 + ahead.length
  return { changes: [{ from: head, to: head, insert: `\n${ahead}${behind}` }], anchor: cursor, head: cursor }
}

export function taskToggleEdit(source: string, lineFrom: number, lineTo: number): FormatEdit {
  const line = source.slice(lineFrom, lineTo)
  const task = /^([ \t]*[-*] [ \t]*)\[([ xX_>?-])\]( [ \t]*|$)/.exec(line)
  if (task) {
    const from = lineFrom + task[1]!.length + 1; const checked = task[2]!.toLowerCase() === 'x'
    return { changes: [{ from, to: from + 1, insert: checked ? ' ' : 'x' }], anchor: from, head: from }
  }
  const marker = /^([ \t]*)[-*] [ \t]*/.exec(line)
  if (marker) return { changes: [{ from: lineFrom + marker[1]!.length, to: lineFrom + marker[0].length, insert: '- [ ] ' }], anchor: lineFrom + marker[1]!.length + 6, head: lineFrom + marker[1]!.length + 6 }
  const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
  return { changes: [{ from: lineFrom + indent.length, to: lineFrom + indent.length, insert: '- [ ] ' }], anchor: lineFrom + indent.length + 6, head: lineFrom + indent.length + 6 }
}

function changeListIndent(outdent: boolean): Command {
  return (view) => {
    const selection = view.state.selection.main
    const edit = listIndentEdit(view.state.doc.toString(), selection.from, selection.to, outdent)
    if (!edit) return false
    view.dispatch({ changes: edit.changes, scrollIntoView: true }); return true
  }
}
const indentList = changeListIndent(false)
const outdentList = changeListIndent(true)
const continueList: Command = (view) => {
  const selection = view.state.selection.main; if (!selection.empty) return false
  const line = view.state.doc.lineAt(selection.head); const edit = listContinuationEdit(view.state.doc.toString(), line.from, line.to, selection.head)
  if (!edit) return false; view.dispatch({ changes: edit.changes, selection: EditorSelection.cursor(edit.head), scrollIntoView: true }); return true
}
const toggleTaskAtCursor: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head); const edit = taskToggleEdit(view.state.doc.toString(), line.from, line.to)
  view.dispatch({ changes: edit.changes, scrollIntoView: true }); return true
}

export const carveEditorCommands: Extension = Prec.highest(keymap.of([
  { key: 'Mod-b', run: toggleStrong },
  { key: 'Mod-i', run: toggleEmphasis },
  { key: 'Mod-Shift-x', run: toggleStrike },
  { key: 'Mod-Shift-h', run: toggleHighlight },
  { key: 'Mod-Shift-c', run: toggleCode },
  { key: 'Mod-k', run: createLink },
  { key: 'Mod-Enter', run: toggleTaskAtCursor },
  { key: 'Tab', run: indentList },
  { key: 'Shift-Tab', run: outdentList },
  { key: 'Enter', run: continueList },
]))
