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

const { addTableColumn, addTableRow, createTable, deleteTableColumn, deleteTableRow, isSimpleTable, parseTableSize, setTableCaption, toggleTableHeader } = await import('../dist-test/visual-table.js')

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

test('adds, updates, and removes a table caption', () => {
  const table = createTable()
  assert.equal(setTableCaption(table, '  Results  ')?.textContent, 'Results')
  assert.equal(setTableCaption(table, ''), null)
  assert.equal(table.caption, null)
})
