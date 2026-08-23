import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'

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
  const prefixes: Record<LinePrefix, RegExp> = { bullet: /^[-+*][ \t]+/, ordered: /^\d+[.)][ \t]+/, task: /^[-+*][ \t]+\[[ xX-]\][ \t]+/, quote: /^>[ \t]+/ }
  const insertions: Record<LinePrefix, string> = { bullet: '- ', ordered: '1. ', task: '- [ ] ', quote: '> ' }
  const own = prefixes[kind].exec(line)?.[0] ?? ''
  const any = /^(?:[-+*][ \t]+(?:\[[ xX-]\][ \t]+)?|>[ \t]+)/.exec(line)?.[0] ?? ''
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

export function listIndentEdit(source: string, lineFrom: number, lineTo: number, outdent = false): FormatEdit | null {
  const line = source.slice(lineFrom, lineTo)
  if (!/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX-]\][ \t]+)?/.test(line)) return null
  const leading = /^[ \t]*/.exec(line)?.[0] ?? ''
  if (outdent) {
    if (!leading) return null
    const remove = leading.startsWith('\t') ? 1 : Math.min(2, leading.length)
    return { changes: [{ from: lineFrom, to: lineFrom + remove, insert: '' }], anchor: lineFrom, head: lineFrom }
  }
  return { changes: [{ from: lineFrom, to: lineFrom, insert: '  ' }], anchor: lineFrom + 2, head: lineFrom + 2 }
}

export function listContinuationEdit(source: string, lineFrom: number, lineTo: number, head: number): FormatEdit | null {
  const line = source.slice(lineFrom, lineTo)
  const match = /^([ \t]*)([-+*]|(\d+)[.)])([ \t]+)(?:\[([ xX-])\]([ \t]+))?/.exec(line)
  if (!match) return null
  const content = line.slice(match[0].length)
  if (!content.trim()) return { changes: [{ from: lineFrom, to: lineFrom + match[0].length, insert: '' }], anchor: lineFrom, head: lineFrom }
  const marker = match[3] ? `${Number(match[3]) + 1}${match[2]!.endsWith(')') ? ')' : '.'}` : match[2]!
  const prefix = `${match[1]}${marker}${match[4]}${match[5] !== undefined ? `[ ]${match[6]}` : ''}`
  return { changes: [{ from: head, to: head, insert: `\n${prefix}` }], anchor: head + prefix.length + 1, head: head + prefix.length + 1 }
}

function changeListIndent(outdent: boolean): Command {
  return (view) => {
    const selection = view.state.selection.main
    const first = view.state.doc.lineAt(selection.from).number
    const last = view.state.doc.lineAt(selection.to).number
    const source = view.state.doc.toString(); const changes: FormatEdit['changes'] = []
    for (let number = first; number <= last; number++) {
      const line = view.state.doc.line(number); const edit = listIndentEdit(source, line.from, line.to, outdent)
      if (edit) changes.push(...edit.changes)
    }
    if (!changes.length) return false
    view.dispatch({ changes, scrollIntoView: true }); return true
  }
}
const indentList = changeListIndent(false)
const outdentList = changeListIndent(true)
const continueList: Command = (view) => {
  const selection = view.state.selection.main; if (!selection.empty) return false
  const line = view.state.doc.lineAt(selection.head); const edit = listContinuationEdit(view.state.doc.toString(), line.from, line.to, selection.head)
  if (!edit) return false; view.dispatch({ changes: edit.changes, selection: EditorSelection.cursor(edit.head), scrollIntoView: true }); return true
}

export const carveEditorCommands: Extension = Prec.highest(keymap.of([
  { key: 'Mod-b', run: toggleStrong },
  { key: 'Mod-i', run: toggleEmphasis },
  { key: 'Mod-Shift-x', run: toggleStrike },
  { key: 'Mod-Shift-h', run: toggleHighlight },
  { key: 'Mod-Shift-c', run: toggleCode },
  { key: 'Mod-k', run: createLink },
  { key: 'Tab', run: indentList },
  { key: 'Shift-Tab', run: outdentList },
  { key: 'Enter', run: continueList },
]))
