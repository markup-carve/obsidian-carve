/**
 * Locating the include directive under a cursor, and deciding what opening it
 * should do.
 *
 * The engine is the authority for recognition: a `{{ }}` token inside a code
 * span, a fence or a malformed option list is text. A 0.2 parse keeps every
 * live directive as an `include` node with its position (C2-N-083), so the
 * gesture and the preview cannot disagree about which tokens are live.
 */
import { mappedNodes } from './engine.js'
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

/** Every live include directive in `source`, in source order. */
export function directiveSites(source: string): DirectiveSite[] {
  if (!source.includes('{{')) return []
  return mappedNodes(source)
    .filter((node) => node.type === 'include' && typeof node.node['path'] === 'string')
    .map((node) => ({ path: node.node['path'] as string, from: node.start, to: node.end }))
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
