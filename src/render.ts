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

/**
 * Vault path of the file a rendered link was WRITTEN in, when that is not the
 * document it is displayed in. The reading view resolves the destination
 * against this instead of the open file's own path.
 */
export const ORIGIN_ATTRIBUTE = 'data-carve-origin'

/**
 * True when `destination` is resolved against the folder of the file that
 * wrote it. A scheme, a protocol-relative host, a vault-root `/` and a bare
 * fragment each name their target without one, so the writing file is
 * irrelevant to them.
 */
export function isFolderRelativeDestination(destination: string): boolean {
  return destination !== '' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(destination)
}

/**
 * Claim every link rendered into `root` for the file `origin` names.
 *
 * An origin the document wrote itself is dropped first, on every path: the
 * attribute states where content was pulled in FROM, so a document that
 * asserts it would otherwise redirect where a click lands. The AST pass does
 * the same for an expanded document; this is the guarantee for the plain
 * render path, which never sees the tree.
 */
export function claimRenderedOrigins(root: ParentNode, origin: string): void {
  for (const claimed of Array.from(root.querySelectorAll(`[${ORIGIN_ATTRIBUTE}]`))) claimed.removeAttribute(ORIGIN_ATTRIBUTE)
  if (origin === '') return
  for (const anchor of Array.from(root.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href')
    if (href !== null && isFolderRelativeDestination(href)) anchor.setAttribute(ORIGIN_ATTRIBUTE, origin)
  }
}

/**
 * The file the content at `element` was written in: its own origin, or the one
 * on the included region it sits inside. Null in content the open file wrote.
 */
export function originAt(element: Element | null): string | null {
  return element?.closest(`[${ORIGIN_ATTRIBUTE}]`)?.getAttribute(ORIGIN_ATTRIBUTE) ?? null
}
