/**
 * Host side of PART 9 section 19: the plugin resolves include targets, the
 * parser never opens a file.
 *
 * Two things shape this file. The engine's resolver is SYNCHRONOUS while every
 * Obsidian read is asynchronous, so expansion runs as a bounded fixpoint: each
 * round resolves what is already cached, collects the misses, awaits them, and
 * re-expands. A cold document settles in one round per include level; a warm
 * one settles in a single round.
 *
 * Containment is structural rather than checked. Every path here is
 * vault-relative and reaches the vault through the gateway, so the process
 * working directory is not merely rejected - it is unreachable.
 */
import { expandIncludes, parse, renderDocument, resolve as resolveDocument, type Document, type IncludeDependency, type IncludeWarning, type RenderDocumentOptions } from '@markup-carve/carve'
import { ORIGIN_ATTRIBUTE, RENDER_OPTIONS, isFolderRelativeDestination, rewriteWikiSyntax } from './render.js'

/** The vault, narrowed to what expansion needs, so tests need no Obsidian. */
export interface VaultGateway {
  /** Modification time of a vault-relative path, or null when no file is there. */
  mtime(path: string): number | null
  read(path: string): Promise<string>
}

export interface IncludeDiagnostic {
  line: number
  column: number
  rule: string
  message: string
  file?: string
}

export interface PreviewExpansion {
  doc: Document
  diagnostics: IncludeDiagnostic[]
  /** Warnings the engine raised but did not retain; see IncludeOptions.maxWarnings. */
  suppressed: number
  /**
   * Vault-relative paths to watch. Targets that merely failed to resolve are
   * in here too, so creating a previously-missing file invalidates the preview.
   */
  watchPaths: string[]
  /**
   * The subset of `watchPaths` that actually yielded bytes. A caller copying
   * files needs the split; one re-rendering does not, which is why watching
   * stays the wider set.
   */
  resolvedPaths: string[]
  /**
   * Targets refused for climbing out of the vault, as the directive spelled
   * them and in the file that wrote them. Collected from the resolver rather
   * than read back out of the diagnostics, which the engine caps: a caller
   * that promises to name every refusal cannot get that list from a capped
   * one. The same spelling in two files is two entries, because it is two
   * targets.
   */
  deniedTargets: Array<{ file: string; path: string }>
}

export interface PreviewExpansionOptions {
  /** Vault-relative path of the document being previewed. */
  sourcePath: string
  gateway: VaultGateway
  cache?: IncludeCache
  /** Read rounds allowed. Default 20, one past the engine's default depth of 16. */
  maxRounds?: number
  /**
   * Rewrite Obsidian wiki syntax into Carve links before parsing. Default true,
   * which is what the reading view wants. A caller producing Carve SOURCE turns
   * it off: that output is a document the author keeps, so the author's own
   * markup has to survive it.
   */
  rewriteWiki?: boolean
  /**
   * Render options for the expanded document. Defaults to the ones the plain
   * preview path uses, which is what keeps the two in step; a caller passes
   * its own only to configure the extensions or the profile that BOTH paths
   * would then be configured with.
   *
   * `target` is not among them. The reading view inserts the result as HTML,
   * so a caller that could ask for Markdown here would get Markdown displayed
   * as markup rather than an error. Neither is `allowRawHtml`: raw HTML is off
   * for vault content on every path, and an options object that REPLACED the
   * default rather than extending it would turn it back on by omission.
   */
  renderOptions?: PreviewRenderOptions
}

/** Render options a preview may carry: everything but the renderer to finish with. */
export type PreviewRenderOptions = Omit<RenderDocumentOptions, 'target'>

export const DEFAULT_MAX_ROUNDS = 20
export const MAX_CACHE_ENTRIES = 128

/**
 * Child source keyed on target identity plus modification time.
 *
 * The source is stored exactly as the vault returned it. Callers that want the
 * reading view's wiki-syntax rewrite apply it when they take an entry out, so
 * one cache serves both the preview and a flatten and `invalidate` covers both.
 */
export class IncludeCache {
  private entries = new Map<string, { mtime: number; source: string }>()

  get(path: string, mtime: number): string | undefined {
    const entry = this.entries.get(path)
    return entry !== undefined && entry.mtime === mtime ? entry.source : undefined
  }

  set(path: string, mtime: number, source: string): void {
    this.entries.delete(path)
    this.entries.set(path, { mtime, source })
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_CACHE_ENTRIES) break
      this.entries.delete(key)
    }
  }

  invalidate(path: string): void { this.entries.delete(path) }
  clear(): void { this.entries.clear() }
  get size(): number { return this.entries.size }
}

/**
 * Vault-relative target of a directive path written in `parent`, or null when
 * it climbs out of the vault.
 *
 * A leading "/" is vault-root-relative, the spelling Obsidian uses everywhere.
 * No extension is guessed: `carve render` resolves the path as written, and a
 * document previewed here has to agree with the one the CLI renders.
 */
export function resolveVaultPath(target: string, parent: string): string | null {
  const trimmed = target.trim()
  if (!trimmed) return null
  const base = trimmed.startsWith('/') ? '' : parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''
  const joined = trimmed.startsWith('/') ? trimmed.slice(1) : base ? `${base}/${trimmed}` : trimmed
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length ? parts.join('/') : null
}

/** Vault-relative folder holding `path`, empty at the vault root. */
export function directoryOf(path: string): string { return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' }

const UNRESOLVED_MESSAGE = /^Include "(.+)" could not be resolved\.$/

/**
 * Wording shared with the navigation gesture, so a refusal explained above the
 * document and one explained by a failed jump cannot drift apart.
 */
export function containmentMessage(path: string): string { return `Include "${path}" is outside the vault and was not read.` }

/** The plugin's own wording for a target it could not open; see PART 9 section 19. */
export function unresolvedMessage(path: string): string { return `Include "${path}" could not be resolved.` }

/**
 * A directive path is only unique WITHIN the file that wrote it: `child.crv`
 * in `a/one.crv` and in `b/two.crv` name different files. Every per-directive
 * record is therefore keyed by the including file as well as the path.
 */
export function directiveKey(includingFile: string, path: string): string { return `${includingFile}\u0000${path}` }

/**
 * Relabel the unresolved warnings that were really containment refusals.
 *
 * The resolver contract reports a missing file and a refused one the same way -
 * as null - so the distinction only exists on this side. A wording change in
 * the engine costs the relabel, not the diagnostic: an unmatched warning is
 * passed through as the engine wrote it.
 */
export function classifyDiagnostics(warnings: readonly IncludeWarning[], denied: ReadonlySet<string>): IncludeDiagnostic[] {
  return warnings.map((warning) => {
    const path = warning.rule === 'include-unresolved' && warning.file !== undefined ? UNRESOLVED_MESSAGE.exec(warning.message)?.[1] : undefined
    const diagnostic: IncludeDiagnostic = path !== undefined && denied.has(directiveKey(warning.file as string, path))
      ? { line: warning.line, column: warning.column, rule: 'include-containment', message: containmentMessage(path) }
      : { line: warning.line, column: warning.column, rule: warning.rule, message: warning.message }
    if (warning.file !== undefined) diagnostic.file = warning.file
    return diagnostic
  })
}

function watchPathsOf(dependencies: readonly IncludeDependency[], attempted: ReadonlySet<string>): string[] {
  const paths = new Set<string>(attempted)
  // Dependencies the engine noted without calling the resolver - a cycle, a
  // depth refusal - carry an id that is already a vault path when it came from
  // an earlier successful resolve.
  for (const dependency of dependencies) if (dependency.resolved) paths.add(dependency.id)
  return [...paths]
}

/**
 * Expand every include the document reaches, reading through `gateway`.
 *
 * The returned document still needs `resolve()` before rendering, exactly as
 * the CLI's expanded path does.
 */
export async function expandForPreview(source: string, options: PreviewExpansionOptions): Promise<PreviewExpansion> {
  const { sourcePath, gateway } = options
  const cache = options.cache ?? new IncludeCache()
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS
  // The child's wikilinks are rebased against the child's own folder: once its
  // content is inlined the reading view only knows the ROOT document's path, so
  // an unrebased `[[Sibling]]` would open a note beside the root.
  const rewrite = (text: string, base: string): string => (options.rewriteWiki ?? true) ? rewriteWikiSyntax(text, base) : text
  // `matchInline` and `matchBlock` are parse-stage: an extension handed to the
  // renderer that never reached the parse adds no syntax, so its own markup
  // stays ordinary text. carve-js#1693 is the other half - `expandIncludes`
  // parses a CHILD without them - so an extension's syntax still applies to
  // the parent only, which is why no production caller configures one yet.
  const parseOptions = { positions: true as const, ...(options.renderOptions?.extensions ? { extensions: options.renderOptions.extensions } : {}) }
  const rewritten = rewrite(source, '')
  // A read that throws is not retried: without this the next round would ask
  // for it again and the loop would only end at the round cap.
  const unreadable = new Set<string>()

  for (let round = 0; ; round++) {
    const attempted = new Set<string>()
    const denied = new Set<string>()
    const pending = new Map<string, number>()
    const result = expandIncludes(parse(rewritten, parseOptions), rewritten, {
      sourcePath,
      resolve: (path, context) => {
        const parent = context.stack[context.stack.length - 1] ?? sourcePath
        const vaultPath = resolveVaultPath(path, parent)
        if (vaultPath === null) { denied.add(directiveKey(parent, path)); return null }
        attempted.add(vaultPath)
        if (unreadable.has(vaultPath)) return null
        const mtime = gateway.mtime(vaultPath)
        if (mtime === null) return null
        const cached = cache.get(vaultPath, mtime)
        if (cached === undefined) { pending.set(vaultPath, mtime); return null }
        return { source: rewrite(cached, directoryOf(vaultPath)), id: vaultPath }
      },
    })

    if (pending.size === 0 || round >= maxRounds) {
      return {
        doc: result.doc,
        diagnostics: classifyDiagnostics(result.warnings, denied),
        suppressed: result.suppressedWarnings,
        watchPaths: watchPathsOf(result.dependencies, attempted),
        resolvedPaths: result.dependencies.filter((dependency) => dependency.resolved).map((dependency) => dependency.id),
        deniedTargets: [...denied].map((key) => { const at = key.indexOf('\u0000'); return { file: key.slice(0, at), path: key.slice(at + 1) } }),
      }
    }

    await Promise.all([...pending].map(async ([path, mtime]) => {
      try { cache.set(path, mtime, await gateway.read(path)) } catch { unreadable.add(path) }
    }))
  }
}

/**
 * Classes on links the plugin itself rewrote. `rewriteWikiSyntax` already
 * rebased those against the writing file's folder, so stamping them would
 * rebase a second time.
 */
const REBASED_BY_REWRITE = ['carve-wikilink', 'carve-embed']

/**
 * Stamp the file each link was written in onto the link, so a relative
 * destination resolves against that file rather than the root document it was
 * inlined into.
 *
 * The identity is the engine's `pos.file` (PART 9 section 19), not a source
 * rewrite: a regex over the child's source would also hit destinations inside
 * code spans and fences, which are text rather than links. Run it AFTER
 * `resolve()`, where a reference link finally carries its destination.
 */
export function stampIncludeOrigins(node: unknown, parentFile?: string): void {
  if (node === null || typeof node !== 'object') return
  const record = node as { type?: string; href?: string; pos?: { file?: string }; attrs?: { classes?: string[]; keyValues?: Record<string, string> } }
  const file = record.pos?.file
  if (typeof record.type === 'string') {
    // An authored attribute of this name never survives. The origin states
    // where the engine says the node came from; a document does not get to
    // assert it and redirect where a click lands.
    if (record.attrs?.keyValues) delete record.attrs.keyValues[ORIGIN_ATTRIBUTE]
    const rewritten = record.attrs?.classes?.some((name) => REBASED_BY_REWRITE.includes(name)) ?? false
    // A link carries the file its DESTINATION is relative to. Any other node
    // carries it only where an included region begins - the block whose file
    // differs from its parent's - so one attribute marks the region instead of
    // one per node inside it.
    //
    // A directive expanded mid-sentence marks whatever the child rendered as
    // an ELEMENT. A child contributing only plain text marks nothing, and not
    // because the expansion failed to attribute it: `expandIncludes` gives the
    // child's text its own node with pos.file, and `resolve()` coalesces that
    // run back into the parent's (carve-js#1679 was measured before that pass
    // and closed on the tree it produces, not the one rendered).
    const stamp = record.type === 'link'
      ? file !== undefined && !rewritten && typeof record.href === 'string' && isFolderRelativeDestination(record.href)
      : file !== undefined && file !== parentFile
    if (stamp) {
      record.attrs = record.attrs ?? {}
      record.attrs.keyValues = { ...record.attrs.keyValues, [ORIGIN_ATTRIBUTE]: file as string }
    }
  }
  for (const value of Object.values(record as Record<string, unknown>)) if (Array.isArray(value)) for (const child of value) stampIncludeOrigins(child, file ?? parentFile)
}

/**
 * Expand, then render the same way the plain preview path renders.
 *
 * `renderDocument` is the engine's seam for a document the host already holds
 * (carve-js#1677): it runs the composition the string entry points run -
 * resolution, the extension transforms, the profile pass, the renderer - one
 * step later. `renderHtml` ran only the last of those, so this path agreed
 * with `carveToHtml` in `render.ts` only while there was no extension and no
 * profile to lose. The equivalence this comment claims is now structural.
 *
 * Resolution is run once here as well, because the origin stamp needs the
 * resolved tree (a reference link only carries its destination after it) and
 * the seam does not expose that point. The seam then resolves again, which is
 * NOT a no-op: the ids this call assigns are the ones that survive a
 * collision, so the caller's heading-id policy has to be applied here rather
 * than left to the seam. Byte-equality with the string entry point is what the
 * tests pin, not an idempotence claim.
 */
export async function renderCarveWithIncludes(source: string, options: PreviewExpansionOptions): Promise<PreviewExpansion & { html: string }> {
  const expansion = await expandForPreview(source, options)
  const renderOptions: PreviewRenderOptions = options.renderOptions ?? RENDER_OPTIONS
  // The heading-id policy has to be the caller's HERE: this resolve is the one
  // that assigns the ids, and the seam's own resolve is the no-op by then.
  const resolved = resolveDocument(expansion.doc, {
    ...(renderOptions.asciiHeadingIds !== undefined ? { asciiHeadingIds: renderOptions.asciiHeadingIds } : {}),
    ...(renderOptions.lowercaseHeadingIds !== undefined ? { lowercaseHeadingIds: renderOptions.lowercaseHeadingIds } : {}),
  })
  stampIncludeOrigins(resolved)
  return { ...expansion, html: renderDocument(resolved, { ...renderOptions, ...RENDER_OPTIONS, target: 'html' }) }
}
