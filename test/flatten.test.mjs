import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml, renderHtml, resolve } from '@markup-carve/carve'
import { expandForPreview } from '../dist-test/includes.js'
import { MAX_EXPORT_CANDIDATES, flattenDocument, flattenSummary, flattenedPath } from '../dist-test/flatten.js'

/** A vault of `path -> source`, read through a gateway, as the plugin does. */
function vault(files) {
  const state = new Map(Object.entries(files))
  return {
    mtime: (path) => (state.has(path) ? 1 : null),
    read: async (path) => {
      const source = state.get(path)
      if (source === undefined) throw new Error(`No such file: ${path}`)
      return source
    },
  }
}

test('flattening inlines the child and leaves no directive behind', async () => {
  const gateway = vault({ 'book/child.crv': '# Child heading\n' })
  const result = await flattenDocument('Before\n\n{{ child.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.text, /^# Child heading$/m)
  assert.doesNotMatch(result.text, /\{\{/)
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.renamed, 0)
})

test('nested includes are inlined too, and every source is reported', async () => {
  const gateway = vault({ 'a.crv': 'A\n\n{{ b.crv }}\n', 'b.crv': 'B body\n' })
  const result = await flattenDocument('Root\n\n{{ a.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.text, /B body/)
  assert.deepEqual([...result.sources].sort(), ['a.crv', 'b.crv'])
})

test('the flattened document renders like the expanded original', async () => {
  const gateway = vault({ 'book/child.crv': '{#intro}\n# Child\n\nBody _text_ and a [ref][target].\n\n[target]: https://example.com\n' })
  const source = '{#intro}\n# Root\n\n{{ child.crv }}\n\nAfter.\n'
  const options = { sourcePath: 'book/root.crv', gateway }
  const flattened = await flattenDocument(source, options)
  const expanded = await expandForPreview(source, { ...options, rewriteWiki: false })
  assert.equal(carveToHtml(flattened.text), renderHtml(resolve(expanded.doc)))
})

test('a colliding heading id is renamed into the output and counted', async () => {
  // The attribute block sits on its OWN LINE on purpose: written trailing
  // (`# Child intro {#intro}`) Carve keeps it as literal text and the heading
  // carries no id at all, so there would be no collision and nothing to assert.
  const gateway = vault({ 'child.crv': '{#intro}\n# Child intro\n' })
  const result = await flattenDocument('{#intro}\n# Root intro\n\n{{ child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.text, /^\{#intro-2\}$/m, 'the rename is written into the source, not only reported')
  assert.equal(result.renamed, 1)
  assert.equal(result.diagnostics.length, 1)
  assert.equal(result.diagnostics[0].rule, 'include-heading-id-rename')
})

test("the author's wiki syntax survives flattening verbatim", async () => {
  const gateway = vault({ 'book/child.crv': 'Child links to [[Sibling]].\n' })
  const result = await flattenDocument('Root links to [[Other|Alias]].\n\n{{ child.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.text, /\[\[Other\|Alias\]\]/)
  assert.match(result.text, /\[\[Sibling\]\]/)
  assert.doesNotMatch(result.text, /carve-wikilink/, 'the reading view rewrite must not reach a document the author keeps')
})

test('a target outside the vault is refused, reported, and left as text', async () => {
  const gateway = vault({})
  const result = await flattenDocument('{{ ../outside.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(result.diagnostics.length, 1)
  assert.equal(result.diagnostics[0].rule, 'include-containment')
  assert.match(result.text, /\{\{ \.\.\/outside\.crv \}\}/)
  assert.deepEqual(result.sources, [])
})

test('the exported copy lands beside its original, stepping over names in use', () => {
  assert.equal(flattenedPath('book/root.crv', () => false), 'book/root.flat.crv')
  assert.equal(flattenedPath('root.crv', (path) => path === 'root.flat.crv'), 'root.flat-2.crv')
  assert.equal(flattenedPath('notes/plain', () => false), 'notes/plain.flat.crv')
  assert.equal(flattenedPath('a.b/root', () => false), 'a.b/root.flat.crv', 'a dot in a FOLDER name is not an extension')
})

test('an exhausted name space refuses rather than looping', () => {
  let asked = 0
  assert.equal(flattenedPath('root.crv', () => { asked++; return true }), null)
  assert.equal(asked, MAX_EXPORT_CANDIDATES)
})

test('the summary states the normalization, and every count it has', () => {
  const base = { text: '', diagnostics: [], suppressed: 0, renamed: 0, sources: [] }
  assert.equal(flattenSummary(base, 'Copied.'), 'Copied. Canonical Carve, so formatting is normalized.')
  const loud = {
    ...base,
    diagnostics: [{ rule: 'include-heading-id-rename' }, { rule: 'include-footnote-rename' }, { rule: 'include-unresolved' }],
    renamed: 2,
    suppressed: 4,
  }
  assert.equal(
    flattenSummary(loud, 'Exported x.crv.'),
    'Exported x.crv. Canonical Carve, so formatting is normalized. 2 colliding ids renamed. 1 include warning. 4 further warnings not shown.',
  )
})
