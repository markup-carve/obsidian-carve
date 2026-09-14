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
import { expandForPreview, type IncludeDiagnostic, type PreviewExpansionOptions } from './includes.js'

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
}

/**
 * Expand `source` through the vault gateway and write it back as one
 * self-contained Carve document.
 *
 * Wiki syntax is left exactly as the author wrote it. The reading view rewrites
 * `[[Note]]` into a Carve link because it is about to render; this output is a
 * document that gets saved and edited again, so the rewrite would be a lossy
 * transform nobody asked for. The writer round-trips wiki syntax verbatim, so
 * leaving it alone costs nothing.
 */
export async function flattenDocument(source: string, options: PreviewExpansionOptions): Promise<FlattenResult> {
  const expansion = await expandForPreview(source, { ...options, rewriteWiki: false })
  return {
    text: writeCarve(expansion.doc),
    diagnostics: expansion.diagnostics,
    suppressed: expansion.suppressed,
    renamed: expansion.diagnostics.filter((diagnostic) => RENAME_RULES.includes(diagnostic.rule)).length,
    sources: expansion.watchPaths,
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
 * Both consequences of running the writer are stated rather than left to be
 * found in a published page: the output is canonical Carve, so formatting is
 * normalized, and colliding ids were renamed (spec I5).
 */
export function flattenSummary(result: FlattenResult, lead: string): string {
  const parts = [lead, 'Canonical Carve, so formatting is normalized.']
  if (result.renamed > 0) parts.push(`${count(result.renamed, 'colliding id')} renamed.`)
  const warnings = result.diagnostics.length - result.renamed
  if (warnings > 0) parts.push(`${count(warnings, 'include warning')}.`)
  if (result.suppressed > 0) parts.push(`${count(result.suppressed, 'further warning')} not shown.`)
  return parts.join(' ')
}
