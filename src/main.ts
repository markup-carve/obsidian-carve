import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { FuzzySuggestModal, Modal, Plugin, TFile, TextFileView, WorkspaceLeaf, finishRenderMath, loadMermaid, normalizePath, renderMath, type App, type FuzzyMatch } from 'obsidian'
import { CarveIndex } from './indexer'
import { extractMetadata, withCrvExtension, type CarveMetadata } from './metadata'
import { renderCarve } from './render'
import { carveHighlighting, carveLanguage } from './syntax'
import { createCarveLivePreview } from './live-preview'
import { carveEditorCommands, createLink, editTable, insertHorizontalRule, insertSimpleTable, setHeading, setLinePrefix, toggleCode, toggleEmphasis, toggleHighlight, toggleStrike, toggleStrong, wrapCallout, wrapCodeBlock } from './editor-commands'
import { appendOpaqueConstruct, editOpaqueWithPrompts, opaqueBlock, renderOpaqueConstruct, sourceToVisualDocument, updateOpaqueConstruct, visualHtmlToSource, type OpaqueConstruct } from './wysiwyg'
import { addTableColumn, addTableRow, alignTableColumn, createTable, deleteTableColumn, deleteTableRow, ensureCellPlaceholder, ensureTablePlaceholders, focusCell, isSimpleTable, moveTableColumn, moveTableRow, parseTableSize, selectionCell, setTableCaption, sortTableColumn, tableCellRectangle, tableCellsToTsv, toggleTableHeader, toggleTableHeaderAxis } from './visual-table'
import { applyVisualInputRule, backspaceVisualListItem, clearVisualFormatting, continueVisualList, formatVisualBlock, indentVisualListItem, insertFormattedText, insertPlainText, insertSanitizedHtml, insertVisualLink, insertVisualRule, toggleVisualList, toggleVisualTask, toggleVisualTaskAtSelection, unlinkVisualSelection, wrapVisualSelection } from './visual-editing'
import { captureVisualSnapshot, restoreVisualSnapshot, type VisualSnapshot } from './visual-history'

export const CARVE_VIEW_TYPE = 'carve-view'
export type CarveViewMode = 'preview' | 'source' | 'split' | 'visual'

interface CarveSearchEntry { path: string; searchable: string }
class CarveSearchModal extends FuzzySuggestModal<CarveSearchEntry> {
  constructor(private plugin: CarvePlugin) { super(plugin.app); this.setPlaceholder('Search Carve files, headings, and tags…') }
  getItems(): CarveSearchEntry[] { return [...this.plugin.index.all()].map(([path, data]) => ({ path, searchable: `${path} ${data.headings.map((heading) => heading.text).join(' ')} ${data.tags.map((tag) => `#${tag}`).join(' ')}` })) }
  getItemText(item: CarveSearchEntry): string { return item.searchable }
  renderSuggestion(match: FuzzyMatch<CarveSearchEntry>, el: HTMLElement): void { el.createDiv({ text: match.item.path }); el.createDiv({ cls: 'suggestion-note', text: match.item.searchable.slice(match.item.path.length).trim() }) }
  onChooseItem(item: CarveSearchEntry): void { void this.plugin.openCarve(item.path) }
}

class CarveConstructModal extends Modal {
  constructor(app: App, private item: OpaqueConstruct, private save: (source: string) => void) { super(app) }
  onOpen(): void {
    this.titleEl.setText(`Edit ${this.item.kind.replace(/_/g, ' ')}`)
    this.contentEl.addClass('carve-construct-editor')
    const editor = this.contentEl.createEl('textarea', { attr: { 'aria-label': 'Exact Carve source', rows: '10', spellcheck: 'false' } })
    editor.value = this.item.source
    this.contentEl.createDiv({ cls: 'carve-construct-preview-label', text: 'Live preview' })
    const preview = this.contentEl.createDiv({ cls: ['carve-construct-preview', 'markdown-rendered'], attr: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Construct preview' } })
    const update = (): void => { preview.innerHTML = renderOpaqueConstruct({ ...this.item, source: editor.value }) }
    editor.addEventListener('input', update); update()
    const actions = this.contentEl.createDiv({ cls: 'carve-construct-actions' })
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }); cancel.addEventListener('click', () => this.close())
    const save = actions.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'button' } })
    save.addEventListener('click', () => { this.save(editor.value); this.close() })
    editor.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save.click() } })
    editor.focus(); editor.setSelectionRange(0, editor.value.length)
  }
}

export class CarveView extends TextFileView {
  private mode: CarveViewMode = 'preview'
  private source = ''
  private editor: EditorView | null = null
  private renderSerial = 0
  private saveTimer: number | null = null
  private visualOriginal = ''
  private visualCleanup: (() => void) | null = null

  constructor(leaf: WorkspaceLeaf, private plugin: CarvePlugin) { super(leaf); this.navigation = true }
  getViewType(): string { return CARVE_VIEW_TYPE }
  getDisplayText(): string { return this.file?.basename ?? 'Carve' }
  getIcon(): string { return 'file-text' }

  async onOpen(): Promise<void> {
    this.addAction('book-open', 'Reading view', () => this.setMode('preview'))
    this.addAction('pencil', 'Source view', () => this.setMode('source'))
    this.addAction('columns-2', 'Live split view', () => this.setMode('split'))
    this.addAction('paintbrush', 'Experimental visual editor', () => this.setMode('visual'))
    // Index writes include this view's own debounced saves. Redrawing an active
    // editor here would destroy its selection and browser undo history.
    this.registerEvent(this.plugin.index.on('changed', () => { if (this.mode === 'preview') void this.draw() }))
  }

  async onClose(): Promise<void> { this.destroyEditor() }
  setMode(mode: CarveViewMode): void { if (mode !== this.mode) { this.mode = mode; void this.draw() } }
  getMode(): CarveViewMode { return this.mode }
  setViewData(data: string, clear: boolean): void { this.source = data; if (clear) this.contentEl.empty(); void this.draw() }
  getViewData(): string { return this.editor?.state.doc.toString() ?? this.source }
  clear(): void { this.source = ''; this.destroyEditor(); this.contentEl.empty() }

  private destroyEditor(): void {
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.requestSave() }
    this.saveTimer = null
    this.editor?.destroy()
    this.editor = null
    this.visualCleanup?.(); this.visualCleanup = null
  }

  private createEditor(parent: HTMLElement, livePreview?: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: 'carve-source-toolbar', attr: { role: 'toolbar', 'aria-label': 'Source formatting' } })
    const status = parent.createDiv({ cls: 'carve-source-status', attr: { role: 'status', 'aria-live': 'polite' } })
    const host = parent.createDiv({ cls: 'carve-source-editor' })
    this.editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: this.source,
        extensions: [basicSetup, carveLanguage, carveHighlighting, ...(livePreview ? [] : [createCarveLivePreview((destination) => {
          if (/^https?:\/\//i.test(destination)) return destination
          const target = this.plugin.app.metadataCache.getFirstLinkpathDest(destination, this.file?.path ?? '')
          return target ? this.plugin.app.vault.getResourcePath(target) : null
        })]), carveEditorCommands, EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Carve source' }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            this.source = update.state.doc.toString()
            if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
            this.saveTimer = window.setTimeout(() => { this.requestSave(); this.saveTimer = null }, 250)
            if (livePreview) void this.renderPreview(livePreview)
          })],
      }),
    })
    const action = (label: string, title: string, command: (view: EditorView) => boolean): void => {
      const button = toolbar.createEl('button', { text: label, attr: { type: 'button', title, 'aria-label': title } })
      button.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const applied = this.editor ? command(this.editor) : false
        status.setText(applied ? '' : 'That action is unavailable here. Place the cursor in a compatible element; the final table row and column are protected.')
        status.toggleClass('is-warning', !applied)
        this.editor?.focus()
      })
    }
    action('B', 'Strong (Ctrl/Cmd+B)', toggleStrong)
    action('I', 'Emphasis (Ctrl/Cmd+I)', toggleEmphasis)
    action('S', 'Strikethrough', toggleStrike)
    action('=', 'Highlight', toggleHighlight)
    action('`c`', 'Inline code', toggleCode)
    action('Link', 'Create link (Ctrl/Cmd+K)', createLink)
    action('P', 'Paragraph', (view) => setHeading(view, 0))
    action('H1', 'Heading 1', (view) => setHeading(view, 1))
    action('H2', 'Heading 2', (view) => setHeading(view, 2))
    action('H3', 'Heading 3', (view) => setHeading(view, 3))
    action('H4', 'Heading 4', (view) => setHeading(view, 4))
    action('H5', 'Heading 5', (view) => setHeading(view, 5))
    action('H6', 'Heading 6', (view) => setHeading(view, 6))
    action('Table', 'Insert a 2 × 2 table', insertSimpleTable)
    action('↑ Row', 'Insert table row before', (view) => editTable(view, 'row-before'))
    action('↓ Row', 'Insert table row after', (view) => editTable(view, 'row-after'))
    action('← Col', 'Insert table column before', (view) => editTable(view, 'column-before'))
    action('→ Col', 'Insert table column after', (view) => editTable(view, 'column-after'))
    action('− Row', 'Delete table row', (view) => editTable(view, 'delete-row'))
    action('− Col', 'Delete table column', (view) => editTable(view, 'delete-column'))
    action('•', 'Toggle bulleted list item', (view) => setLinePrefix(view, 'bullet'))
    action('1.', 'Toggle numbered list item', (view) => setLinePrefix(view, 'ordered'))
    action('☐', 'Toggle task item', (view) => setLinePrefix(view, 'task'))
    action('❯', 'Toggle block quote', (view) => setLinePrefix(view, 'quote'))
    action('<>', 'Wrap selection in code fence', wrapCodeBlock)
    action('Callout', 'Wrap selection in a note callout', wrapCallout)
    action('―', 'Insert horizontal rule', insertHorizontalRule)
  }

  private async draw(): Promise<void> {
    this.destroyEditor()
    this.contentEl.empty()
    this.contentEl.className = `view-content carve-view carve-mode-${this.mode}`
    if (this.mode === 'source') { this.createEditor(this.contentEl.createDiv({ cls: 'carve-editor' })); return }
    if (this.mode === 'visual') { this.createVisualEditor(); return }
    if (this.mode === 'split') {
      const split = this.contentEl.createDiv({ cls: 'carve-split' })
      const editor = split.createDiv({ cls: 'carve-editor' })
      const preview = split.createDiv({ cls: ['carve-preview', 'markdown-rendered'] })
      this.createEditor(editor, preview)
      await this.renderPreview(preview)
      return
    }
    await this.renderPreview(this.contentEl.createDiv({ cls: ['carve-preview', 'markdown-rendered'] }))
  }

  private createVisualEditor(): void {
    this.visualOriginal = this.source
    const visual = sourceToVisualDocument(this.source)
    const shell = this.contentEl.createDiv({ cls: 'carve-visual-shell' })
    const toolbar = shell.createDiv({ cls: 'carve-visual-toolbar', attr: { role: 'toolbar', 'aria-label': 'Visual formatting' } })
    const surface = shell.createEl('article', { cls: ['carve-visual-editor', 'markdown-rendered'], attr: { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Carve visual editor', spellcheck: 'true' } })
    surface.innerHTML = visual.html
    void this.decorateVisualRich(surface)
    ensureTablePlaceholders(surface)
    const status = shell.createDiv({ cls: 'carve-visual-status', attr: { role: 'status', 'aria-live': 'polite' } })
    const history: VisualSnapshot[] = [captureVisualSnapshot(surface)]
    let historyIndex = 0
    if (visual.semanticLoss) {
      surface.contentEditable = 'false'
      shell.addClass('is-visual-locked')
      const unlock = toolbar.createEl('button', { text: 'Enable lossy editing', cls: 'carve-visual-unlock', attr: { type: 'button' } })
      unlock.addEventListener('click', () => { surface.contentEditable = 'true'; shell.removeClass('is-visual-locked'); unlock.remove(); status.setText('Lossy editing enabled for this session. Revert source remains available.'); surface.focus() })
    }
    const sync = (recordHistory = true): void => {
      if (recordHistory && history[historyIndex]?.html !== surface.innerHTML) { history.splice(historyIndex + 1); history.push(captureVisualSnapshot(surface)); historyIndex = history.length - 1 }
      const result = visualHtmlToSource(surface.innerHTML, visual.frontmatter, visual.opaque)
      this.source = result.source
      status.setText(result.diagnostics.length ? `Imported with ${result.diagnostics.length} conversion warning(s).` : 'Saved as Carve source.')
      status.toggleClass('is-warning', result.diagnostics.length > 0)
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
      this.saveTimer = window.setTimeout(() => { this.requestSave(); this.saveTimer = null }, 250)
      updateTableTools?.()
    }
    const savedRange = (): Range | null => {
      const selection = document.getSelection()
      return selection?.rangeCount && surface.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null
    }
    const restoreRange = (range: Range | null): void => {
      if (!range) return
      const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    }
    const commandButtons = new Map<string, HTMLButtonElement>()
    const pendingFormats = new Set<string>()
    const inlineCommand = (tag: string): boolean => {
      const selection = document.getSelection()
      if (selection?.isCollapsed && surface.contains(selection.anchorNode)) {
        if (pendingFormats.has(tag)) pendingFormats.delete(tag); else pendingFormats.add(tag)
        updateTableTools?.(); return true
      }
      return wrapVisualSelection(surface, tag)
    }
    const commands: Array<[string, string, () => boolean, string?]> = [
      ['B', 'Bold', () => inlineCommand('strong'), 'strong'], ['I', 'Italic', () => inlineCommand('em'), 'em'], ['U', 'Underline', () => inlineCommand('u'), 'u'], ['S', 'Strikethrough', () => inlineCommand('s'), 's'],
      ['P', 'Paragraph', () => formatVisualBlock(surface, 'p'), 'p'], ['H1', 'Heading 1', () => formatVisualBlock(surface, 'h1'), 'h1'], ['H2', 'Heading 2', () => formatVisualBlock(surface, 'h2'), 'h2'], ['H3', 'Heading 3', () => formatVisualBlock(surface, 'h3'), 'h3'], ['H4', 'Heading 4', () => formatVisualBlock(surface, 'h4'), 'h4'], ['H5', 'Heading 5', () => formatVisualBlock(surface, 'h5'), 'h5'], ['H6', 'Heading 6', () => formatVisualBlock(surface, 'h6'), 'h6'], ['<>', 'Code block', () => formatVisualBlock(surface, 'pre'), 'pre'],
      ['x²', 'Superscript', () => inlineCommand('sup'), 'sup'], ['x₂', 'Subscript', () => inlineCommand('sub'), 'sub'], ['•', 'Bulleted list', () => toggleVisualList(surface, false), 'ul'], ['1.', 'Numbered list', () => toggleVisualList(surface, true), 'ol'], ['☐', 'Task list', () => toggleVisualTaskAtSelection(surface)], ['❯', 'Block quote', () => formatVisualBlock(surface, 'blockquote'), 'blockquote'],
      ['`c`', 'Inline code', () => inlineCommand('code'), 'code'], ['=', 'Highlight', () => inlineCommand('mark'), 'mark'],
      ['―', 'Horizontal rule', () => insertVisualRule(surface)], ['Tx', 'Remove formatting', () => clearVisualFormatting(surface)],
    ]
    for (const [caption, label, command, activeTag] of commands) {
      const button = toolbar.createEl('button', { text: caption, attr: { type: 'button', 'aria-label': label, title: label } })
      button.addEventListener('mousedown', (event) => { event.preventDefault(); if (command()) sync(); else status.setText('Select compatible content first.'); surface.focus() })
      if (activeTag) commandButtons.set(activeTag, button)
    }
    const link = toolbar.createEl('button', { text: 'Link', attr: { type: 'button', title: 'Create link' } })
    link.addEventListener('mousedown', (event) => {
      event.preventDefault(); const range = savedRange(); const url = window.prompt('Link URL'); if (!url) return
      const label = range?.collapsed ? window.prompt('Link text', url) : null
      restoreRange(range); if (insertVisualLink(surface, url, label ?? url)) sync(); surface.focus()
    })
    const unlink = toolbar.createEl('button', { text: 'Unlink', attr: { type: 'button', title: 'Remove link' } })
    unlink.addEventListener('mousedown', (event) => { event.preventDefault(); if (unlinkVisualSelection(surface)) sync(); surface.focus() })
    const undo = toolbar.createEl('button', { text: 'Undo', attr: { type: 'button' } })
    undo.addEventListener('mousedown', (event) => { event.preventDefault(); if (historyIndex > 0) { restoreVisualSnapshot(surface, history[--historyIndex]!); ensureTablePlaceholders(surface); sync(false) } surface.focus() })
    const redo = toolbar.createEl('button', { text: 'Redo', attr: { type: 'button' } })
    redo.addEventListener('mousedown', (event) => { event.preventDefault(); if (historyIndex + 1 < history.length) { restoreVisualSnapshot(surface, history[++historyIndex]!); ensureTablePlaceholders(surface); sync(false) } surface.focus() })
    let openOpaqueEditor: (target: EventTarget | null) => boolean = () => false
    const insertAdvanced = (label: string, kind: string, source: string): void => {
      const button = toolbar.createEl('button', { text: label, attr: { type: 'button', title: `Insert ${kind}`, 'aria-label': `Insert ${kind}` } })
      button.addEventListener('mousedown', (event) => {
        event.preventDefault(); const range = savedRange(); const created = appendOpaqueConstruct(visual.opaque, kind, source, this.source)
        const island = document.createElement('carve-opaque'); island.className = `carve-visual-opaque ${opaqueBlock(created.item) ? 'is-block' : 'is-inline'}`
        island.dataset.carveOpaque = String(created.index); island.contentEditable = 'false'; island.setAttribute('role', 'button'); island.tabIndex = 0
        island.setAttribute('aria-label', `Edit ${kind} construct`); island.title = 'Double-click for live source editing; Enter for structured fields'; island.innerHTML = renderOpaqueConstruct(created.item)
        const anchor = range?.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range?.commonAncestorContainer.parentElement
        const block = anchor?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,pre,table')
        if (opaqueBlock(created.item) && block && surface.contains(block)) block.after(island); else if (range) { range.deleteContents(); range.insertNode(island) } else surface.append(island)
        void this.decorateVisualRich(island); sync(); island.focus(); status.setText(`${kind} inserted.`); openOpaqueEditor(island)
      })
    }
    insertAdvanced('Math', 'math', '$`x + y`')
    insertAdvanced('Diagram', 'mermaid', '```mermaid\ngraph TD\nA --> B\n```')
    insertAdvanced('Callout', 'admonition', '::: note "Note"\nWrite here.\n:::')
    insertAdvanced('Footnote', 'footnote', '[^note]: Footnote text')
    const tableTools = toolbar.createDiv({ cls: 'carve-table-tools', attr: { role: 'group', 'aria-label': 'Table editing' } })
    let activeTableCell: HTMLTableCellElement | null = null
    let tableSelectionAnchor: HTMLTableCellElement | null = null
    let selectedTableCells: HTMLTableCellElement[] = []
    const clearCellSelection = (): void => { for (const cell of selectedTableCells) { cell.removeClass('is-carve-selected'); cell.removeAttribute('aria-selected') }; selectedTableCells = [] }
    const runTableAction = (action: (cell: HTMLTableCellElement) => HTMLTableCellElement | null): void => {
        const cell = selectionCell(surface) ?? activeTableCell
        if (!cell) return
        if (!isSimpleTable(cell.closest('table')!)) { status.setText('Merged cells are protected from structural table edits; use Source view.'); status.addClass('is-warning'); return }
        clearCellSelection()
        const target = action(cell)
        if (!target) { status.setText('That table operation is unavailable at this boundary.'); status.addClass('is-warning'); return }
        focusCell(target)
        sync()
        updateTableTools()
    }
    const tableAction = (label: string, action: (cell: HTMLTableCellElement) => HTMLTableCellElement | null): void => {
      const button = tableTools.createEl('button', { text: label, attr: { type: 'button', title: label } })
      button.addEventListener('mousedown', (event) => {
        event.preventDefault(); runTableAction(action)
      })
    }
    tableAction('↑ Row', (cell) => addTableRow(cell, 'before')?.cells[cell.cellIndex] ?? null)
    tableAction('↓ Row', (cell) => addTableRow(cell, 'after')?.cells[cell.cellIndex] ?? null)
    tableAction('← Col', (cell) => addTableColumn(cell, 'before')[(cell.parentElement as HTMLTableRowElement).rowIndex] ?? null)
    tableAction('→ Col', (cell) => addTableColumn(cell, 'after')[(cell.parentElement as HTMLTableRowElement).rowIndex] ?? null)
    tableAction('− Row', (cell) => { const next = (cell.parentElement?.nextElementSibling ?? cell.parentElement?.previousElementSibling)?.children[cell.cellIndex] as HTMLTableCellElement | undefined; return deleteTableRow(cell) ? next ?? null : null })
    tableAction('− Col', (cell) => { const row = cell.parentElement as HTMLTableRowElement; const next = row.cells[cell.cellIndex + 1] ?? row.cells[cell.cellIndex - 1]; return deleteTableColumn(cell) ? next ?? null : null })
    tableAction('↑ Move', (cell) => moveTableRow(cell, 'before'))
    tableAction('↓ Move', (cell) => moveTableRow(cell, 'after'))
    tableAction('← Move', (cell) => moveTableColumn(cell, 'before'))
    tableAction('→ Move', (cell) => moveTableColumn(cell, 'after'))
    tableAction('A→Z', (cell) => sortTableColumn(cell))
    tableAction('Z→A', (cell) => sortTableColumn(cell, true))
    tableAction('Align ←', (cell) => alignTableColumn(cell, 'left'))
    tableAction('Align ↔', (cell) => alignTableColumn(cell, 'center'))
    tableAction('Align →', (cell) => alignTableColumn(cell, 'right'))
    tableAction('Cell header', (cell) => toggleTableHeader(cell))
    tableAction('Row header', (cell) => toggleTableHeaderAxis(cell, 'row'))
    tableAction('Column header', (cell) => toggleTableHeaderAxis(cell, 'column'))
    const quickTableTools = shell.createDiv({ cls: 'carve-table-quick-tools', attr: { role: 'group', 'aria-label': 'Quick table insertion' } })
    const quickAction = (label: string, title: string, action: (cell: HTMLTableCellElement) => HTMLTableCellElement | null): void => {
      const button = quickTableTools.createEl('button', { text: label, attr: { type: 'button', title, 'aria-label': title } })
      button.addEventListener('mousedown', (event) => { event.preventDefault(); runTableAction(action) })
    }
    quickAction('+↑', 'Insert row above', (cell) => addTableRow(cell, 'before')?.cells[cell.cellIndex] ?? null)
    quickAction('+↓', 'Insert row below', (cell) => addTableRow(cell, 'after')?.cells[cell.cellIndex] ?? null)
    quickAction('+←', 'Insert column left', (cell) => addTableColumn(cell, 'before')[(cell.parentElement as HTMLTableRowElement).rowIndex] ?? null)
    quickAction('+→', 'Insert column right', (cell) => addTableColumn(cell, 'after')[(cell.parentElement as HTMLTableRowElement).rowIndex] ?? null)
    const clearCells = tableTools.createEl('button', { text: 'Clear cells', attr: { type: 'button', title: 'Clear selected cells' } })
    clearCells.addEventListener('mousedown', (event) => {
      event.preventDefault(); const targets = selectedTableCells.length ? selectedTableCells : activeTableCell ? [activeTableCell] : []
      if (!targets.length) return
      for (const cell of targets) { cell.textContent = ''; ensureCellPlaceholder(cell) }
      clearCellSelection(); sync(); status.setText(`${targets.length} table cell${targets.length === 1 ? '' : 's'} cleared.`); updateTableTools()
    })
    const copyCells = tableTools.createEl('button', { text: 'Copy cells', attr: { type: 'button', title: 'Copy selected cells as tab-separated text' } })
    copyCells.addEventListener('mousedown', (event) => {
      event.preventDefault(); const targets = selectedTableCells.length ? selectedTableCells : activeTableCell ? [activeTableCell] : []; const text = tableCellsToTsv(targets)
      if (!text) return
      void navigator.clipboard.writeText(text).then(() => status.setText(`${targets.length} cell${targets.length === 1 ? '' : 's'} copied.`), () => { status.setText('Clipboard access was unavailable.'); status.addClass('is-warning') })
    })
    const caption = tableTools.createEl('button', { text: 'Caption', attr: { type: 'button' } })
    caption.addEventListener('mousedown', (event) => {
      event.preventDefault(); const cell = selectionCell(surface); const table = cell?.closest('table'); if (!table) return
      const text = window.prompt('Table caption (leave empty to remove)', table.caption?.textContent ?? ''); if (text === null) return
      setTableCaption(table, text); sync(); updateTableTools()
    })
    const insertTable = toolbar.createEl('button', { text: 'Table', attr: { type: 'button', title: 'Insert 2 × 2 table' } })
    insertTable.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const range = savedRange()
      const size = parseTableSize(window.prompt('Table size (rows × columns)', '2 × 2'))
      if (!size) return
      const table = createTable(...size)
      const anchor = range?.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range?.commonAncestorContainer.parentElement
      const block = anchor?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,pre,table')
      if (block && surface.contains(block)) block.after(table); else surface.append(table)
      focusCell(table.rows[0]?.cells[0]); sync(); updateTableTools()
    })
    const updateTableTools = (): void => {
      activeTableCell = selectionCell(surface)
      const hasActiveCell = Boolean(activeTableCell && surface.contains(activeTableCell))
      tableTools.toggleClass('is-active', hasActiveCell); quickTableTools.toggleClass('is-active', hasActiveCell)
      undo.disabled = historyIndex === 0; redo.disabled = historyIndex + 1 >= history.length
      if (hasActiveCell) {
        const rect = activeTableCell!.getBoundingClientRect()
        quickTableTools.style.left = `${Math.max(8, Math.min(window.innerWidth - 154, rect.left))}px`
        quickTableTools.style.top = `${Math.max(8, rect.bottom + 42 < window.innerHeight ? rect.bottom + 4 : rect.top - 40)}px`
      }
      const anchor = document.getSelection()?.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      for (const [tag, button] of commandButtons) { const active = pendingFormats.has(tag) || Boolean(element?.closest(tag)); button.toggleClass('is-active', active); button.setAttribute('aria-pressed', String(active)) }
    }
    const revert = toolbar.createEl('button', { text: 'Revert source', cls: 'carve-visual-revert', attr: { type: 'button', title: 'Discard this visual editing session' } })
    revert.addEventListener('click', () => { this.source = this.visualOriginal; this.requestSave(); void this.draw() })
    surface.addEventListener('input', () => {
      for (const placeholder of Array.from(surface.querySelectorAll('br[data-carve-placeholder]'))) if (placeholder.parentElement?.textContent) placeholder.remove()
      applyVisualInputRule(surface)
      sync()
    })
    surface.addEventListener('beforeinput', (event) => {
      if (event.isComposing || event.inputType !== 'insertText' || !event.data || !pendingFormats.size) return
      event.preventDefault(); if (insertFormattedText(surface, event.data, [...pendingFormats])) sync()
    })
    surface.addEventListener('compositionstart', () => status.setText('Composing text…'))
    surface.addEventListener('compositionend', () => { sync(); status.setText('Saved as Carve source.') })
    surface.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLTableCellElement>('td,th') : null
      if (target && event.shiftKey && tableSelectionAnchor?.closest('table') === target.closest('table')) {
        clearCellSelection(); selectedTableCells = tableCellRectangle(tableSelectionAnchor, target)
        for (const cell of selectedTableCells) { cell.addClass('is-carve-selected'); cell.setAttribute('aria-selected', 'true') }
        status.setText(`${selectedTableCells.length} cells selected. Use Clear cells or a table operation.`)
      } else { clearCellSelection(); tableSelectionAnchor = target }
      updateTableTools()
    })
    surface.addEventListener('scroll', updateTableTools, { passive: true })
    const repositionTableTools = (): void => updateTableTools()
    window.addEventListener('resize', repositionTableTools)
    this.visualCleanup = () => window.removeEventListener('resize', repositionTableTools)
    surface.addEventListener('focusout', (event) => {
      const next = event.relatedTarget
      if (next instanceof Node && (surface.contains(next) || toolbar.contains(next) || quickTableTools.contains(next))) return
      activeTableCell = null; clearCellSelection(); tableTools.removeClass('is-active'); quickTableTools.removeClass('is-active')
    })
    surface.addEventListener('change', (event) => {
      const checkbox = event.target
      if (checkbox instanceof HTMLInputElement && toggleVisualTask(surface, checkbox)) { sync(); status.setText(checkbox.checked ? 'Task completed.' : 'Task reopened.') }
    })
    surface.addEventListener('keyup', updateTableTools)
    const editOpaque = (target: EventTarget | null): boolean => {
      const island = target instanceof Element ? target.closest<HTMLElement>('.carve-visual-opaque') : null
      const index = Number(island?.dataset.carveOpaque)
      if (!island || !Number.isInteger(index) || !visual.opaque[index]) return false
      const next = editOpaqueWithPrompts(visual.opaque[index]!, (label, value) => window.prompt(label, value))
      if (next === null) return true
      const updated = updateOpaqueConstruct(visual.opaque, index, next)
      if (updated) { island.innerHTML = renderOpaqueConstruct(updated); void this.decorateVisualRich(island) }
      status.setText('Protected construct updated byte-for-byte.'); status.removeClass('is-warning'); sync(); island.focus()
      return true
    }
    openOpaqueEditor = (target: EventTarget | null): boolean => {
      const island = target instanceof Element ? target.closest<HTMLElement>('.carve-visual-opaque') : null
      const index = Number(island?.dataset.carveOpaque)
      if (!island || !Number.isInteger(index) || !visual.opaque[index]) return false
      new CarveConstructModal(this.app, visual.opaque[index]!, (next) => {
        const updated = updateOpaqueConstruct(visual.opaque, index, next)
        if (updated) { island.innerHTML = renderOpaqueConstruct(updated); void this.decorateVisualRich(island); sync(); status.setText('Construct updated from the live editor.') }
      }).open()
      return true
    }
    surface.addEventListener('dblclick', (event) => { if (openOpaqueEditor(event.target)) event.preventDefault() })
    surface.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase()
        if (key === 'z' && !event.shiftKey) { event.preventDefault(); if (historyIndex > 0) { restoreVisualSnapshot(surface, history[--historyIndex]!); ensureTablePlaceholders(surface); sync(false) }; return }
        if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); if (historyIndex + 1 < history.length) { restoreVisualSnapshot(surface, history[++historyIndex]!); ensureTablePlaceholders(surface); sync(false) }; return }
        const tag = key === 'b' ? 'strong' : key === 'i' ? 'em' : null
        if (tag) { event.preventDefault(); if (inlineCommand(tag)) sync(); return }
        if (event.key === 'Enter') { event.preventDefault(); if (toggleVisualTaskAtSelection(surface)) sync(); return }
        if (event.altKey && /^Digit[1-6]$/.test(event.code)) { event.preventDefault(); if (formatVisualBlock(surface, `h${event.code.slice(-1)}`)) sync(); return }
        if (event.shiftKey && event.code === 'Digit7') { event.preventDefault(); if (toggleVisualList(surface, true)) sync(); return }
        if (event.shiftKey && event.code === 'Digit8') { event.preventDefault(); if (toggleVisualList(surface, false)) sync(); return }
      }
      if (event.key === 'Escape' && (pendingFormats.size || selectedTableCells.length)) { pendingFormats.clear(); clearCellSelection(); updateTableTools(); status.setText('Pending formatting and table selection cleared.'); return }
      if (event.key === 'Enter' && editOpaque(event.target)) { event.preventDefault(); return }
      if (event.key === 'Enter' && continueVisualList(surface)) { event.preventDefault(); sync(); return }
      if (event.key === 'Backspace' && backspaceVisualListItem(surface)) { event.preventDefault(); sync(); return }
      const keyboardCell = selectionCell(surface)
      if (keyboardCell && (event.ctrlKey || event.metaKey) && /^Arrow(?:Up|Down|Left|Right)$/.test(event.key)) {
        event.preventDefault()
        const table = keyboardCell.closest('table')!; const row = keyboardCell.parentElement as HTMLTableRowElement
        const rowOffset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
        const columnOffset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
        const target = table.rows[row.rowIndex + rowOffset]?.cells[keyboardCell.cellIndex + columnOffset]
        if (target) focusCell(target); else status.setText('Reached the table boundary.')
        updateTableTools(); return
      }
      if (event.key !== 'Tab') return
      if (indentVisualListItem(surface, event.shiftKey)) { event.preventDefault(); sync(); return }
      const selectionNode = document.getSelection()?.anchorNode
      const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement
      if (selectionElement?.closest('li') && surface.contains(selectionElement)) { event.preventDefault(); status.setText(event.shiftKey ? 'This item is already at the outermost list level.' : 'The first item cannot be nested without a preceding sibling.'); return }
      const cell = selectionCell(surface)
      if (!cell) return
      event.preventDefault()
      const table = cell.closest('table')!
      const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th,td'))
      const current = cells.indexOf(cell)
      if (!event.shiftKey && current === cells.length - 1 && isSimpleTable(table)) {
        const row = addTableRow(cell, 'after'); focusCell(row?.cells[0]); sync(); updateTableTools(); return
      }
      focusCell(cells[current + (event.shiftKey ? -1 : 1)] ?? cell)
      updateTableTools()
    })
    surface.addEventListener('paste', (event) => {
      const plain = event.clipboardData?.getData('text/plain')
      const html = event.clipboardData?.getData('text/html')
      if (html) { event.preventDefault(); if (insertSanitizedHtml(surface, html)) sync(); return }
      if (plain) { event.preventDefault(); if (insertPlainText(surface, plain)) sync() }
    })
    if (visual.semanticLoss) {
      status.addClass('is-warning')
      status.setText(`Protected: rendered HTML cannot preserve every construct in this document. Visual editing is locked until explicitly enabled; Source and Live split are lossless.`)
    } else if (visual.canonicalizes || visual.diagnostics.length) {
      status.addClass('is-warning')
      status.setText(`Experimental: editing will canonicalize this document${visual.diagnostics.length ? ` and reported ${visual.diagnostics.length} import warning(s)` : ''}. Frontmatter is preserved verbatim; use Source for unsupported constructs.`)
    } else status.setText('Experimental visual mode. Frontmatter is preserved verbatim.')
    updateTableTools()
    surface.focus()
  }

  private async decorateVisualRich(root: HTMLElement): Promise<void> {
    let renderedMath = false
    for (const math of Array.from(root.querySelectorAll<HTMLElement>('carve-opaque .math'))) {
      const display = math.classList.contains('display')
      const authored = math.textContent ?? ''
      const tex = authored.replace(display ? /^\\\[|\\\]$/g : /^\\\(|\\\)$/g, '')
      math.replaceWith(renderMath(tex, display)); renderedMath = true
    }
    if (renderedMath) await finishRenderMath()
    const diagrams = Array.from(root.querySelectorAll<HTMLElement>('carve-opaque pre code.language-mermaid'))
    if (!diagrams.length) return
    const mermaid = await loadMermaid()
    for (const [index, code] of diagrams.entries()) {
      try {
        const rendered = await mermaid.render(`carve-mermaid-${Date.now()}-${index}`, code.textContent ?? '')
        const host = document.createElement('div'); host.className = 'carve-visual-mermaid'; host.innerHTML = rendered.svg; code.parentElement?.replaceWith(host)
      } catch (error) { code.parentElement?.addClass('carve-visual-render-error'); code.parentElement?.setAttribute('title', String(error)) }
    }
  }

  private async renderPreview(preview: HTMLElement): Promise<void> {
    const serial = ++this.renderSerial
    const metadata = extractMetadata(this.source)
    preview.empty()
    const layout = preview.createDiv({ cls: 'carve-reading-layout' })
    const article = layout.createEl('article', { cls: 'carve-document' })
    article.innerHTML = renderCarve(this.source)
    this.decorateCallouts(article)
    await this.resolveEmbeds(article, this.file?.path ?? '', 0)
    if (serial !== this.renderSerial) return
    this.wireLinks(article)
    this.drawInspector(layout.createEl('aside', { cls: 'carve-inspector' }), metadata)
  }

  private decorateCallouts(root: HTMLElement): void {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.admonition'))) {
      const type = Array.from(el.classList).find((name) => name !== 'admonition') ?? 'note'
      el.addClass('callout'); el.dataset.callout = type
    }
  }

  private async resolveEmbeds(root: HTMLElement, sourcePath: string, depth: number): Promise<void> {
    for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a.carve-embed'))) {
      const target = link.dataset.carveEmbed
      const file = target ? this.plugin.resolveCarve(target, sourcePath) : null
      const box = document.createElement('div'); box.addClass('carve-embedded-note')
      if (!file) box.createDiv({ cls: 'carve-embed-error', text: `Missing embed: ${target ?? ''}` })
      else if (depth >= 3) box.createDiv({ cls: 'carve-embed-error', text: `Embed depth limit: ${file.path}` })
      else {
        box.createDiv({ cls: 'carve-embed-title', text: file.basename })
        const body = box.createDiv({ cls: 'carve-embed-body' })
        body.innerHTML = renderCarve(await this.app.vault.cachedRead(file))
        this.decorateCallouts(body)
        await this.resolveEmbeds(body, file.path, depth + 1)
      }
      link.replaceWith(box)
    }
  }

  private wireLinks(root: HTMLElement): void {
    root.addEventListener('click', (event) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || /^(?:https?:|mailto:|#)/.test(href)) return
      event.preventDefault()
      void this.app.workspace.openLinkText(withCrvExtension(decodeURIComponent(href)), this.file?.path ?? '', false)
    })
  }

  private drawInspector(parent: HTMLElement, metadata: CarveMetadata): void {
    const properties = Object.entries(metadata.properties)
    if (properties.length) {
      parent.createEl('h3', { text: 'Properties' }); const list = parent.createEl('dl')
      for (const [key, value] of properties) { list.createEl('dt', { text: key }); list.createEl('dd', { text: typeof value === 'string' ? value : JSON.stringify(value) }) }
    }
    if (metadata.tags.length) {
      parent.createEl('h3', { text: 'Tags' }); const tags = parent.createDiv({ cls: 'carve-tags' })
      for (const tag of metadata.tags) tags.createEl('span', { cls: 'tag', text: `#${tag}` })
    }
    if (metadata.headings.length) {
      parent.createEl('h3', { text: 'Outline' }); const outline = parent.createEl('ul', { cls: 'carve-outline' })
      for (const [index, heading] of metadata.headings.entries()) outline.createEl('li', { cls: `carve-outline-level-${heading.level}` }).createEl('button', { text: heading.text }).addEventListener('click', () => this.contentEl.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ behavior: 'smooth' }))
    }
    const backlinks = this.file ? this.plugin.index.backlinks(this.file.path) : []
    if (backlinks.length) {
      parent.createEl('h3', { text: 'Backlinks' }); const list = parent.createEl('ul', { cls: 'carve-backlinks' })
      for (const path of backlinks) list.createEl('li').createEl('button', { text: path }).addEventListener('click', () => void this.plugin.openCarve(path))
    }
  }
}

export default class CarvePlugin extends Plugin {
  index = new CarveIndex(this.app)
  async onload(): Promise<void> {
    this.registerView(CARVE_VIEW_TYPE, (leaf) => new CarveView(leaf, this)); this.registerExtensions(['crv'], CARVE_VIEW_TYPE); await this.index.start()
    for (const [id, name, mode] of [['carve-reading-view', 'Open reading view', 'preview'], ['carve-source-view', 'Open source view', 'source'], ['carve-split-view', 'Open live split view', 'split'], ['carve-visual-view', 'Open experimental visual editor', 'visual']] as const) this.addCommand({ id, name, checkCallback: (checking) => { const view = this.app.workspace.getActiveViewOfType(CarveView); if (!view) return false; if (!checking) view.setMode(mode); return true } })
    this.addCommand({ id: 'carve-search', name: 'Search files, headings, and tags', callback: () => new CarveSearchModal(this).open() })
  }
  onunload(): void { this.index.stop() }
  async openCarve(path: string): Promise<void> { const file = this.app.vault.getAbstractFileByPath(normalizePath(path)); if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file) }
  resolveCarve(target: string, sourcePath: string): TFile | null {
    const clean = decodeURIComponent(target.split('#', 1)[0] ?? ''); const wanted = withCrvExtension(clean); const parent = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
    for (const candidate of [normalizePath(`${parent}/${wanted}`), normalizePath(wanted)]) { const file = this.app.vault.getAbstractFileByPath(candidate); if (file instanceof TFile) return file }
    const basename = wanted.split('/').at(-1)?.toLocaleLowerCase()
    return this.app.vault.getFiles().find((file) => file.extension === 'crv' && file.name.toLocaleLowerCase() === basename) ?? null
  }
}
