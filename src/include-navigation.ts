/**
 * Locating the include directive under a cursor, and deciding what opening it
 * should do.
 *
 * Recognition is deliberately fail-closed, and the engine is the authority for
 * it: a `{{ }}` token inside a code span or a fence is text, and the expander
 * never asks for it. Liveness is therefore decided PER OCCURRENCE - the one
 * token is rewritten to a sentinel path and expansion is run with a resolver
 * that reads nothing, so the question "would the preview expand THIS token"
 * is answered by the code that expands it. Asking only whether the path is
 * requested somewhere would make a fenced copy of a live directive navigable.
 *
 * The engine's own directive recognizers would be the direct route, but the
 * package exports neither of them.
 */
import { expandIncludes, parse } from '@markup-carve/carve'
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
 * Resolver calls allowed while collecting the live paths. Nothing is read, so
 * this bounds recognition work only; past it the later directives in a
 * document stop being navigable rather than anything misbehaving.
 */
export const MAX_RECOGNIZED_DIRECTIVES = 5000

const CANDIDATE = /\{\{([^{}]*)\}\}/g

/** A path this token could name, before the engine has ruled on it. */
interface Candidate { path: string; from: number; to: number }

/** A path no document would spell, so the probe cannot collide with a real one. */
const PROBE_PATH = '__carve-include-probe__'

function candidates(source: string): Candidate[] {
  const found: Candidate[] = []
  for (const match of source.matchAll(CANDIDATE)) {
    const path = (match[1] ?? '').trim().split(/\s+/)[0] ?? ''
    const from = match.index ?? 0
    if (path) found.push({ path, from, to: from + match[0].length })
  }
  return found
}

/** Paths the expander asks for, which is exactly the set that is live. */
function requestedPaths(source: string): Set<string> {
  const requested = new Set<string>()
  expandIncludes(parse(source, { positions: true }), source, {
    resolve: (path) => { requested.add(path); return null },
    maxWarnings: 1,
    maxResolverCalls: MAX_RECOGNIZED_DIRECTIVES,
  })
  return requested
}

/**
 * Whether the expander would resolve THIS token, established by giving it a
 * path nothing else in the document spells and asking whether that path is
 * requested.
 */
function isLive(source: string, candidate: Candidate): boolean {
  const token = source.slice(candidate.from, candidate.to).replace(candidate.path, PROBE_PATH)
  return requestedPaths(source.slice(0, candidate.from) + token + source.slice(candidate.to)).has(PROBE_PATH)
}

/** Every live include directive in `source`, in source order. */
export function directiveSites(source: string): DirectiveSite[] {
  if (!source.includes('{{')) return []
  const found = candidates(source)
  if (!found.length) return []
  // One cheap pass rules out every token whose path is nowhere live; the rest
  // are probed one at a time, because a path can be live in one place and
  // inside a fence in another.
  const requested = requestedPaths(source)
  return found.filter((candidate) => requested.has(candidate.path) && isLive(source, candidate))
    .map(({ path, from, to }) => ({ path, from, to }))
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
  const found = candidates(source)
  const hit = found.find((candidate) => offset >= candidate.from && offset < candidate.to)
    ?? found.find((candidate) => offset === candidate.to)
  return hit && isLive(source, hit) ? { path: hit.path, from: hit.from, to: hit.to } : null
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
