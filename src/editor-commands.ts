import { EditorSelection, type Extension } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'

export interface FormatEdit {
  changes: Array<{ from: number; to: number; insert: string }>
  anchor: number
  head: number
}

export type TableDirection = 'row-before' | 'row-after' | 'column-before' | 'column-after'

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
  if (direction.startsWith('row-')) {
    const row = `|${cells.map(() => '  ').join('|')}|`
    const before = direction === 'row-before'
    const from = before ? lineStart : lineEnd
    const insert = before ? `${row}\n` : `\n${row}`
    return { changes: [{ from, to: from, insert }], anchor: from + (before ? 2 : 3), head: from + (before ? 2 : 3) }
  }
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
  const relative = Math.max(1, Math.min(line.length - 1, at - lineStart))
  const cellIndex = line.slice(1, relative).split('|').length - 1 + (direction === 'column-after' ? 1 : 0)
  const block = source.slice(blockStart, blockEnd)
  const lines = block.split('\n')
  if (lines.some((row) => row.slice(1, -1).split('|').length !== cells.length)) return null
  const replacement = lines.map((row) => {
    const rowCells = row.replace(/\r$/, '').slice(1, -1).split('|')
    rowCells.splice(cellIndex, 0, '  ')
    return `|${rowCells.join('|')}|${row.endsWith('\r') ? '\r' : ''}`
  }).join('\n')
  return { changes: [{ from: blockStart, to: blockEnd, insert: replacement }], anchor: at, head: at }
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

export const carveEditorCommands: Extension = keymap.of([
  { key: 'Mod-b', run: toggleStrong },
  { key: 'Mod-i', run: toggleEmphasis },
  { key: 'Mod-Shift-x', run: toggleStrike },
  { key: 'Mod-Shift-h', run: toggleHighlight },
  { key: 'Mod-Shift-c', run: toggleCode },
  { key: 'Mod-k', run: createLink },
])
