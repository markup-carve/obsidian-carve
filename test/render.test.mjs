import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'
import { extractMetadata, withCrvExtension } from '../dist-test/metadata.js'
import { renderCarve, rewriteWikiSyntax } from '../dist-test/render.js'
import { appendOpaqueConstruct, editOpaqueWithPrompts, normalizeVisualHtml, sourceToVisualDocument, updateOpaqueConstruct, visualHtmlToSource } from '../dist-test/wysiwyg.js'

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

test('visual table caret placeholders never enter Carve source', () => {
  const edited = visualHtmlToSource('<table><tr><th>A</th></tr><tr><td><br data-carve-placeholder=""></td></tr></table>')
  assert.doesNotMatch(edited.source, /\\\n|placeholder/)
  assert.equal(edited.source, '|= A |\n| |\n')
})

test('visual table selection state never enters Carve source', () => {
  const edited = visualHtmlToSource('<table><tr><td class="human is-carve-selected">A</td><td class="is-carve-selected">B</td></tr></table>')
  assert.doesNotMatch(edited.source, /is-carve-selected/)
  assert.match(edited.source, /human/)
})

test('visual table alignment survives import as Carve cell semantics', () => {
  const result = visualHtmlToSource('<table><tbody><tr><td align="center">A</td><td>B</td></tr><tr><td align="center">C</td><td>D</td></tr></tbody></table>')
  assert.equal(result.source, '|{align=center} A | B |\n|{align=center} C | D |\n')
  assert.deepEqual(result.diagnostics, [])
})

test('empty visual rows become ordinary source spacing, not hard breaks', () => {
  const html = '<div><br></div><ul><li>sdfdsf</li><li>sdfsdf</li></ul><p><br></p>'
  assert.equal(visualHtmlToSource(html).source, '- sdfdsf\n- sdfsdf\n')
  assert.doesNotMatch(visualHtmlToSource(html).source, /^\\$/m)
  assert.equal(normalizeVisualHtml('<p>a<br>b</p>'), '<p>a<br>b</p>')
  assert.equal(visualHtmlToSource('<p>a<br>b</p>').source, 'a\\\nb\n')
})

test('visual safety audit keeps the complete Carve element surface lossless', () => {
  const lossless = {
    paragraph: 'Plain text\n', heading: '# Heading\n', inline: '/italic/ *bold* _under_ ~strike~ =mark= `code`\n',
    scripts: '{^super^} {,sub,}\n', link: '[label](https://example.com)\n', image: '![alt](image.png)\n',
    list: '- one\n- [x] done\n', quote: '> quote\n', definitionList: ':: term\n:  definition\n',
    table: '|= A |= B |\n| x | y |\n', figure: '![alt](image.png)\n^ Caption\n', thematicBreak: '***\n',
    hardBreak: 'one\\\ntwo\n', codeBlock: '```js\nconst x = 1\n```\n', math: 'Inline $`x`\n', frontmatter: '---\ntitle: T\n---\n# H\n',
  }
  const protectedIslands = {
    admonition: '::: note "Title"\nbody\n:::\n',
    div: '::: custom\nbody\n:::\n', lineBlock: '::: |\nline one\n line two\n:::\n',
    footnote: 'Text[^a]\n\n[^a]: note\n', inlineFootnote: 'Text^[note]\n', attributes: '{#id .wide}\n# Heading\n',
    abbreviation: '*[HTML]: HyperText Markup Language\n\nHTML\n',
    comments: 'before {% hidden %} after\n\n%% hidden\n', criticMarkup: '{+inserted+} {-deleted-} {~old~>new~} {#comment#}\n',
    raw: '`<b>x</b>`{=html}\n', wikilink: '[[Note|label]]\n', embed: '![[Note]]\n', tagMention: '#tag @user\n',
  }
  for (const [name, source] of Object.entries(lossless)) assert.equal(sourceToVisualDocument(source).semanticLoss, false, name)
  for (const [name, source] of Object.entries(protectedIslands)) {
    const visual = sourceToVisualDocument(source)
    assert.equal(visual.semanticLoss, false, name)
    assert.ok(visual.opaque.length > 0, name)
    assert.equal(visualHtmlToSource(visual.html, visual.frontmatter, visual.opaque).source, source, name)
  }
})

test('visual edits around protected constructs preserve their exact authored bytes', () => {
  const source = 'before {% hidden <value> %} after\n\n::: note "Title"\nbody\n:::\n'
  const visual = sourceToVisualDocument(source)
  assert.match(visual.html, /contenteditable="false"/)
  assert.match(visual.html, /hidden &lt;value&gt;/)
  const edited = visual.html.replace('before ', 'edited ').replace(' after', ' afterwards')
  assert.equal(visualHtmlToSource(edited, visual.frontmatter, visual.opaque).source, 'edited {% hidden <value> %} afterwards\n\n::: note "Title"\nbody\n:::\n')
})

test('protected constructs can be explicitly edited without exposing their placeholder', () => {
  const visual = sourceToVisualDocument('before {% old %} after\n')
  const updated = updateOpaqueConstruct(visual.opaque, 0, '{% new exact comment %}')
  assert.match(updated.label, /new exact comment/)
  assert.equal(visualHtmlToSource(visual.html, visual.frontmatter, visual.opaque).source, 'before {% new exact comment %} after\n')
})

test('new advanced constructs can be inserted into a visual document losslessly', () => {
  const visual = sourceToVisualDocument('Before\n')
  const created = appendOpaqueConstruct(visual.opaque, 'math', '$`x + y`')
  assert.equal(created.index, 0)
  const html = `${visual.html}<carve-opaque data-carve-opaque="0"></carve-opaque>`
  assert.equal(visualHtmlToSource(html, visual.frontmatter, visual.opaque).source, 'Before\n\n$`x + y`\n')
})

test('renderer-owned heading sections do not create visual import warnings', () => {
  const visual = sourceToVisualDocument('# Heading\n\nParagraph.\n')
  assert.deepEqual(visual.diagnostics, [])
  assert.equal(visual.canonicalizes, false)
})

test('math and Mermaid are protected as lossless rich visual widgets', () => {
  const source = 'Inline $`x + y`\n\n```mermaid\ngraph TD\nA --> B\n```\n'
  const visual = sourceToVisualDocument(source)
  assert.deepEqual(visual.opaque.map((item) => item.kind), ['math', 'mermaid'])
  assert.match(visual.html, /class="math inline"/)
  assert.match(visual.html, /language-mermaid/)
  assert.equal(visualHtmlToSource(visual.html, '', visual.opaque).source, source)
})

test('protected constructs expose construct-aware visual editing fields', () => {
  const callout = sourceToVisualDocument('::: note "Old"\nBody\n:::\n').opaque[0]
  const answers = ['warning', 'New title', 'New body']
  assert.equal(editOpaqueWithPrompts(callout, () => answers.shift()), '::: warning "New title"\nNew body\n:::')
  const link = sourceToVisualDocument('[[Old|Label]]\n').opaque[0]
  const linkAnswers = ['New', 'Readable']
  assert.equal(editOpaqueWithPrompts(link, () => linkAnswers.shift()), '[[New|Readable]]')
  const math = sourceToVisualDocument('$`x`\n').opaque[0]
  assert.equal(editOpaqueWithPrompts(math, () => 'x + y'), '$`x + y`')
})
