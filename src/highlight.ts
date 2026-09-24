import { applyLanguageDiff } from '@markup-carve/carve-grammars/diff'

/** The slice of Prism the reading view uses: Obsidian's `loadPrism()` in the app, `prismjs` in tests. */
export interface Prism {
  languages: Record<string, unknown>
  highlight(text: string, grammar: unknown, language: string): string
}

/**
 * Register carve-grammars' Carve grammar (`carve`, `crv`) on `prism`.
 *
 * The grammar file is a side-effect script that registers itself on the global
 * `Prism` when it is first evaluated, so it is imported lazily with `prism`
 * installed as that global.
 */
export async function withCarveGrammar<P extends Prism>(prism: P): Promise<P> {
  if (grammarOf(prism, 'carve')) return prism
  const scope = globalThis as { Prism?: unknown }
  const previous = scope.Prism
  scope.Prism = prism
  try {
    await import('@markup-carve/carve-grammars/prism/carve.js')
  } finally {
    if (previous === undefined) delete scope.Prism
    else scope.Prism = previous
  }
  return prism
}

/**
 * Highlight every language fence under `root`. A `{.diff}` fence gets the
 * add/remove line presentation with each line highlighted on its own; without
 * `prism`, or for a language it has no grammar for, code stays plain.
 */
export function highlightCodeBlocks(root: ParentNode, prism: Prism | null): void {
  for (const code of Array.from(root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]'))) {
    const pre = code.parentElement
    const language = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]?.toLowerCase() ?? ''
    const grammar = prism ? grammarOf(prism, language) : undefined
    const highlight = prism && grammar ? (text: string) => prism.highlight(text, grammar, language) : undefined
    if (pre?.classList.contains('diff')) applyLanguageDiff(code, highlight)
    else if (highlight) code.innerHTML = highlight(code.textContent ?? '')
    if (highlight) pre?.classList.add(`language-${language}`)
  }
}

// `Prism.languages` also carries helpers such as `extend` and `insertBefore`.
function grammarOf(prism: Prism, language: string): object | undefined {
  const grammar = Object.hasOwn(prism.languages, language) ? prism.languages[language] : undefined
  return grammar !== null && typeof grammar === 'object' ? grammar : undefined
}
