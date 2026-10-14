import { carveToHtml, parse, type Document } from '@markup-carve/carve'
import { codepointToUtf16 } from './offsets.js'

/** Raw HTML is deliberately disabled for vault content by default. */
export const RENDER_OPTIONS = { allowRawHtml: false } as const

export function renderCarve(source: string): string {
  return carveToHtml(rewriteWikiSyntax(source), RENDER_OPTIONS)
}

const WIKILINK = /(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g

// Wiki syntax overlapping one of these is literal source, not a link.
const VERBATIM = new Set(['code', 'code_block', 'math', 'raw_inline', 'raw_block', 'comment', 'escaped_text', 'autolink', 'literal_inline', 'critic_comment', 'link_reference_definition'])

/** A `[[target#fragment|alias]]` the engine reads as text, with UTF-16 offsets. */
export interface WikiMatch { start: number; end: number; embed: boolean; target: string; fragment: string; alias: string }

interface Span { from: number; to: number }

function collectSpans(node: unknown, toUtf16: (offset: number) => number, text: Span[], verbatim: Span[]): void {
  if (node === null || typeof node !== 'object') return
  const record = node as { type?: unknown; pos?: { startOffset?: number; endOffset?: number } }
  const pos = record.pos
  if (typeof record.type === 'string' && pos?.startOffset !== undefined && pos.endOffset !== undefined) {
    const span = { from: toUtf16(pos.startOffset), to: toUtf16(pos.endOffset) }
    if (record.type === 'text') text.push(span)
    // `[[A]]{#id}` parses as a span whose opening bracket is the wikilink's.
    else if (record.type === 'span') text.push({ from: span.from, to: span.from + 1 })
    else if (VERBATIM.has(record.type)) { verbatim.push(span); return }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'pos') continue
    if (Array.isArray(value)) for (const child of value) collectSpans(child, toUtf16, text, verbatim)
    else if (value !== null && typeof value === 'object') collectSpans(value, toUtf16, text, verbatim)
  }
}

/**
 * Every wikilink in `source` that the engine reads as plain text.
 *
 * A match counts only when it starts inside a `text` node (or opens a span,
 * as `[[A]]{#id}` does) and touches no
 * verbatim node, so wiki syntax in a code span, a fence, a comment, math, a
 * link destination, front matter or after a backslash escape stays literal.
 * Pass `document` when it is already parsed with positions.
 */
export function wikilinkMatches(source: string, document?: Document): WikiMatch[] {
  if (!source.includes('[[')) return []
  const tree = document ?? parse(source, { positions: true })
  const toUtf16 = codepointToUtf16(source)
  const text: Span[] = []
  const verbatim: Span[] = []
  collectSpans(tree.children, toUtf16, text, verbatim)
  text.sort((a, b) => a.from - b.from)
  verbatim.sort((a, b) => a.from - b.from)
  const matches: WikiMatch[] = []
  let t = 0
  let v = 0
  for (const match of source.matchAll(WIKILINK)) {
    const start = match.index
    const end = start + match[0].length
    while (t < text.length && (text[t] as Span).to <= start) t++
    while (v < verbatim.length && (verbatim[v] as Span).to <= start) v++
    const inText = t < text.length && (text[t] as Span).from <= start
    let touchesVerbatim = false
    for (let index = v; index < verbatim.length && (verbatim[index] as Span).from < end; index++) if ((verbatim[index] as Span).to > start) { touchesVerbatim = true; break }
    if (!inText || touchesVerbatim) continue
    matches.push({ start, end, embed: match[1] === '!', target: match[2] as string, fragment: match[3] ?? '', alias: match[4] ?? '' })
  }
  return matches
}

// `encodeURIComponent` leaves `(` and `)` alone, and an unbalanced one ends a
// Carve link destination early.
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
const encodePath = (path: string): string => path.split('/').map(encodeSegment).join('/')

/** `decodeURIComponent`, returning the input unchanged when it is not valid percent-encoding. */
export function safeDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/**
 * `base` rebases a relative wikilink against a vault folder. Content pulled in
 * by an include is rendered inside the ROOT document, which is the only path
 * the reading view can resolve a link against, so a child's links have to name
 * their target from the vault root before they get there.
 *
 * The destination is percent-encoded so a target with spaces or parentheses
 * stays one Carve destination; the reading view decodes it on click.
 */
export function rewriteWikiSyntax(source: string, base = ''): string {
  const matches = wikilinkMatches(source)
  if (!matches.length) return source
  let out = ''
  let at = 0
  for (const { start, end, embed, target, fragment, alias } of matches) {
    const label = alias || target
    const clean = target.trim()
    const rebased = encodePath(base && !clean.startsWith('/') ? `${base}/${clean}` : clean)
    const href = `${rebased}${fragment ? `#${encodeSegment(fragment.slice(1))}` : ''}`
    out += source.slice(at, start) + (embed ? `[Embedded: ${label}](${href}){.carve-embed data-carve-embed="${rebased}"}` : `[${label}](${href}){.carve-wikilink}`)
    at = end
  }
  return out + source.slice(at)
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
