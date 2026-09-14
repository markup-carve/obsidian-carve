import { carveToHtml } from '@markup-carve/carve'

/** Raw HTML is deliberately disabled for vault content by default. */
export const RENDER_OPTIONS = { allowRawHtml: false } as const

export function renderCarve(source: string): string {
  return carveToHtml(rewriteWikiSyntax(source), RENDER_OPTIONS)
}

/**
 * `base` rebases a relative wikilink against a vault folder. Content pulled in
 * by an include is rendered inside the ROOT document, which is the only path
 * the reading view can resolve a link against, so a child's links have to name
 * their target from the vault root before they get there.
 */
export function rewriteWikiSyntax(source: string, base = ''): string {
  return source.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_all, bang: string, target: string, fragment: string = '', alias: string = '') => {
    const label = alias || target
    const clean = target.trim()
    const rebased = base && !clean.startsWith('/') ? `${base}/${clean}` : clean
    const href = `${rebased}${fragment || ''}`
    return bang ? `[Embedded: ${label}](${href}){.carve-embed data-carve-embed="${rebased}"}` : `[${label}](${href}){.carve-wikilink}`
  })
}
