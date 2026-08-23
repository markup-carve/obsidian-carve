import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
  HTMLTableCellElement: window.HTMLTableCellElement,
  HTMLTableRowElement: window.HTMLTableRowElement,
  HTMLTableElement: window.HTMLTableElement,
})

const { addTableColumn, addTableRow, alignTableColumn, createTable, deleteTableColumn, deleteTableRow, ensureTablePlaceholders, isSimpleTable, moveTableColumn, moveTableRow, parseTableSize, setTableCaption, sortTableColumn, toggleTableHeader, toggleTableHeaderAxis } = await import('../dist-test/visual-table.js')

test('parses and bounds requested table dimensions', () => {
  assert.deepEqual(parseTableSize('3 × 4'), [3, 4])
  assert.deepEqual(parseTableSize('99x0'), [20, 1])
  assert.deepEqual(parseTableSize('invalid'), [2, 2])
  assert.equal(parseTableSize(null), null)
})

test('creates an accessible two-dimensional table structure', () => {
  const table = createTable(3, 3)
  assert.equal(table.rows.length, 3)
  assert.deepEqual(Array.from(table.rows, (row) => row.cells.length), [3, 3, 3])
  assert.equal(table.rows[0].cells[0].tagName, 'TH')
  assert.equal(table.rows[1].cells[0].tagName, 'TD')
  assert.ok(table.rows[1].cells[0].querySelector('br[data-carve-placeholder]'))
})

test('adds editor-only caret targets to existing empty cells', () => {
  const host = document.createElement('div')
  host.innerHTML = '<table><tr><td></td><td>content</td></tr></table>'
  ensureTablePlaceholders(host)
  assert.ok(host.querySelector('td:first-child br[data-carve-placeholder]'))
  assert.equal(host.querySelector('td:last-child br'), null)
})

test('inserts rows before, after, and between existing rows', () => {
  const table = createTable()
  const bodyCell = table.rows[1].cells[0]
  assert.equal(addTableRow(bodyCell, 'before')?.rowIndex, 1)
  assert.equal(addTableRow(table.rows[1].cells[0], 'after')?.rowIndex, 2)
  assert.deepEqual(Array.from(table.rows, (row) => row.cells.length), [2, 2, 2, 2])
})

test('inserts and deletes columns across both table axes', () => {
  const table = createTable(3, 2)
  const created = addTableColumn(table.rows[1].cells[0], 'after')
  assert.equal(created.length, 3)
  assert.deepEqual(Array.from(table.rows, (row) => row.cells.length), [3, 3, 3])
  assert.equal(deleteTableColumn(table.rows[1].cells[1]), true)
  assert.deepEqual(Array.from(table.rows, (row) => row.cells.length), [2, 2, 2])
})

test('moves rows and columns in both directions without rewriting cells', () => {
  const table = createTable(3, 3)
  table.rows[1].cells[0].textContent = 'first'
  table.rows[2].cells[0].textContent = 'second'
  assert.equal(moveTableRow(table.rows[2].cells[0], 'before')?.textContent, 'second')
  assert.deepEqual(Array.from(table.rows, (row) => row.cells[0].textContent).slice(1), ['second', 'first'])
  table.rows[1].cells[1].textContent = 'middle'
  assert.equal(moveTableColumn(table.rows[1].cells[1], 'before')?.textContent, 'middle')
  assert.equal(table.rows[1].cells[0].textContent, 'middle')
  assert.equal(moveTableColumn(table.rows[1].cells[0], 'after')?.textContent, 'middle')
  assert.equal(table.rows[1].cells[1].textContent, 'middle')
})

test('sorts table body rows while preserving the header and active cell', () => {
  const table = createTable(4, 2)
  for (const [row, value] of ['10', '2', 'Alpha'].entries()) table.rows[row + 1].cells[0].textContent = value
  const active = table.rows[1].cells[0]
  assert.equal(sortTableColumn(active)?.textContent, '10')
  assert.deepEqual(Array.from(table.rows, (row) => row.cells[0].textContent).slice(1), ['2', '10', 'Alpha'])
  assert.equal(sortTableColumn(active, true)?.textContent, '10')
  assert.deepEqual(Array.from(table.rows, (row) => row.cells[0].textContent).slice(1), ['Alpha', '10', '2'])
})

test('aligns the complete active column with importer-compatible attributes', () => {
  const table = createTable(3, 2)
  const active = table.rows[1].cells[1]
  assert.equal(alignTableColumn(active, 'center'), active)
  assert.deepEqual(Array.from(table.rows, (row) => row.cells[1].getAttribute('align')), ['center', 'center', 'center'])
})

test('never deletes the final row or final column', () => {
  const table = createTable(1, 1)
  assert.equal(deleteTableRow(table.rows[0].cells[0]), false)
  assert.equal(deleteTableColumn(table.rows[0].cells[0]), false)
})

test('protects merged-cell tables from ambiguous column edits', () => {
  const table = createTable()
  table.rows[0].cells[0].colSpan = 2
  assert.equal(isSimpleTable(table), false)
  assert.deepEqual(addTableColumn(table.rows[1].cells[0], 'after'), [])
})

test('toggles row/column headers without losing cell content', () => {
  const table = createTable()
  const cell = table.rows[1].cells[0]
  cell.textContent = 'Row label'
  const header = toggleTableHeader(cell)
  assert.equal(header.tagName, 'TH')
  assert.equal(header.textContent, 'Row label')
  assert.equal(toggleTableHeader(header).tagName, 'TD')
})

test('toggles complete header rows and columns from the active cell', () => {
  const table = createTable(2, 2); table.rows[0].cells[0].textContent = 'A'; table.rows[1].cells[0].textContent = 'B'
  const rowCell = toggleTableHeaderAxis(table.rows[0].cells[0], 'row')
  assert.deepEqual(Array.from(table.rows[0].cells).map((cell) => cell.tagName), ['TD', 'TD'])
  assert.equal(rowCell.textContent, 'A')
  toggleTableHeaderAxis(table.rows[1].cells[0], 'column')
  assert.deepEqual(Array.from(table.rows).map((row) => row.cells[0].tagName), ['TH', 'TH'])
  assert.equal(table.rows[1].cells[0].textContent, 'B')
})

test('adds, updates, and removes a table caption', () => {
  const table = createTable()
  assert.equal(setTableCaption(table, '  Results  ')?.textContent, 'Results')
  assert.equal(setTableCaption(table, ''), null)
  assert.equal(table.caption, null)
})
