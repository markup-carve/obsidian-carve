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

export function toggleTableHeader(cell: HTMLTableCellElement): HTMLTableCellElement {
  const replacement = document.createElement(cell.tagName === 'TH' ? 'td' : 'th') as HTMLTableCellElement
  for (const attribute of Array.from(cell.attributes)) replacement.setAttribute(attribute.name, attribute.value)
  while (cell.firstChild) replacement.append(cell.firstChild)
  cell.replaceWith(replacement)
  return replacement
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
