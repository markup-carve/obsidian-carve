import { Events, TFile, type App, type EventRef } from 'obsidian'
import { extractMetadata, withCrvExtension, type CarveMetadata } from './metadata'

export class CarveIndex extends Events {
  private entries = new Map<string, CarveMetadata>()
  private refs: EventRef[] = []
  constructor(private app: App) { super() }

  async start(): Promise<void> {
    await this.rebuild()
    this.refs.push(this.app.vault.on('create', (file) => { if (file instanceof TFile && file.extension === 'crv') void this.refresh(file) }))
    this.refs.push(this.app.vault.on('modify', (file) => { if (file instanceof TFile && file.extension === 'crv') void this.refresh(file) }))
    this.refs.push(this.app.vault.on('delete', (file) => { this.entries.delete(file.path); this.trigger('changed') }))
    this.refs.push(this.app.vault.on('rename', (file, oldPath) => { this.entries.delete(oldPath); if (file instanceof TFile && file.extension === 'crv') void this.refresh(file) }))
  }

  stop(): void { for (const ref of this.refs) this.app.vault.offref(ref); this.refs = []; this.entries.clear() }
  get(path: string): CarveMetadata | undefined { return this.entries.get(path) }
  all(): ReadonlyMap<string, CarveMetadata> { return this.entries }

  backlinks(path: string): string[] {
    const wanted = path.replace(/\.crv$/i, '')
    return [...this.entries].filter(([source, data]) => source !== path && data.links.some((link) => {
      const target = withCrvExtension(link.target).replace(/\.crv$/i, '')
      return target === wanted || target === wanted.split('/').at(-1)
    })).map(([source]) => source)
  }

  search(query: string): string[] {
    const needle = query.toLocaleLowerCase()
    return [...this.entries].filter(([path, data]) => path.toLocaleLowerCase().includes(needle) || data.headings.some((h) => h.text.toLocaleLowerCase().includes(needle)) || data.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))).map(([path]) => path)
  }

  private async rebuild(): Promise<void> {
    await Promise.all(this.app.vault.getFiles().filter((file) => file.extension === 'crv').map((file) => this.refresh(file, false)))
    this.trigger('changed')
  }

  private async refresh(file: TFile, notify = true): Promise<void> {
    try { this.entries.set(file.path, extractMetadata(await this.app.vault.cachedRead(file))) }
    catch { this.entries.delete(file.path) }
    if (notify) this.trigger('changed')
  }
}
