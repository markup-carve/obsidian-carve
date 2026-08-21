import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'
import { extractMetadata, withCrvExtension } from '../dist-test/metadata.js'
import { renderCarve, rewriteWikiSyntax } from '../dist-test/render.js'
import { sourceToVisualDocument, visualHtmlToSource } from '../dist-test/wysiwyg.js'

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

test('visual editing round-trips common blocks and formatting', () => {
  const visual = sourceToVisualDocument('# Hello\n\nA *strong* idea.\n\n- one\n- two\n')
  assert.equal(visual.canonicalizes, false)
  const edited = visualHtmlToSource(visual.html.replace('>strong<', '>clear<'), visual.frontmatter)
  assert.match(edited.source, /A \*clear\* idea\./)
  assert.match(edited.source, /- one\n- two/)
})

test('visual editing preserves frontmatter bytes outside the editable surface', () => {
  const source = '---toml\r\ntitle = "Human"\r\n---\r\n# Hello\n'
  const visual = sourceToVisualDocument(source)
  assert.equal(visual.frontmatter, '---toml\r\ntitle = "Human"\r\n---\r\n')
  assert.equal(visualHtmlToSource(visual.html, visual.frontmatter).source, source)
})

test('visual safety audit classifies the Carve element surface', () => {
  const lossless = {
    paragraph: 'Plain text\n', heading: '# Heading\n', inline: '/italic/ *bold* _under_ ~strike~ =mark= `code`\n',
    scripts: '{^super^} {,sub,}\n', link: '[label](https://example.com)\n', image: '![alt](image.png)\n',
    list: '- one\n- [x] done\n', quote: '> quote\n', definitionList: ':: term\n:  definition\n',
    table: '|= A |= B |\n| x | y |\n', figure: '![alt](image.png)\n^ Caption\n', thematicBreak: '***\n',
    hardBreak: 'one\\\ntwo\n', frontmatter: '---\ntitle: T\n---\n# H\n',
  }
  const protectedFromLoss = {
    codeBlock: '```js\nconst x = 1\n```\n', admonition: '::: note "Title"\nbody\n:::\n',
    div: '::: custom\nbody\n:::\n', lineBlock: '::: |\nline one\n line two\n:::\n',
    footnote: 'Text[^a]\n\n[^a]: note\n', inlineFootnote: 'Text^[note]\n', attributes: '{#id .wide}\n# Heading\n',
    abbreviation: '*[HTML]: HyperText Markup Language\n\nHTML\n', math: 'Inline $`x`\n',
    comments: 'before {% hidden %} after\n\n%% hidden\n', criticMarkup: '{+inserted+} {-deleted-} {~old~>new~} {#comment#}\n',
    raw: '`<b>x</b>`{=html}\n', wikilink: '[[Note|label]]\n', embed: '![[Note]]\n', tagMention: '#tag @user\n',
  }
  for (const [name, source] of Object.entries(lossless)) assert.equal(sourceToVisualDocument(source).semanticLoss, false, name)
  for (const [name, source] of Object.entries(protectedFromLoss)) assert.equal(sourceToVisualDocument(source).semanticLoss, true, name)
})
