import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'
import { extractMetadata, withCrvExtension } from '../dist-test/metadata.js'
import { renderCarve, rewriteWikiSyntax } from '../dist-test/render.js'

test('the renderer produces Obsidian-ready HTML', () => {
  const html = carveToHtml('# Human markup\n\nA *strong* idea and [link](https://example.com).', { allowRawHtml: false })
  assert.match(html, /<h1[^>]*>Human markup<\/h1>/)
  assert.match(html, /<strong>strong<\/strong>/)
  assert.match(html, /href="https:\/\/example.com"/)
})

test('raw HTML is disabled on the plugin path', () => {
  const html = renderCarve('<script>alert(1)</script>')
  assert.doesNotMatch(html, /<script>/)
})

test('wikilinks and embeds become safe Carve links with plugin markers', () => {
  const rewritten = rewriteWikiSyntax('See [[Guide|the guide]] and ![[Excerpt]].')
  assert.match(rewritten, /\[the guide\]\(Guide\)\{\.carve-wikilink\}/)
  assert.match(rewritten, /data-carve-embed="Excerpt"/)
})

test('metadata extracts frontmatter, headings, tags, and vault links', () => {
  const metadata = extractMetadata('---\ntitle: Demo\n---\n\n# Heading\n\n#carve [[Guide]] ![[Part]]\n')
  assert.equal(metadata.properties.title, 'Demo')
  assert.equal(metadata.headings[0].text, 'Heading')
  assert.deepEqual(metadata.tags, ['carve'])
  assert.deepEqual(metadata.links.map(({ target, embed }) => [target, embed]), [['Guide', false], ['Part', true]])
  assert.equal(withCrvExtension('Guide'), 'Guide.crv')
  assert.equal(withCrvExtension('Guide#part'), 'Guide.crv#part')
})

test('TOML, JSON, and malformed properties stay inspectable', () => {
  assert.equal(extractMetadata('---toml\ntitle = "TOML"\n---\n').properties.title, 'TOML')
  assert.equal(extractMetadata('---json\n{"title":"JSON"}\n---\n').properties.title, 'JSON')
  assert.equal(extractMetadata('---json\n{broken\n---\n').properties.parseError, true)
})
