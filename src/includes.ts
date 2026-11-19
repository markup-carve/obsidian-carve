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
import { includeDependencies, parseWithDiagnostics, render, type Diagnostic, type DocumentNode, type IncludeDependency, type IncludeRequest, type RenderOptions } from '@markup-carve/carve'
import { byteToUtf16 } from './engine.js'
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
  doc: DocumentNode
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
   * `rawHtml` is not among them: raw HTML is off
   * for vault content on every path, and an options object that REPLACED the
   * default rather than extending it would turn it back on by omission.
   */
  renderOptions?: PreviewRenderOptions
}

/** Render options a preview may carry: everything but raw HTML and the include resolver. */
export type PreviewRenderOptions = Omit<RenderOptions, 'rawHtml' | 'includes'>

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

const ENGINE_INCLUDE_MESSAGE = /^Include "(.+)" was not expanded:/
const UNRESOLVED_CODES = new Set(['include-not-found', 'include-unreadable', 'include-non-text'])

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

/** 1-based line and column of a UTF-8 byte offset in `text`, the column in UTF-16 units. */
function lineColumn(text: string, byteOffset: number): { line: number; column: number } {
  const at = byteToUtf16(text)(byteOffset)
  const before = text.slice(0, at)
  const lineStart = before.lastIndexOf('\n') + 1
  return { line: before.split('\n').length, column: at - lineStart + 1 }
}

/**
 * The engine's include diagnostics in the plugin's terms: a refused target
 * reads as a containment refusal and a missing, unreadable or non-text one in
 * the plugin's own wording, so the reading view says the same thing it always
 * did. Anything else is passed through as the engine wrote it. `sources` maps a
 * file id to the text its byte ranges count in; the root document has no id.
 */
export function classifyDiagnostics(diagnostics: readonly Diagnostic[], sources: ReadonlyMap<string | undefined, string>): IncludeDiagnostic[] {
  return diagnostics.map((entry) => {
    const text = sources.get(entry.file) ?? ''
    const { line, column } = entry.range ? lineColumn(text, entry.range.startOffset) : { line: 1, column: 1 }
    const path = ENGINE_INCLUDE_MESSAGE.exec(entry.message)?.[1]
    const diagnostic: IncludeDiagnostic = path !== undefined && entry.code === 'include-outside-root'
      ? { line, column, rule: 'include-containment', message: containmentMessage(path) }
      : path !== undefined && UNRESOLVED_CODES.has(entry.code)
        ? { line, column, rule: 'include-unresolved', message: unresolvedMessage(path) }
        : { line, column, rule: entry.code, message: entry.message }
    if (entry.file !== undefined) diagnostic.file = entry.file
    return diagnostic
  })
}

function watchPathsOf(dependencies: readonly IncludeDependency[], attempted: ReadonlySet<string>): string[] {
  const paths = new Set<string>(attempted)
  // Dependencies the engine noted without calling the resolver - a cycle, a
  // depth refusal - carry the id of an earlier successful resolve.
  for (const dependency of dependencies) if (dependency.read && dependency.file !== undefined) paths.add(dependency.file)
  return [...paths]
}

/**
 * Expand every include the document reaches, reading through `gateway`.
 */
export async function expandForPreview(source: string, options: PreviewExpansionOptions): Promise<PreviewExpansion> {
  const { sourcePath, gateway } = options
  const cache = options.cache ?? new IncludeCache()
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS
  // The child's wikilinks are rebased against the child's own folder: once its
  // content is inlined the reading view only knows the ROOT document's path, so
  // an unrebased `[[Sibling]]` would open a note beside the root.
  const rewrite = (text: string, base: string): string => (options.rewriteWiki ?? true) ? rewriteWikiSyntax(text, base) : text
  // Extensions are parse-stage: one handed only to the renderer adds no syntax.
  const parseOptions = {
    positions: true as const,
    ...(options.renderOptions?.extensions ? { extensions: options.renderOptions.extensions } : {}),
    ...(options.renderOptions?.headingIds ? { headingIds: options.renderOptions.headingIds } : {}),
  }
  const rewritten = rewrite(source, '')
  // A read that throws is not retried: without this the next round would ask
  // for it again and the loop would only end at the round cap.
  const unreadable = new Set<string>()

  for (let round = 0; ; round++) {
    const attempted = new Set<string>()
    const denied = new Set<string>()
    const pending = new Map<string, number>()
    const sources = new Map<string | undefined, string>([[undefined, rewritten]])
    const resolver = ({ path, from }: IncludeRequest) => {
      const parent = from ?? sourcePath
      const vaultPath = resolveVaultPath(path, parent)
      if (vaultPath === null) { denied.add(directiveKey(parent, path)); return { error: 'outside_root' as const } }
      attempted.add(vaultPath)
      if (unreadable.has(vaultPath)) return { error: 'unreadable' as const }
      const mtime = gateway.mtime(vaultPath)
      if (mtime === null) return { error: 'not_found' as const }
      const cached = cache.get(vaultPath, mtime)
      if (cached === undefined) { pending.set(vaultPath, mtime); return { error: 'not_found' as const } }
      const text = rewrite(cached, directoryOf(vaultPath))
      sources.set(vaultPath, text)
      return { text, id: vaultPath }
    }
    const result = parseWithDiagnostics(rewritten, { ...parseOptions, includes: { resolver, file: sourcePath } })
    const dependencies = includeDependencies(result.document)

    if (pending.size === 0 || round >= maxRounds) {
      return {
        doc: result.document,
        diagnostics: classifyDiagnostics(result.diagnostics.filter((entry) => entry.code.startsWith('include-')), sources),
        suppressed: result.suppressedDiagnostics,
        watchPaths: watchPathsOf(dependencies, attempted),
        resolvedPaths: dependencies.filter((dependency) => dependency.read && dependency.file !== undefined).map((dependency) => dependency.file as string),
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
 * code spans and fences, which are text rather than links. The 0.2 parse
 * returns the resolved tree, so a reference link already carries its destination.
 */
export function stampIncludeOrigins(node: unknown, parentFile?: string): void {
  if (node === null || typeof node !== 'object') return
  const record = node as { type?: string; href?: string; pos?: { file?: string }; attrs?: { classes?: string[]; keyValues?: [string, string][] } }
  const file = record.pos?.file
  if (typeof record.type === 'string') {
    // An authored attribute of this name never survives. The origin states
    // where the engine says the node came from; a document does not get to
    // assert it and redirect where a click lands.
    if (record.attrs?.keyValues) {
      record.attrs.keyValues = record.attrs.keyValues.filter(([key]) => key !== ORIGIN_ATTRIBUTE)
      // A 0.2 tree refuses an empty pair list and empty attrs (C2-A-032).
      if (record.attrs.keyValues.length === 0) delete record.attrs.keyValues
      if (Object.keys(record.attrs).length === 0) delete record.attrs
    }
    const rewritten = record.attrs?.classes?.some((name) => REBASED_BY_REWRITE.includes(name)) ?? false
    // A link carries the file its DESTINATION is relative to. Any other node
    // carries it only where an included region begins - the block whose file
    // differs from its parent's - so one attribute marks the region instead of
    // one per node inside it.
    //
    const stamp = record.type === 'link'
      ? file !== undefined && !rewritten && typeof record.href === 'string' && isFolderRelativeDestination(record.href)
      : file !== undefined && file !== parentFile
    if (stamp) {
      record.attrs = record.attrs ?? {}
      record.attrs.keyValues = [...(record.attrs.keyValues ?? []), [ORIGIN_ATTRIBUTE, file as string]]
    }
  }
  for (const value of Object.values(record as Record<string, unknown>)) if (Array.isArray(value)) for (const child of value) stampIncludeOrigins(child, file ?? parentFile)
}

/**
 * Expand, then render the same way the plain preview path renders: the 0.2
 * `render` takes the tree, and the heading-id policy went to the parse that
 * assigned the ids.
 */
export async function renderCarveWithIncludes(source: string, options: PreviewExpansionOptions): Promise<PreviewExpansion & { html: string }> {
  const expansion = await expandForPreview(source, options)
  const renderOptions: PreviewRenderOptions = options.renderOptions ?? {}
  stampIncludeOrigins(expansion.doc)
  return { ...expansion, html: render(expansion.doc, { ...renderOptions, ...RENDER_OPTIONS }) }
}
