import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml, renderHtml, resolve } from '@markup-carve/carve'
import { expandForPreview, renderCarveWithIncludes } from '../dist-test/includes.js'
import { renderCarve as renderCarveSource } from '../dist-test/render.js'
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
  assert.equal(result.rebased, 0, 'a child in the parent\'s own folder spells its targets the same way the parent does')
  assert.deepEqual(result.ambiguous, [], 'and it is not a limit worth reporting either')
})

test("a child's wikilink is respelled from the vault root, keeping its label", async () => {
  const gateway = vault({ 'book/sub/child.crv': 'Child links to [[Sibling]].\n', 'book/sub/Sibling.crv': 'A sibling.\n' })
  const result = await flattenDocument('Root links to [[Sibling]].\n\n{{ sub/child.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.text, /Child links to \[\[book\/sub\/Sibling\|Sibling\]\]\./, 'the target names the file from the vault root, the label still reads Sibling')
  assert.match(result.text, /Root links to \[\[Sibling\]\]\./, "the root's own target is already relative to the file that keeps it")
  assert.equal(result.rebased, 1)
  assert.deepEqual(result.ambiguous, [])
})

test('the embed, fragment and alias spellings each keep their parts', async () => {
  const gateway = vault({
    'book/sub/child.crv': 'See ![[Sibling]] and [[Sibling#part]] and [[Sibling|Named]].\n',
    'book/sub/Sibling.crv': 'A sibling.\n',
  })
  const result = await flattenDocument('{{ sub/child.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.text, /!\[\[book\/sub\/Sibling\|Sibling\]\]/, 'an embed stays an embed')
  assert.match(result.text, /\[\[book\/sub\/Sibling#part\|Sibling\]\]/, 'the fragment survives and the label is the bare target')
  assert.match(result.text, /\[\[book\/sub\/Sibling\|Named\]\]/, "an alias the author wrote is not replaced")
  assert.equal(result.rebased, 3)
})

test('a target with no file beside the child is left alone and reported', async () => {
  const gateway = vault({ 'book/sub/child.crv': 'Child links to [[Elsewhere]] and [[/Rooted]].\n' })
  const result = await flattenDocument('{{ sub/child.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.text, /\[\[Elsewhere\]\]/, 'respelling it would invent a path the vault does not have')
  assert.match(result.text, /\[\[\/Rooted\]\]/, 'a vault-root target already names its file from the root')
  assert.equal(result.rebased, 0)
  assert.deepEqual(result.ambiguous, ['Elsewhere'], 'the vault-root spelling is not a limit, so it is not reported as one')
})

test('wiki syntax that is text rather than a link is not respelled', async () => {
  const gateway = vault({
    'book/sub/child.crv': 'Live [[Sibling]], span `[[Sibling]]`, fence:\n\n```\n[[Sibling]]\n```\n',
    'book/sub/Sibling.crv': 'A sibling.\n',
  })
  const result = await flattenDocument('{{ sub/child.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.text, /Live \[\[book\/sub\/Sibling\|Sibling\]\]/)
  assert.match(result.text, /`\[\[Sibling\]\]`/, 'a code span is a different node type, so it is skipped structurally')
  assert.match(result.text, /^\[\[Sibling\]\]$/m, 'a fenced line is not a link either')
  assert.equal(result.rebased, 1, 'exactly the one live link')
})

test('the flattened document still renders the way the unflattened one previews', async () => {
  const gateway = vault({ 'book/sub/child.crv': 'Child links to [[Sibling]].\n', 'book/sub/Sibling.crv': 'A sibling.\n' })
  const source = 'Root.\n\n{{ sub/child.crv }}\n'
  const options = { sourcePath: 'book/root.crv', gateway }
  const flattened = await flattenDocument(source, options)
  // The reading view rewrites wiki syntax on its way in, so the flattened file
  // read back through the SAME path has to produce the preview's HTML. Only the
  // origin stamp differs, and it has to: it says content was pulled in from
  // another file, which is no longer true of a document that holds it outright.
  const preview = await renderCarveWithIncludes(source, options)
  const withoutOrigins = (html) => html.replace(/ data-carve-origin="[^"]*"/g, '')
  assert.match(renderCarveSource(flattened.text), /<a href="book\/sub\/Sibling" class="carve-wikilink">Sibling<\/a>/,
    'the rebased target resolves from the vault root and still reads as Sibling')
  assert.equal(renderCarveSource(flattened.text), withoutOrigins(preview.html))
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
  const base = { text: '', diagnostics: [], suppressed: 0, renamed: 0, sources: [], rebased: 0, ambiguous: [] }
  assert.equal(flattenSummary(base, 'Copied.'), 'Copied. Canonical Carve, so formatting is normalized.')
  const loud = {
    ...base,
    diagnostics: [{ rule: 'include-heading-id-rename' }, { rule: 'include-footnote-rename' }, { rule: 'include-unresolved' }],
    renamed: 2,
    rebased: 3,
    ambiguous: ['Elsewhere'],
    suppressed: 4,
  }
  assert.equal(
    flattenSummary(loud, 'Exported x.crv.'),
    'Exported x.crv. Canonical Carve, so formatting is normalized. 2 colliding ids renamed. 3 child wikilinks rebased.'
      + ' 1 child wikilink left unrebased; each may resolve elsewhere now. 1 include warning. 4 further warnings not shown.',
  )
})
