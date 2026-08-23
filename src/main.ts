import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { FuzzySuggestModal, Plugin, TFile, TextFileView, WorkspaceLeaf, normalizePath, type FuzzyMatch } from 'obsidian'
import { CarveIndex } from './indexer'
import { extractMetadata, withCrvExtension, type CarveMetadata } from './metadata'
import { renderCarve } from './render'
import { carveHighlighting, carveLanguage } from './syntax'
import { carveLivePreview } from './live-preview'
import { sourceToVisualDocument, visualHtmlToSource } from './wysiwyg'
import { addTableColumn, addTableRow, createTable, deleteTableColumn, deleteTableRow, ensureTablePlaceholders, focusCell, isSimpleTable, parseTableSize, selectionCell, setTableCaption, toggleTableHeader } from './visual-table'

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

export class CarveView extends TextFileView {
  private mode: CarveViewMode = 'preview'
  private source = ''
  private editor: EditorView | null = null
  private renderSerial = 0
  private saveTimer: number | null = null
  private visualOriginal = ''

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
  }

  private createEditor(parent: HTMLElement, livePreview?: HTMLElement): void {
    this.editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.source,
        extensions: [basicSetup, carveLanguage, carveHighlighting, carveLivePreview, EditorView.lineWrapping,
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
    ensureTablePlaceholders(surface)
    const status = shell.createDiv({ cls: 'carve-visual-status' })
    if (visual.semanticLoss) {
      surface.contentEditable = 'false'
      shell.addClass('is-visual-locked')
      const unlock = toolbar.createEl('button', { text: 'Enable lossy editing', cls: 'carve-visual-unlock', attr: { type: 'button' } })
      unlock.addEventListener('click', () => { surface.contentEditable = 'true'; shell.removeClass('is-visual-locked'); unlock.remove(); status.setText('Lossy editing enabled for this session. Revert source remains available.'); surface.focus() })
    }
    const sync = (): void => {
      const result = visualHtmlToSource(surface.innerHTML, visual.frontmatter)
      this.source = result.source
      status.setText(result.diagnostics.length ? `Imported with ${result.diagnostics.length} conversion warning(s).` : 'Saved as Carve source.')
      status.toggleClass('is-warning', result.diagnostics.length > 0)
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
      this.saveTimer = window.setTimeout(() => { this.requestSave(); this.saveTimer = null }, 250)
    }
    const savedRange = (): Range | null => {
      const selection = document.getSelection()
      return selection?.rangeCount && surface.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null
    }
    const restoreRange = (range: Range | null): void => {
      if (!range) return
      const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    }
    const wrapSelection = (tag: 'code' | 'mark'): void => {
      const range = savedRange()
      if (!range || range.collapsed) { status.setText(`Select text before applying ${tag === 'code' ? 'inline code' : 'highlight'}.`); return }
      const wrapper = document.createElement(tag)
      try { range.surroundContents(wrapper) } catch { wrapper.append(range.extractContents()); range.insertNode(wrapper) }
      const selection = document.getSelection(); selection?.removeAllRanges(); range.selectNodeContents(wrapper); selection?.addRange(range); sync()
    }
    const commands: Array<[string, string, string, string?]> = [
      ['B', 'Bold', 'bold'], ['I', 'Italic', 'italic'], ['U', 'Underline', 'underline'], ['S', 'Strikethrough', 'strikeThrough'],
      ['P', 'Paragraph', 'formatBlock', 'p'], ['H1', 'Heading 1', 'formatBlock', 'h1'], ['H2', 'Heading 2', 'formatBlock', 'h2'], ['H3', 'Heading 3', 'formatBlock', 'h3'], ['H4', 'Heading 4', 'formatBlock', 'h4'], ['H5', 'Heading 5', 'formatBlock', 'h5'], ['H6', 'Heading 6', 'formatBlock', 'h6'], ['<>', 'Code block', 'formatBlock', 'pre'],
      ['x²', 'Superscript', 'superscript'], ['x₂', 'Subscript', 'subscript'], ['•', 'Bulleted list', 'insertUnorderedList'], ['1.', 'Numbered list', 'insertOrderedList'], ['❯', 'Block quote', 'formatBlock', 'blockquote'],
      ['―', 'Horizontal rule', 'insertHorizontalRule'], ['Tx', 'Remove formatting', 'removeFormat'],
    ]
    for (const [caption, label, command, value] of commands) {
      const button = toolbar.createEl('button', { text: caption, attr: { type: 'button', 'aria-label': label, title: label } })
      button.addEventListener('mousedown', (event) => { event.preventDefault(); document.execCommand(command, false, value); surface.focus(); sync() })
    }
    for (const [caption, label, tag] of [['`c`', 'Inline code', 'code'], ['=', 'Highlight', 'mark']] as const) {
      const button = toolbar.createEl('button', { text: caption, attr: { type: 'button', title: label, 'aria-label': label } })
      button.addEventListener('mousedown', (event) => { event.preventDefault(); wrapSelection(tag); surface.focus() })
    }
    const link = toolbar.createEl('button', { text: 'Link', attr: { type: 'button', title: 'Create link' } })
    link.addEventListener('mousedown', (event) => { event.preventDefault(); const range = savedRange(); const url = window.prompt('Link URL'); restoreRange(range); if (url) document.execCommand('createLink', false, url); surface.focus(); sync() })
    const unlink = toolbar.createEl('button', { text: 'Unlink', attr: { type: 'button', title: 'Remove link' } })
    unlink.addEventListener('mousedown', (event) => { event.preventDefault(); document.execCommand('unlink'); surface.focus(); sync() })
    const undo = toolbar.createEl('button', { text: 'Undo', attr: { type: 'button' } })
    undo.addEventListener('mousedown', (event) => { event.preventDefault(); document.execCommand('undo'); surface.focus(); sync() })
    const redo = toolbar.createEl('button', { text: 'Redo', attr: { type: 'button' } })
    redo.addEventListener('mousedown', (event) => { event.preventDefault(); document.execCommand('redo'); surface.focus(); sync() })
    const tableTools = toolbar.createDiv({ cls: 'carve-table-tools', attr: { role: 'group', 'aria-label': 'Table editing' } })
    const tableHistory: string[] = []
    const tableAction = (label: string, action: (cell: HTMLTableCellElement) => HTMLTableCellElement | null): void => {
      const button = tableTools.createEl('button', { text: label, attr: { type: 'button', title: label } })
      button.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const cell = selectionCell(surface)
        if (!cell) return
        if (!isSimpleTable(cell.closest('table')!)) { status.setText('Merged cells are protected from structural table edits; use Source view.'); status.addClass('is-warning'); return }
        tableHistory.push(surface.innerHTML)
        focusCell(action(cell))
        sync()
        updateTableTools()
      })
    }
    tableAction('↑ Row', (cell) => addTableRow(cell, 'before')?.cells[cell.cellIndex] ?? null)
    tableAction('↓ Row', (cell) => addTableRow(cell, 'after')?.cells[cell.cellIndex] ?? null)
    tableAction('← Col', (cell) => addTableColumn(cell, 'before')[(cell.parentElement as HTMLTableRowElement).rowIndex] ?? null)
    tableAction('→ Col', (cell) => addTableColumn(cell, 'after')[(cell.parentElement as HTMLTableRowElement).rowIndex] ?? null)
    tableAction('− Row', (cell) => { const next = (cell.parentElement?.nextElementSibling ?? cell.parentElement?.previousElementSibling)?.children[cell.cellIndex] as HTMLTableCellElement | undefined; return deleteTableRow(cell) ? next ?? null : null })
    tableAction('− Col', (cell) => { const row = cell.parentElement as HTMLTableRowElement; const next = row.cells[cell.cellIndex + 1] ?? row.cells[cell.cellIndex - 1]; return deleteTableColumn(cell) ? next ?? null : null })
    tableAction('Header', (cell) => toggleTableHeader(cell))
    const caption = tableTools.createEl('button', { text: 'Caption', attr: { type: 'button' } })
    caption.addEventListener('mousedown', (event) => {
      event.preventDefault(); const cell = selectionCell(surface); const table = cell?.closest('table'); if (!table) return
      const text = window.prompt('Table caption (leave empty to remove)', table.caption?.textContent ?? ''); if (text === null) return
      tableHistory.push(surface.innerHTML); setTableCaption(table, text); sync(); updateTableTools()
    })
    const insertTable = toolbar.createEl('button', { text: 'Table', attr: { type: 'button', title: 'Insert 2 × 2 table' } })
    insertTable.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const range = savedRange()
      const size = parseTableSize(window.prompt('Table size (rows × columns)', '2 × 2'))
      if (!size) return
      tableHistory.push(surface.innerHTML)
      const table = createTable(...size)
      const anchor = range?.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range?.commonAncestorContainer.parentElement
      const block = anchor?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,pre,table')
      if (block && surface.contains(block)) block.after(table); else surface.append(table)
      focusCell(table.rows[0]?.cells[0]); sync(); updateTableTools()
    })
    const undoTable = tableTools.createEl('button', { text: 'Undo table', attr: { type: 'button' } })
    undoTable.addEventListener('mousedown', (event) => { event.preventDefault(); const html = tableHistory.pop(); if (html !== undefined) { surface.innerHTML = html; sync(); updateTableTools() } })
    const updateTableTools = (): void => { tableTools.toggleClass('is-active', selectionCell(surface) !== null); undoTable.disabled = tableHistory.length === 0 }
    const revert = toolbar.createEl('button', { text: 'Revert source', cls: 'carve-visual-revert', attr: { type: 'button', title: 'Discard this visual editing session' } })
    revert.addEventListener('click', () => { this.source = this.visualOriginal; this.requestSave(); void this.draw() })
    surface.addEventListener('input', () => {
      for (const placeholder of Array.from(surface.querySelectorAll('br[data-carve-placeholder]'))) if (placeholder.parentElement?.textContent) placeholder.remove()
      sync()
    })
    surface.addEventListener('click', updateTableTools)
    surface.addEventListener('keyup', updateTableTools)
    surface.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return
      const cell = selectionCell(surface)
      if (!cell) return
      event.preventDefault()
      const table = cell.closest('table')!
      const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th,td'))
      const current = cells.indexOf(cell)
      if (!event.shiftKey && current === cells.length - 1 && isSimpleTable(table)) {
        tableHistory.push(surface.innerHTML)
        const row = addTableRow(cell, 'after'); focusCell(row?.cells[0]); sync(); updateTableTools(); return
      }
      focusCell(cells[current + (event.shiftKey ? -1 : 1)] ?? cell)
      updateTableTools()
    })
    surface.addEventListener('paste', (event) => {
      const plain = event.clipboardData?.getData('text/plain')
      if (plain && !event.clipboardData?.getData('text/html')) { event.preventDefault(); document.execCommand('insertText', false, plain) }
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
