/**
 * Locating the include directive under a cursor, and deciding what opening it
 * should do.
 *
 * The engine is the authority for recognition: a `{{ }}` token inside a code
 * span, a fence or a malformed option list is text, and the expander never
 * asks for it. `findDirectiveSites` visits exactly the blocks and inline
 * containers the expander visits, so the gesture and the preview cannot
 * disagree about which tokens are live.
 *
 * This module used to answer that question itself - a `{{ ... }}` regex over
 * the source, then one throwaway `expandIncludes` run per candidate with a
 * sentinel path, to see whether the expander asked for it. That was correct
 * and quadratic. The locator replaces both.
 */
import { findDirectiveSites, parse, type DirectiveSite as EngineDirectiveSite } from '@markup-carve/carve'
import { containmentMessage, resolveVaultPath, unresolvedMessage } from './includes.js'

/** A live include directive, with UTF-16 offsets into the source. */
export interface DirectiveSite {
  /** Path exactly as the directive spells it. */
  path: string
  from: number
  to: number
}

export type IncludeNavigation =
  | { kind: 'open'; path: string }
  | { kind: 'denied'; message: string }
  | { kind: 'missing'; message: string }

/**
 * Translate a codepoint offset into a UTF-16 one.
 *
 * `DirectiveSite.start` and `.end` count CODEPOINTS; every offset on this side
 * - a CodeMirror selection head, a `String.prototype.slice` - counts UTF-16
 * units. The two agree until a document holds one astral character, and from
 * there every directive after it is off by one unit per emoji. A source with
 * no high surrogate in it cannot differ, so the walk is skipped entirely.
 */
function codepointToUtf16(source: string): (offset: number) => number {
  if (!/[\uD800-\uDBFF]/.test(source)) return (offset) => offset
  const units: number[] = []
  for (let index = 0; index < source.length;) {
    units.push(index)
    index += (source.codePointAt(index) as number) > 0xffff ? 2 : 1
  }
  units.push(source.length)
  return (offset) => units[Math.min(Math.max(offset, 0), units.length - 1)] as number
}

function siteOf(site: EngineDirectiveSite, toUtf16: (offset: number) => number): DirectiveSite {
  return { path: site.directive.path, from: toUtf16(site.start), to: toUtf16(site.end) }
}

/** Every live include directive in `source`, in source order. */
export function directiveSites(source: string): DirectiveSite[] {
  if (!source.includes('{{')) return []
  const found = findDirectiveSites(parse(source, { positions: true }))
  if (!found.length) return []
  const toUtf16 = codepointToUtf16(source)
  return found.map((site) => siteOf(site, toUtf16))
}

/**
 * The live directive `offset` falls inside, or null.
 *
 * A cursor immediately after the closing braces still counts as on the
 * directive - that is where a click on its last character lands, and where a
 * caret sits after typing one - but a token that contains the offset outright
 * wins over a neighbour that merely ends there.
 */
export function directiveSiteAt(source: string, offset: number): DirectiveSite | null {
  const sites = directiveSites(source)
  return sites.find((site) => offset >= site.from && offset < site.to)
    ?? sites.find((site) => offset === site.to)
    ?? null
}

/**
 * What opening `path`, written in `parent`, should do.
 *
 * `exists` is the vault gateway's view, so a target is reached the same way
 * expansion reaches it and the process working directory stays unreachable
 * rather than merely refused.
 */
export function includeNavigation(path: string, parent: string, exists: (vaultPath: string) => boolean): IncludeNavigation {
  const target = resolveVaultPath(path, parent)
  if (target === null) return { kind: 'denied', message: containmentMessage(path) }
  if (!exists(target)) return { kind: 'missing', message: unresolvedMessage(path) }
  return { kind: 'open', path: target }
}
