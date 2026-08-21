import { carveToHtml } from '@markup-carve/carve'

/** Raw HTML is deliberately disabled for vault content by default. */
export function renderCarve(source: string): string {
  return carveToHtml(rewriteWikiSyntax(source), { allowRawHtml: false })
}

export function rewriteWikiSyntax(source: string): string {
  return source.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_all, bang: string, target: string, fragment: string = '', alias: string = '') => {
    const label = alias || target
    const href = `${target.trim()}${fragment || ''}`
    return bang ? `[Embedded: ${label}](${href}){.carve-embed data-carve-embed="${target.trim()}"}` : `[${label}](${href}){.carve-wikilink}`
  })
}
