/**
 * Export and copy a document with every include inlined.
 *
 * `carve flatten` is the precedent and this reaches the same behavior through
 * the same two engine calls: expand, then run the Carve writer. Nothing is
 * rendered - the output IS Carve source - which is why this needs no render
 * pipeline, and why it is not blocked the way the preview half is.
 *
 * A plain Carve export must NOT expand (spec I15: writing a document back as
 * Carve returns the author's document), so this is a separate, named action
 * rather than a target.
 */
import { renderCarve as writeCarve } from '@markup-carve/carve'
import { directoryOf, expandForPreview, type IncludeDiagnostic, type PreviewExpansionOptions } from './includes.js'
import { withCrvExtension } from './metadata.js'

/** Warnings reporting a collision the expansion broke by renaming (spec I5). */
const RENAME_RULES = ['include-heading-id-rename', 'include-footnote-rename']

/** Names tried before giving up on finding a free one for the exported copy. */
export const MAX_EXPORT_CANDIDATES = 100

export interface FlattenResult {
  /** Canonical Carve: parent and children both went through the writer. */
  text: string
  diagnostics: IncludeDiagnostic[]
  /** Warnings the engine raised but did not retain; see IncludeOptions.maxWarnings. */
  suppressed: number
  /** Explicit ids and footnote labels renamed to break a collision. */
  renamed: number
  /** Vault-relative targets the expansion touched, resolved and attempted alike. */
  sources: string[]
  /** Child wikilinks respelled from the vault root so they still name their file. */
  rebased: number
  /**
   * Child wikilink targets left exactly as written because no file sits where
   * the child's folder says, so respelling one would invent a path.
   */
  ambiguous: string[]
}

/** Obsidian wiki syntax: optional embed `!`, target, `#fragment`, `|alias`. */
const WIKILINK = /(!?)\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g

export interface WikilinkRebase {
  rebased: number
  ambiguous: string[]
}

/**
 * Respell a child's wikilinks from the vault root, where that is the same file
 * the child meant.
 *
 * `[[Sibling]]` in `book/sub/child.crv` names `book/sub/Sibling`; inlined into
 * `book/root.flat.crv` the same text reads as `book/Sibling`, and the plugin's
 * basename fallback hides that until two notes share a basename. The reading
 * view solves it by rewriting wiki syntax away entirely, which a document the
 * author keeps must not suffer, so this respells the target and leaves the
 * wikilink a wikilink.
 *
 * It runs on the TREE, not the child's source: a `text` node is a different
 * node type from a `code` span and a `code_block`, so wiki syntax that is text
 * rather than a link is skipped structurally - the same reason
 * `stampIncludeOrigins` works on the tree.
 *
 * `exists` is the vault gateway's view, reached the same way expansion reaches
 * a target, and it is what makes the rewrite conditional rather than blind: a
 * child's `[[Sibling]]` with no `book/sub/Sibling` beside it never resolved
 * folder-relative in the first place - `resolveCarve` found it by basename -
 * so rebasing would point it at a file that is not there. Those are counted
 * and reported instead.
 */
export function rebaseChildWikilinks(
  node: unknown,
  sourcePath: string,
  exists: (vaultPath: string) => boolean,
  tally: WikilinkRebase = { rebased: 0, ambiguous: [] },
  parentFile?: string,
): WikilinkRebase {
  if (node === null || typeof node !== 'object') return tally
  const record = node as { type?: string; value?: string; pos?: { file?: string } }
  const file = record.pos?.file ?? parentFile
  // A node the engine did not attribute inherits its parent's file. The pinned
  // engine attributes an inline include too, so this reaches a mid-sentence
  // directive; where an engine merges the child's text into the root's own run
  // there is no file to inherit and the link is left exactly as written.
  if (record.type === 'text' && typeof record.value === 'string' && file !== undefined) {
    const base = directoryOf(file)
    // A child sharing the parent's folder spells its targets the way the
    // flattened file does, so there is nothing to change - and that is also
    // what excludes the root's own content, which the writer keeps in place.
    if (base && base !== directoryOf(sourcePath)) {
      record.value = record.value.replace(WIKILINK, (all, bang: string, target: string, fragment = '', alias = '') => {
        const clean = target.trim()
        if (clean.startsWith('/')) return all
        const rebased = `${base}/${clean}`
        if (!exists(withCrvExtension(rebased))) { tally.ambiguous.push(clean); return all }
        tally.rebased++
        // The bare target was also the label. Carrying it over as an alias is
        // what keeps the reading view showing `Sibling` rather than the whole
        // path, which is how the unflattened document renders it.
        return `${bang}[[${rebased}${fragment}${alias || `|${clean}`}]]`
      })
    }
  }
  for (const value of Object.values(record as Record<string, unknown>)) {
    if (Array.isArray(value)) for (const child of value) rebaseChildWikilinks(child, sourcePath, exists, tally, file)
  }
  return tally
}

/**
 * Expand `source` through the vault gateway and write it back as one
 * self-contained Carve document.
 *
 * Wiki syntax stays wiki syntax. The reading view rewrites `[[Note]]` into a
 * Carve link because it is about to render; this output is a document that
 * gets saved and edited again, so that rewrite would be a lossy transform
 * nobody asked for. The writer round-trips wiki syntax verbatim.
 *
 * A child's TARGET is respelled from the vault root where it can be, because
 * the bare spelling means a different file once the child's content sits in
 * the parent's folder. That stays inside wiki syntax, so Obsidian's own
 * renaming and backlinks keep working on it.
 */
export async function flattenDocument(source: string, options: PreviewExpansionOptions): Promise<FlattenResult> {
  const expansion = await expandForPreview(source, { ...options, rewriteWiki: false })
  const wikilinks = rebaseChildWikilinks(expansion.doc, options.sourcePath, (path) => options.gateway.mtime(path) !== null)
  return {
    text: writeCarve(expansion.doc),
    diagnostics: expansion.diagnostics,
    suppressed: expansion.suppressed,
    renamed: expansion.diagnostics.filter((diagnostic) => RENAME_RULES.includes(diagnostic.rule)).length,
    sources: expansion.watchPaths,
    rebased: wikilinks.rebased,
    ambiguous: wikilinks.ambiguous,
  }
}

/**
 * A free vault-relative path for the flattened copy of `sourcePath`, or null
 * when every candidate name is taken.
 *
 * Derived from the document's own vault path rather than typed, so the export
 * lands beside its original by construction and there is no string for a
 * containment check to get wrong. An empty or relative path never reaches the
 * vault API from here, so the process working directory stays unreachable.
 */
export function flattenedPath(sourcePath: string, exists: (path: string) => boolean): string | null {
  const slash = sourcePath.lastIndexOf('/')
  const dot = sourcePath.lastIndexOf('.')
  const stem = dot > slash ? sourcePath.slice(0, dot) : sourcePath
  const extension = dot > slash ? sourcePath.slice(dot) : '.crv'
  for (let n = 1; n <= MAX_EXPORT_CANDIDATES; n++) {
    const candidate = n === 1 ? `${stem}.flat${extension}` : `${stem}.flat-${n}${extension}`
    if (!exists(candidate)) return candidate
  }
  return null
}

function count(n: number, noun: string): string { return `${n} ${noun}${n === 1 ? '' : 's'}` }

/**
 * One line telling the reader what they just got.
 *
 * Every consequence is stated rather than left to be found in a published
 * page: the output is canonical Carve so formatting is normalized, colliding
 * ids were renamed (spec I5), a child's wikilinks were respelled from the
 * vault root - and the ones that could not be are named as a limit, because
 * those are the links that silently change meaning.
 */
export function flattenSummary(result: FlattenResult, lead: string): string {
  const parts = [lead, 'Canonical Carve, so formatting is normalized.']
  if (result.renamed > 0) parts.push(`${count(result.renamed, 'colliding id')} renamed.`)
  if (result.rebased > 0) parts.push(`${count(result.rebased, 'child wikilink')} rebased.`)
  if (result.ambiguous.length > 0) parts.push(`${count(result.ambiguous.length, 'child wikilink')} left unrebased; each may resolve elsewhere now.`)
  const warnings = result.diagnostics.length - result.renamed
  if (warnings > 0) parts.push(`${count(warnings, 'include warning')}.`)
  if (result.suppressed > 0) parts.push(`${count(result.suppressed, 'further warning')} not shown.`)
  return parts.join(' ')
}
