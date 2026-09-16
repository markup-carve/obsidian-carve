import { applyLanguageDiff } from '@markup-carve/carve-grammars/diff'

/** Present every language fence carrying Carve's reserved `.diff` class. */
export function decorateLanguageDiffs(root: ParentNode): void {
  for (const code of Array.from(root.querySelectorAll<HTMLElement>('pre.diff > code[class*="language-"]'))) {
    applyLanguageDiff(code)
  }
}
