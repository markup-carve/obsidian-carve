/**
 * Export a document together with every file it includes, as a folder.
 *
 * The opposite shape to `flatten.ts`, for the case that one is wrong for:
 * sending a document to someone who will keep editing it. Flattening returns
 * one long file whose directives and file boundaries are gone; a bundle keeps
 * both, so the recipient gets a document rather than a transcript.
 *
 * Nothing here runs the writer. Every file is copied exactly as the author
 * wrote it - no canonical Carve, no renamed ids, no rebased wikilinks -
 * because the directives that made those necessary are still in place.
 */
import { directoryOf, expandForPreview, type IncludeDiagnostic, type PreviewExpansionOptions } from './includes.js'

/** Names tried before giving up on finding a free one for the bundle folder. */
export const MAX_BUNDLE_CANDIDATES = 100

/** The manifest written at the root of every bundle. */
export const BUNDLE_MANIFEST = 'carve-bundle.json'

export interface BundlePlan {
  /** Vault path of the entry document, which is also its path inside the bundle. */
  document: string
  /** Vault paths to copy, the entry document first, each at the same path inside the bundle. */
  files: string[]
  /** Targets that were asked for and yielded nothing: no bytes to copy. */
  missing: string[]
  /** Targets refused for climbing out of the vault, which never became vault paths. */
  denied: Array<{ file: string; path: string }>
  /**
   * Where the manifest goes inside the bundle. Usually BUNDLE_MANIFEST, and
   * a stepped name when a copied file already occupies that path - a document
   * may perfectly well include `/carve-bundle.json`.
   */
  manifest: string
  diagnostics: IncludeDiagnostic[]
  /** Warnings the engine raised but did not retain; see IncludeOptions.maxWarnings. */
  suppressed: number
}

/**
 * Work out what a bundle of `sourcePath` would contain.
 *
 * Wiki syntax is left alone for the same reason the flatten export leaves it
 * alone, and more so: these files are copied verbatim, so rewriting anything
 * would be a transform on the author's own notes.
 */
export async function planBundle(source: string, options: PreviewExpansionOptions): Promise<BundlePlan> {
  const expansion = await expandForPreview(source, { ...options, rewriteWiki: false })
  const resolved = new Set(expansion.resolvedPaths)
  const files = [options.sourcePath, ...expansion.watchPaths.filter((path) => resolved.has(path) && path !== options.sourcePath)]
  return {
    document: options.sourcePath,
    files,
    manifest: manifestPath(files),
    missing: expansion.watchPaths.filter((path) => !resolved.has(path)),
    denied: expansion.deniedTargets,
    diagnostics: expansion.diagnostics,
    suppressed: expansion.suppressed,
  }
}

/**
 * A manifest name no copied file occupies.
 *
 * A document may include `/carve-bundle.json`, which lands at exactly the path
 * the manifest wants; writing the manifest second would then fail and leave a
 * half-written bundle.
 */
export function manifestPath(files: readonly string[]): string {
  const taken = new Set(files)
  // Unbounded on purpose, unlike the folder name: this probes a set already in
  // hand rather than the vault, and one more candidate than there are files
  // cannot all be taken. A cap here would have a fallback, and the only
  // fallback available is a name known to be occupied.
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? BUNDLE_MANIFEST : `carve-bundle-${n}.json`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The bundle mirrors VAULT-relative paths from its own root, so it is a small
 * vault rather than a flat pile.
 *
 * That is what keeps every spelling of a directive working inside it. A
 * folder-relative path needs the folder structure; a `/vault-root` path needs
 * a root to be relative TO, and only the vault root will do; a `..` needs
 * whatever it climbs to still be above the file that wrote it. Rebasing onto
 * the common ancestor of the copied files would be shallower and would break
 * the second of those silently.
 */
export function bundleEntryPath(bundleFolder: string, vaultPath: string): string {
  return `${bundleFolder}/${vaultPath}`
}

/** Vault folders that must exist before `path` can be written, outermost first. */
export function foldersFor(path: string): string[] {
  const parts = directoryOf(path).split('/').filter((part) => part !== '')
  return parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
}

/**
 * A free vault-relative folder for the bundle of `sourcePath`, or null when
 * every candidate name is taken.
 *
 * Derived from the document's own vault path rather than typed, exactly as the
 * flatten export derives its file name, so containment stays structural and
 * there is no string for a check to get wrong.
 */
export function bundlePath(sourcePath: string, exists: (path: string) => boolean): string | null {
  const slash = sourcePath.lastIndexOf('/')
  const dot = sourcePath.lastIndexOf('.')
  const stem = dot > slash ? sourcePath.slice(0, dot) : sourcePath
  for (let n = 1; n <= MAX_BUNDLE_CANDIDATES; n++) {
    const candidate = n === 1 ? `${stem}.bundle` : `${stem}.bundle-${n}`
    if (!exists(candidate)) return candidate
  }
  return null
}

/**
 * The manifest, which is where a target with no bytes is recorded.
 *
 * A file that could not be read is part of the dependency set and has nothing
 * to copy, so dropping it silently would hand someone a bundle that looks
 * complete. It is named here and counted in the summary.
 */
export function bundleManifest(plan: BundlePlan): string {
  return `${JSON.stringify({ document: plan.document, files: plan.files, missing: plan.missing, denied: plan.denied }, null, 2)}\n`
}

function count(n: number, noun: string): string { return `${n} ${noun}${n === 1 ? '' : 's'}` }

/** One line telling the reader what the bundle holds and what it could not hold. */
export function bundleSummary(plan: BundlePlan, folder: string): string {
  const parts = [`Bundled into ${folder}: ${count(plan.files.length, 'file')}.`, 'Copied as written, so the directives still work.']
  if (plan.missing.length > 0) parts.push(`${count(plan.missing.length, 'target')} could not be read; listed in ${plan.manifest}.`)
  if (plan.denied.length > 0) parts.push(`${count(plan.denied.length, 'target')} outside the vault was not read.`)
  const warnings = plan.diagnostics.length
  if (warnings > 0) parts.push(`${count(warnings, 'include warning')}.`)
  if (plan.suppressed > 0) parts.push(`${count(plan.suppressed, 'further warning')} not shown.`)
  return parts.join(' ')
}
