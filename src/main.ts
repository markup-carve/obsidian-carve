import { Plugin, TextFileView, WorkspaceLeaf } from 'obsidian'
import { renderCarve } from './render'

export const CARVE_VIEW_TYPE = 'carve-view'

export class CarveView extends TextFileView {
  private mode: 'preview' | 'source' = 'preview'
  private source = ''

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.navigation = true
  }

  getViewType(): string { return CARVE_VIEW_TYPE }
  getDisplayText(): string { return this.file?.basename ?? 'Carve' }
  getIcon(): string { return 'file-text' }

  async onOpen(): Promise<void> {
    this.addAction('book-open', 'Reading view', () => { this.mode = 'preview'; this.draw() })
    this.addAction('pencil', 'Source view', () => { this.mode = 'source'; this.draw() })
  }

  setViewData(data: string, clear: boolean): void {
    this.source = data
    if (clear) this.contentEl.empty()
    this.draw()
  }

  getViewData(): string { return this.source }
  clear(): void { this.source = ''; this.contentEl.empty() }

  private draw(): void {
    this.contentEl.empty()
    this.contentEl.addClass('carve-view')
    if (this.mode === 'source') {
      const editor = this.contentEl.createEl('textarea', { cls: 'carve-source' })
      editor.value = this.source
      editor.setAttr('aria-label', 'Carve source')
      editor.addEventListener('input', () => {
        this.source = editor.value
        this.requestSave()
      })
      return
    }
    const preview = this.contentEl.createDiv({ cls: ['carve-preview', 'markdown-rendered'] })
    preview.innerHTML = renderCarve(this.source)
  }
}

export default class CarvePlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(CARVE_VIEW_TYPE, (leaf) => new CarveView(leaf))
    this.registerExtensions(['crv'], CARVE_VIEW_TYPE)
  }
}
