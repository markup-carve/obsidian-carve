export type TableDirection = 'before' | 'after'

function editableCell(tag: 'td' | 'th'): HTMLTableCellElement {
  const cell = document.createElement(tag) as HTMLTableCellElement
  ensureCellPlaceholder(cell)
  return cell
}

export function ensureCellPlaceholder(cell: HTMLTableCellElement): void {
  if (cell.textContent || cell.querySelector('img,br:not([data-carve-placeholder])')) return
  if (!cell.querySelector('br[data-carve-placeholder]')) cell.append(document.createElement('br'))
  cell.querySelector('br:last-child')?.setAttribute('data-carve-placeholder', '')
}

export function ensureTablePlaceholders(root: ParentNode): void {
  for (const cell of Array.from(root.querySelectorAll<HTMLTableCellElement>('td,th'))) ensureCellPlaceholder(cell)
}

export function parseTableSize(input: string | null, fallback: [number, number] = [2, 2]): [number, number] | null {
  if (input === null) return null
  const match = input.trim().match(/^(\d+)\s*[x×,]\s*(\d+)$/i)
  if (!match) return fallback
  return [Math.max(1, Math.min(20, Number(match[1]))), Math.max(1, Math.min(20, Number(match[2])))]
}

export function selectionCell(surface: HTMLElement, selection: Selection | null = document.getSelection()): HTMLTableCellElement | null {
  const node = selection?.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  const cell = element?.closest<HTMLTableCellElement>('td,th') ?? null
  return cell && surface.contains(cell) ? cell : null
}

export function tableCellRectangle(anchor: HTMLTableCellElement, focus: HTMLTableCellElement): HTMLTableCellElement[] {
  const table = anchor.closest('table'); const focusTable = focus.closest('table')
  if (!table || table !== focusTable || !isSimpleTable(table)) return []
  const anchorRow = (anchor.parentElement as HTMLTableRowElement).rowIndex; const focusRow = (focus.parentElement as HTMLTableRowElement).rowIndex
  const fromRow = Math.min(anchorRow, focusRow); const toRow = Math.max(anchorRow, focusRow)
  const fromColumn = Math.min(anchor.cellIndex, focus.cellIndex); const toColumn = Math.max(anchor.cellIndex, focus.cellIndex)
  const cells: HTMLTableCellElement[] = []
  for (let row = fromRow; row <= toRow; row++) for (let column = fromColumn; column <= toColumn; column++) {
    const cell = table.rows[row]?.cells[column]; if (cell) cells.push(cell)
  }
  return cells
}

export function isSimpleTable(table: HTMLTableElement): boolean {
  return !table.querySelector('td[rowspan],td[colspan],th[rowspan],th[colspan]')
}

export function addTableRow(cell: HTMLTableCellElement, direction: TableDirection): HTMLTableRowElement | null {
  const row = cell.parentElement as HTMLTableRowElement | null
  if (!row) return null
  const created = document.createElement('tr')
  for (const sibling of Array.from(row.cells)) created.append(editableCell(sibling.tagName.toLowerCase() as 'td' | 'th'))
  row.parentElement?.insertBefore(created, direction === 'before' ? row : row.nextSibling)
  return created
}

export function addTableColumn(cell: HTMLTableCellElement, direction: TableDirection): HTMLTableCellElement[] {
  const table = cell.closest('table')
  if (!table || !isSimpleTable(table)) return []
  const index = cell.cellIndex + (direction === 'after' ? 1 : 0)
  const created: HTMLTableCellElement[] = []
  for (const row of Array.from(table.rows)) {
    const reference = row.cells[index] ?? null
    const tag = row.parentElement?.tagName === 'THEAD' || row.cells[0]?.tagName === 'TH' ? 'th' : 'td'
    const next = editableCell(tag)
    row.insertBefore(next, reference)
    created.push(next)
  }
  return created
}

export function deleteTableRow(cell: HTMLTableCellElement): boolean {
  const row = cell.parentElement as HTMLTableRowElement | null
  const table = cell.closest('table')
  if (!row || !table || table.rows.length <= 1) return false
  row.remove()
  return true
}

export function deleteTableColumn(cell: HTMLTableCellElement): boolean {
  const table = cell.closest('table')
  if (!table || !isSimpleTable(table) || table.rows[0]?.cells.length === 1) return false
  const index = cell.cellIndex
  for (const row of Array.from(table.rows)) row.cells[index]?.remove()
  return true
}

export function moveTableRow(cell: HTMLTableCellElement, direction: TableDirection): HTMLTableCellElement | null {
  const row = cell.parentElement as HTMLTableRowElement | null
  if (!row) return null
  const sibling = direction === 'before' ? row.previousElementSibling : row.nextElementSibling
  if (!(sibling instanceof HTMLTableRowElement)) return cell
  if (direction === 'before') sibling.before(row); else sibling.after(row)
  return row.cells[cell.cellIndex] ?? null
}

export function moveTableColumn(cell: HTMLTableCellElement, direction: TableDirection): HTMLTableCellElement | null {
  const table = cell.closest('table')
  if (!table || !isSimpleTable(table)) return null
  const from = cell.cellIndex
  const to = from + (direction === 'before' ? -1 : 1)
  if (to < 0 || to >= (table.rows[0]?.cells.length ?? 0)) return cell
  for (const row of Array.from(table.rows)) {
    const moving = row.cells[from]
    const target = row.cells[to]
    if (moving && target) direction === 'before' ? target.before(moving) : target.after(moving)
  }
  return table.rows[(cell.parentElement as HTMLTableRowElement).rowIndex]?.cells[to] ?? null
}

export function sortTableColumn(cell: HTMLTableCellElement, descending = false): HTMLTableCellElement | null {
  const table = cell.closest('table')
  const body = cell.parentElement?.parentElement
  if (!table || !body || body.tagName !== 'TBODY' || !isSimpleTable(table)) return null
  const index = cell.cellIndex
  const rows = Array.from(body.children).filter((row): row is HTMLTableRowElement => row instanceof HTMLTableRowElement)
  const activeRow = cell.parentElement as HTMLTableRowElement
  rows.sort((left, right) => {
    const a = left.cells[index]?.textContent?.trim() ?? ''
    const b = right.cells[index]?.textContent?.trim() ?? ''
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * (descending ? -1 : 1)
  })
  body.append(...rows)
  return activeRow.cells[index] ?? null
}

export function alignTableColumn(cell: HTMLTableCellElement, alignment: 'left' | 'center' | 'right'): HTMLTableCellElement | null {
  const table = cell.closest('table')
  if (!table || !isSimpleTable(table)) return null
  const index = cell.cellIndex
  for (const row of Array.from(table.rows)) row.cells[index]?.setAttribute('align', alignment)
  return cell
}

export function toggleTableHeader(cell: HTMLTableCellElement): HTMLTableCellElement {
  const replacement = document.createElement(cell.tagName === 'TH' ? 'td' : 'th') as HTMLTableCellElement
  for (const attribute of Array.from(cell.attributes)) replacement.setAttribute(attribute.name, attribute.value)
  while (cell.firstChild) replacement.append(cell.firstChild)
  cell.replaceWith(replacement)
  return replacement
}

export function toggleTableHeaderAxis(cell: HTMLTableCellElement, axis: 'row' | 'column'): HTMLTableCellElement | null {
  const table = cell.closest('table'); const row = cell.parentElement as HTMLTableRowElement | null
  if (!table || !row || !isSimpleTable(table)) return null
  const cells = axis === 'row' ? Array.from(row.cells) : Array.from(table.rows).map((candidate) => candidate.cells[cell.cellIndex]).filter(Boolean) as HTMLTableCellElement[]
  const makeHeader = !cells.every((candidate) => candidate.tagName === 'TH')
  let active: HTMLTableCellElement | null = null
  for (const candidate of cells) {
    if ((candidate.tagName === 'TH') === makeHeader) { if (candidate === cell) active = candidate; continue }
    const replacement = toggleTableHeader(candidate); if (candidate === cell) active = replacement
  }
  return active ?? cell
}

export function setTableCaption(table: HTMLTableElement, text: string): HTMLTableCaptionElement | null {
  table.caption?.remove()
  if (!text.trim()) return null
  const caption = table.createCaption()
  caption.textContent = text.trim()
  return caption
}

export function createTable(rows = 2, columns = 2): HTMLTableElement {
  const table = document.createElement('table')
  const head = table.createTHead().insertRow()
  for (let column = 0; column < columns; column++) head.append(editableCell('th'))
  const body = table.createTBody()
  for (let row = 1; row < rows; row++) {
    const line = body.insertRow()
    for (let column = 0; column < columns; column++) line.append(editableCell('td'))
  }
  return table
}

export function focusCell(cell: HTMLTableCellElement | undefined | null): void {
  if (!cell) return
  const range = document.createRange()
  range.selectNodeContents(cell)
  range.collapse(true)
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
