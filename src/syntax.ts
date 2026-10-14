import { type Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { openFenceBefore } from './fences.js'

/**
 * Source highlighting from carve-grammars' Prism grammar, the same grammar the
 * reading view highlights `carve` fences with. A hand-written tokenizer here
 * drifted from the language and scanned some lines in cubic time; this one
 * reuses the maintained grammar and adds only Obsidian's wikilinks on top.
 */

interface PrismToken { type: string; alias?: string | string[]; content: PrismStream; length: number }
type PrismStream = string | PrismToken | Array<string | PrismToken>
export interface TokenizingPrism {
  languages: Record<string, unknown>
  tokenize(text: string, grammar: unknown): Array<string | PrismToken>
}

export interface TokenRange { from: number; to: number; className: string }

/** Edits settle for this long before the visible window is tokenized again. */
export const HIGHLIGHT_DEBOUNCE_MS = 150
/** Text tokenized beyond each side of the viewport, so a short scroll stays colored. */
export const HIGHLIGHT_MARGIN = 20_000
/** Below this offset the window starts at the top, so fences and front matter keep their context. */
export const HIGHLIGHT_FULL_CONTEXT = 50_000

// Constructs whose text is literal: a `[[...]]` inside one is not a wikilink.
const LITERAL = /(?:^| )carve-tok-(?:code|code-block|comment|front-matter|attributes|raw|math|url|include-directive|autolink|escape)(?: |$)/
const WIKILINK = /!?\[\[[^\]\n]+\]\]/g

function classesOf(token: PrismToken): string {
  const aliases = token.alias === undefined ? [] : Array.isArray(token.alias) ? token.alias : [token.alias]
  return [token.type, ...aliases].map((name) => `carve-tok-${name}`).join(' ')
}

/**
 * One range per run of text, carrying the classes of every token around it,
 * so a bold run inside a quote keeps both colors. Offsets are relative to
 * `text` plus `offset`.
 */
export function carveTokenRanges(text: string, prism: TokenizingPrism, offset = 0): TokenRange[] {
  const grammar = prism.languages.carve
  if (grammar === undefined || grammar === null) return []
  const ranges: TokenRange[] = []
  let at = offset
  const push = (from: number, to: number, className: string): void => { if (className && to > from) ranges.push({ from, to, className }) }
  const plain = (value: string, className: string): void => {
    let index = 0
    if (!LITERAL.test(className)) {
      const wiki = className ? `${className} carve-tok-wikilink` : 'carve-tok-wikilink'
      for (const match of value.matchAll(WIKILINK)) {
        push(at + index, at + match.index, className)
        push(at + match.index, at + match.index + match[0].length, wiki)
        index = match.index + match[0].length
      }
    }
    push(at + index, at + value.length, className)
    at += value.length
  }
  const walk = (stream: PrismStream, className: string): void => {
    if (typeof stream === 'string') return plain(stream, className)
    if (Array.isArray(stream)) { for (const part of stream) walk(part, className); return }
    walk(stream.content, className ? `${className} ${classesOf(stream)}` : classesOf(stream))
  }
  walk(prism.tokenize(text, grammar), '')
  return ranges
}

/**
 * The slice of the document worth tokenizing for a viewport: from the top
 * when the viewport is near it, otherwise from a blank line (or failing that a
 * line start) a margin ahead of it, moved back to the opener of a code fence
 * still open there so the fence keeps its context. It always ends on a line
 * break a margin past the viewport.
 */
export function highlightWindow(source: string, viewFrom: number, viewTo: number): { from: number; to: number } {
  let from = 0
  if (viewFrom > HIGHLIGHT_FULL_CONTEXT) {
    const floor = Math.max(0, viewFrom - HIGHLIGHT_MARGIN)
    const blank = source.lastIndexOf('\n\n', floor)
    const lineStart = source.lastIndexOf('\n', floor)
    from = blank !== -1 && blank >= floor - HIGHLIGHT_MARGIN ? blank + 2 : lineStart !== -1 && lineStart >= floor - HIGHLIGHT_MARGIN ? lineStart + 1 : floor
    from = openFenceBefore(source, from) ?? from
  }
  const ceiling = Math.min(source.length, viewTo + HIGHLIGHT_MARGIN)
  const lineEnd = source.indexOf('\n', ceiling)
  return { from, to: lineEnd === -1 ? source.length : lineEnd }
}

const setTokens = StateEffect.define<DecorationSet>()
const tokenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) if (effect.is(setTokens)) return effect.value
    return transaction.docChanged ? decorations.map(transaction.changes) : decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

const marks = new Map<string, Decoration>()
const markFor = (className: string): Decoration => {
  let mark = marks.get(className)
  if (!mark) { mark = Decoration.mark({ class: className }); marks.set(className, mark) }
  return mark
}

export function tokenDecorations(ranges: readonly TokenRange[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) if (range.to > range.from) builder.add(range.from, range.to, markFor(range.className))
  return builder.finish()
}

/**
 * Highlighting for the source editor. `loadPrism` resolves Obsidian's Prism
 * with the Carve grammar registered; until it does, or when it cannot load,
 * the source stays plain.
 */
export function carveHighlighting(loadPrism: () => Promise<TokenizingPrism | null>): Extension {
  const plugin = ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | null = null
    private prism: TokenizingPrism | null = null
    private destroyed = false

    constructor(private view: EditorView) {
      void loadPrism().then((prism) => {
        if (this.destroyed || !prism) return
        this.prism = prism
        this.schedule(0)
      }).catch(() => undefined)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.schedule(HIGHLIGHT_DEBOUNCE_MS)
    }

    private schedule(delay: number): void {
      if (!this.prism) return
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = null; this.highlight() }, delay)
    }

    private highlight(): void {
      if (this.destroyed || !this.prism) return
      const source = this.view.state.doc.toString()
      const { from, to } = this.view.viewport
      const slice = highlightWindow(source, from, to)
      const ranges = carveTokenRanges(source.slice(slice.from, slice.to), this.prism, slice.from)
      this.view.dispatch({ effects: setTokens.of(tokenDecorations(ranges)) })
    }

    destroy(): void {
      this.destroyed = true
      if (this.timer !== null) clearTimeout(this.timer)
    }
  })
  return [tokenField, plugin]
}
