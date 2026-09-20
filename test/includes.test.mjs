import assert from 'node:assert/strict'
import test from 'node:test'
import { IncludeCache, MAX_CACHE_ENTRIES, classifyDiagnostics, expandForPreview, renderCarveWithIncludes, resolveVaultPath } from '../dist-test/includes.js'
import { ORIGIN_ATTRIBUTE } from '../dist-test/render.js'
import { carveToHtml, resolve as resolveDocument } from '@markup-carve/carve'

/** A vault of `path -> { source, mtime }`, counting reads. */
function vault(files) {
  const state = new Map(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? { source: value, mtime: 1 } : value]))
  const reads = []
  return {
    reads,
    state,
    gateway: {
      mtime: (path) => state.get(path)?.mtime ?? null,
      read: async (path) => {
        reads.push(path)
        const entry = state.get(path)
        if (!entry) throw new Error(`No such file: ${path}`)
        return entry.source
      },
    },
  }
}

test('a directive path resolves relative to the including document', () => {
  assert.equal(resolveVaultPath('child.crv', 'book/root.crv'), 'book/child.crv')
  assert.equal(resolveVaultPath('./child.crv', 'book/root.crv'), 'book/child.crv')
  assert.equal(resolveVaultPath('../shared/glossary.crv', 'book/chapters/one.crv'), 'book/shared/glossary.crv')
  assert.equal(resolveVaultPath('/top.crv', 'book/chapters/one.crv'), 'top.crv')
  assert.equal(resolveVaultPath('child.crv', 'root.crv'), 'child.crv')
})

test('the vault is the containment root, so a filesystem-absolute path names a vault path', () => {
  // "/" is Obsidian's spelling for the vault root, not the filesystem root.
  // The path is not merely refused: it names a note inside the vault, and the
  // only reach a target has is the gateway, which knows vault paths alone.
  assert.equal(resolveVaultPath('/etc/passwd', 'book/root.crv'), 'etc/passwd')
  assert.equal(resolveVaultPath('/Users/me/.ssh/id_rsa', 'root.crv'), 'Users/me/.ssh/id_rsa')
})

test('a filesystem path reaches the vault and nothing else', async () => {
  const { gateway, reads } = vault({ 'etc/passwd': 'a note that happens to live here\n' })
  const result = await expandForPreview('{{ /etc/passwd }}\n', { sourcePath: 'root.crv', gateway })
  assert.deepEqual(reads, ['etc/passwd'])
  assert.deepEqual(result.watchPaths, ['etc/passwd'])
  assert.deepEqual(result.diagnostics, [])
})

test('a path that climbs out of the vault is refused', () => {
  assert.equal(resolveVaultPath('../outside.crv', 'root.crv'), null)
  assert.equal(resolveVaultPath('../../etc/passwd', 'book/root.crv'), null)
  assert.equal(resolveVaultPath('..', 'book/root.crv'), null)
  assert.equal(resolveVaultPath('   ', 'book/root.crv'), null)
})

test('the preview expands an included file', async () => {
  const { gateway } = vault({ 'book/child.crv': '# Child heading\n' })
  const result = await renderCarveWithIncludes('Before\n\n{{ child.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.html, /<h1[^>]*>Child heading<\/h1>/)
  assert.deepEqual(result.diagnostics, [])
})

test('nested includes settle in a bounded number of read rounds', async () => {
  const { gateway, reads } = vault({
    'a.crv': 'A\n\n{{ b.crv }}\n',
    'b.crv': 'B\n\n{{ c.crv }}\n',
    'c.crv': 'C body\n',
  })
  const result = await renderCarveWithIncludes('Root\n\n{{ a.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.html, /C body/)
  assert.deepEqual(reads, ['a.crv', 'b.crv', 'c.crv'])
})

test('raw HTML inside an included file is still escaped', async () => {
  const { gateway } = vault({ 'child.crv': '<script>alert(1)</script>\n' })
  const result = await renderCarveWithIncludes('{{ child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.doesNotMatch(result.html, /<script>/)
})

test('a wikilink inside an included file becomes a plugin link', async () => {
  const { gateway } = vault({ 'child.crv': 'See [[Other Note]].\n' })
  const result = await renderCarveWithIncludes('{{ child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.html, /carve-wikilink/)
})

test('an unresolved target is reported and stays literal', async () => {
  const { gateway } = vault({})
  const result = await renderCarveWithIncludes('{{ missing.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(result.diagnostics.length, 1)
  assert.equal(result.diagnostics[0].rule, 'include-unresolved')
  assert.match(result.html, /\{\{ missing\.crv \}\}/)
})

test('a target outside the vault is reported as a containment refusal', async () => {
  const { gateway } = vault({})
  const result = await renderCarveWithIncludes('{{ ../secrets.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(result.diagnostics.length, 1)
  assert.equal(result.diagnostics[0].rule, 'include-containment')
  assert.match(result.diagnostics[0].message, /outside the vault/)
})

test('a chain deeper than the engine allows is refused, not silently truncated', async () => {
  // The other denial classes reach the reader through the same pass-through,
  // so this is the one that pins the pass-through itself: the plugin relabels
  // a containment refusal and forwards every other rule as the engine wrote it.
  const files = {}
  for (let n = 0; n < 24; n++) files[`chain-${n}.crv`] = `level ${n}\n\n{{ chain-${n + 1}.crv }}\n`
  const { gateway } = vault(files)
  const result = await expandForPreview('{{ chain-0.crv }}\n', { sourcePath: 'root.crv', gateway, maxRounds: 40 })
  assert.ok(result.diagnostics.some((d) => d.rule === 'include-depth'), JSON.stringify(result.diagnostics))
})

test('a cycle is reported rather than looping', async () => {
  const { gateway } = vault({ 'a.crv': '{{ root.crv }}\n', 'root.crv': '{{ a.crv }}\n' })
  const result = await expandForPreview('{{ a.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.ok(result.diagnostics.some((d) => d.rule === 'include-cycle'), JSON.stringify(result.diagnostics))
})

test('the watch set carries resolved and merely attempted targets alike', async () => {
  const { gateway } = vault({ 'book/there.crv': 'here\n' })
  const result = await expandForPreview('{{ there.crv }}\n\n{{ gone.crv }}\n', { sourcePath: 'book/root.crv', gateway })
  assert.deepEqual([...result.watchPaths].sort(), ['book/gone.crv', 'book/there.crv'])
})

test('a target outside the vault is not watched', async () => {
  const { gateway } = vault({})
  const result = await expandForPreview('{{ ../outside.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.deepEqual(result.watchPaths, [])
})

test('a warm cache reads nothing, and a changed mtime reads again', async () => {
  const fake = vault({ 'child.crv': 'first\n' })
  const cache = new IncludeCache()
  const options = { sourcePath: 'root.crv', gateway: fake.gateway, cache }
  const first = await renderCarveWithIncludes('{{ child.crv }}\n', options)
  assert.match(first.html, /first/)
  assert.deepEqual(fake.reads, ['child.crv'])

  const second = await renderCarveWithIncludes('{{ child.crv }}\n', options)
  assert.match(second.html, /first/)
  assert.deepEqual(fake.reads, ['child.crv'], 'an unchanged target is not read twice')

  fake.state.set('child.crv', { source: 'second\n', mtime: 2 })
  const third = await renderCarveWithIncludes('{{ child.crv }}\n', options)
  assert.match(third.html, /second/)
  assert.deepEqual(fake.reads, ['child.crv', 'child.crv'])
})

test('invalidating a cache entry forces the next read', async () => {
  const fake = vault({ 'child.crv': 'body\n' })
  const cache = new IncludeCache()
  const options = { sourcePath: 'root.crv', gateway: fake.gateway, cache }
  await expandForPreview('{{ child.crv }}\n', options)
  cache.invalidate('child.crv')
  await expandForPreview('{{ child.crv }}\n', options)
  assert.deepEqual(fake.reads, ['child.crv', 'child.crv'])
})

test('the cache is bounded', () => {
  const cache = new IncludeCache()
  for (let i = 0; i <= MAX_CACHE_ENTRIES + 10; i++) cache.set(`f${i}.crv`, 1, 'x')
  assert.equal(cache.size, MAX_CACHE_ENTRIES)
  assert.equal(cache.get('f0.crv', 1), undefined)
})

test('a read that throws is not retried', async () => {
  const reads = []
  const gateway = {
    mtime: () => 7,
    read: async (path) => { reads.push(path); throw new Error('gone') },
  }
  const result = await expandForPreview('{{ child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.deepEqual(reads, ['child.crv'])
  assert.equal(result.diagnostics[0].rule, 'include-unresolved')
})

test('an engine warning the relabeler does not recognize is passed through unchanged', () => {
  const warnings = [{ line: 2, column: 1, rule: 'include-unresolved', message: 'Some future wording.', start: 0, end: 1, file: 'root.crv' }]
  assert.deepEqual(classifyDiagnostics(warnings, new Set(['x.crv'])), [{ line: 2, column: 1, rule: 'include-unresolved', message: 'Some future wording.', file: 'root.crv' }])
})

test('a document with no directive is left to the plain render path', async () => {
  const fake = vault({ 'child.crv': 'unused\n' })
  const result = await expandForPreview('Just prose.\n', { sourcePath: 'root.crv', gateway: fake.gateway })
  assert.deepEqual(result.watchPaths, [])
  assert.deepEqual(fake.reads, [])
})

test('the same directive text in two folders watches both targets', async () => {
  const { gateway } = vault({ 'a/one.crv': '{{ child.crv }}\n', 'b/two.crv': '{{ child.crv }}\n' })
  const result = await expandForPreview('{{ a/one.crv }}\n\n{{ b/two.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.deepEqual([...result.watchPaths].sort(), ['a/child.crv', 'a/one.crv', 'b/child.crv', 'b/two.crv'])
})

test('a containment refusal in one file does not relabel the same path in another', async () => {
  const { gateway } = vault({ 'deep/inner.crv': '{{ ../missing.crv }}\n' })
  // "../missing.crv" climbs out of the vault from the root document and stays
  // inside it from deep/inner.crv, so the two must be diagnosed differently.
  const result = await expandForPreview('{{ ../missing.crv }}\n\n{{ deep/inner.crv }}\n', { sourcePath: 'root.crv', gateway })
  const rules = result.diagnostics.map((d) => d.rule).sort()
  assert.deepEqual(rules, ['include-containment', 'include-unresolved'])
})

test('a wikilink in an included file points at the included file’s folder', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [[Sibling]] and ![[Note]].\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.html, /href="sub\/Sibling"/)
  assert.match(result.html, /data-carve-embed="sub\/Note"/)
})

test('a vault-root wikilink in an included file is left alone', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [[/Top]].\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.html, /href="\/Top"/)
})

/** Rendered origin of the first link with this href: the value, or null when it carries none. */
function originOf(html, href) {
  const at = html.indexOf(`<a href="${href}"`)
  assert.notEqual(at, -1, `no rendered link with href ${href}`)
  const tag = html.slice(at, html.indexOf('>', at))
  const key = `${ORIGIN_ATTRIBUTE}="`
  const from = tag.indexOf(key)
  return from === -1 ? null : tag.slice(from + key.length, tag.indexOf('"', from + key.length))
}

test('a relative link written in an included file carries that file as its origin', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [neighbour](foo.crv).\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, 'foo.crv'), 'sub/child.crv')
})

test('a relative link in the root document carries no origin', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'Child.\n' })
  const result = await renderCarveWithIncludes('See [neighbour](foo.crv).\n\n{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, 'foo.crv'), null)
})

test('a link from a grandchild carries the grandchild, not the child', async () => {
  const { gateway } = vault({ 'a/one.crv': '{{ deep/two.crv }}\n', 'a/deep/two.crv': 'See [far](foo.crv).\n' })
  const result = await renderCarveWithIncludes('{{ a/one.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, 'foo.crv'), 'a/deep/two.crv')
})

test('a reference link written in an included file carries its origin', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [neighbour][ref].\n\n[ref]: foo.crv\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, 'foo.crv'), 'sub/child.crv')
})

test('an external destination in an included file carries no origin', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [out](https://example.com/a).\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, 'https://example.com/a'), null)
})

test('a vault-root destination in an included file carries no origin', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [top](/Top.crv).\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, '/Top.crv'), null)
})

test('a wikilink in an included file is not stamped, having been rebased already', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [[Sibling]].\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  // Rebasing it a second time, against sub/, would ask for sub/sub/Sibling.
  assert.equal(originOf(result.html, 'sub/Sibling'), null)
})

test('an origin the root document wrote itself does not survive', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'Child.\n' })
  const source = 'See [x](foo.crv){data-carve-origin="elsewhere.crv"}.\n\n{{ sub/child.crv }}\n'
  const result = await renderCarveWithIncludes(source, { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, 'foo.crv'), null)
})

test('an origin an included file wrote itself is replaced by its real one', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'See [x](foo.crv){data-carve-origin="elsewhere.crv"}.\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.equal(originOf(result.html, 'foo.crv'), 'sub/child.crv')
})

test('the first block of an included region carries the file it came from', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'Child para.\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.html, /<p data-carve-origin="sub\/child.crv">Child para.<\/p>/)
})

test('a block inside an included region is not stamped again', async () => {
  const { gateway } = vault({ 'sub/child.crv': '- a\n- b\n' })
  const result = await renderCarveWithIncludes('{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  // One attribute marks the region; repeating it on every node inside would
  // bloat the document and tell the reader nothing new.
  assert.equal(result.html.split(ORIGIN_ATTRIBUTE).length - 1, 1)
})

test('a block in the root document carries no origin', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'Child.\n' })
  const result = await renderCarveWithIncludes('Root para.\n\n{{ sub/child.crv }}\n', { sourcePath: 'root.crv', gateway })
  assert.match(result.html, /<p>Root para.<\/p>/)
})

test('an origin a block in the root document wrote itself does not survive', async () => {
  const { gateway } = vault({ 'sub/child.crv': 'Child.\n' })
  const source = '{data-carve-origin="elsewhere.crv"}\nRoot para.\n\n{{ sub/child.crv }}\n'
  const result = await renderCarveWithIncludes(source, { sourcePath: 'root.crv', gateway })
  assert.doesNotMatch(result.html, /elsewhere.crv/)
})

test('the expanded path runs the same composition the plain path runs', async () => {
  // `renderHtml` is only the last step of it: the extension transforms and the
  // profile pass are skipped, so an expanded document would silently render
  // with less applied to it than an unexpanded one. Today both paths read one
  // options object with neither configured, which is why the divergence is
  // invisible - so the lever is supplied here rather than waited for.
  const stamp = {
    name: 'stamp',
    beforeRender(doc) {
      doc.children.unshift({ type: 'paragraph', children: [{ type: 'text', value: 'STAMPED' }] })
      return doc
    },
  }
  const source = '# Title\n\nbody\n'
  const options = { allowRawHtml: false, extensions: [stamp] }
  const { gateway } = vault({})
  const result = await renderCarveWithIncludes(source, { sourcePath: 'root.crv', gateway, renderOptions: options })
  assert.match(result.html, /STAMPED/)
  assert.equal(result.html, carveToHtml(source, options))
})

test('a parse-stage extension reaches the parse the expansion runs', async () => {
  // `matchInline` has already had its chance by the time the renderer sees the
  // extension, so handing it only to `renderDocument` leaves its own syntax as
  // ordinary text. carve-js#1693 is the remaining half: a CHILD is still
  // parsed without it, so the syntax applies to the parent only.
  const atat = {
    name: 'atat',
    matchInline(text, pos) {
      if (!text.startsWith('@@', pos)) return null
      const end = text.indexOf('@@', pos + 2)
      return end === -1 ? null : { node: { type: 'code', value: text.slice(pos + 2, end) }, end: end + 2 }
    },
  }
  const { gateway } = vault({})
  const options = { allowRawHtml: false, extensions: [atat] }
  const result = await renderCarveWithIncludes('say @@hi@@ now\n', { sourcePath: 'root.crv', gateway, renderOptions: options })
  assert.match(result.html, /<code>hi<\/code>/)
})

test('the heading-id policy is the one the caller configured', async () => {
  // The resolve that assigns the ids runs HERE, before the seam's own, so a
  // policy left off this call is a policy the seam can no longer apply. The
  // second heading is what makes the assertion falsifiable: with one heading
  // the seam's own resolve re-slugs the id and hides the omission, and with a
  // collision the first resolve's ids are the ones that stick.
  const source = '# Big Title\n\n# Big Title\n'
  const { gateway } = vault({})
  const options = { allowRawHtml: false, lowercaseHeadingIds: true }
  const result = await renderCarveWithIncludes(source, { sourcePath: 'root.crv', gateway, renderOptions: options })
  assert.equal(result.html, carveToHtml(source, options))
})

test('the preview renders HTML whatever target a caller asks for', async () => {
  // The reading view inserts this as HTML. `PreviewRenderOptions` drops
  // `target` so the question cannot be asked in TypeScript; this is the same
  // guarantee for a caller that is not type-checked.
  const { gateway } = vault({})
  const result = await renderCarveWithIncludes('# T\n\nbody\n', { sourcePath: 'root.crv', gateway, renderOptions: { allowRawHtml: false, target: 'markdown' } })
  assert.match(result.html, /<h1>T<\/h1>/)
})

const RAW_HTML_SOURCE = 'a `<b>x</b>`{=html} b\n'

test('configuring an unrelated option does not turn raw HTML back on', async () => {
  // The options object EXTENDS the module's defaults rather than replacing
  // them: an object that omits `allowRawHtml` would otherwise re-enable
  // vault-authored HTML by omission.
  const { gateway } = vault({})
  const result = await renderCarveWithIncludes(RAW_HTML_SOURCE, { sourcePath: 'root.crv', gateway, renderOptions: { lowercaseHeadingIds: true } })
  assert.doesNotMatch(result.html, /<b>x<\/b>/)
})

test('raw HTML stays off even when a caller asks for it', async () => {
  const { gateway } = vault({})
  const result = await renderCarveWithIncludes(RAW_HTML_SOURCE, { sourcePath: 'root.crv', gateway, renderOptions: { allowRawHtml: true } })
  assert.doesNotMatch(result.html, /<b>x<\/b>/)
})

/** Element names in `html` carrying an origin, in document order. */
function originElements(html) {
  return [...html.matchAll(/<(\w+)[^>]*data-carve-origin="([^"]*)"/g)].map((match) => `${match[1]}=${match[2]}`)
}

test('a block-level include marks the whole region, plain text included', async () => {
  // The region is one attribute on the block, so a click anywhere inside it
  // finds the origin by walking up - which is why plain text works here and
  // not in the inline case below.
  const { gateway } = vault({ 'book/sub/child.crv': 'inlined text\n' })
  const result = await renderCarveWithIncludes('Before.\n\n{{ sub/child.crv }}\n\nAfter.\n', { sourcePath: 'book/root.crv', gateway })
  assert.deepEqual(originElements(result.html), ['p=book/sub/child.crv'])
})

test('an inline include marks the elements the child produced', async () => {
  // Not "nothing": the child's content is its own node and carries pos.file,
  // so anything that renders as an element can hold the attribute.
  const { gateway } = vault({ 'book/sub/child.crv': '_stressed_\n' })
  const result = await renderCarveWithIncludes('Root {{ sub/child.crv }} tail.\n', { sourcePath: 'book/root.crv', gateway })
  assert.deepEqual(originElements(result.html), ['u=book/sub/child.crv'])
})

/** Every text node as `value|file`, in document order. */
function textFiles(node, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (node.type === 'text') out.push(`${node.value}|${node.pos?.file ?? '-'}`)
  for (const value of Object.values(node)) if (Array.isArray(value)) for (const child of value) textFiles(child, out)
  return out
}

test("an inline include's plain text is merged into the host's run when it is expanded", async () => {
  // carve-js#1679 gave the child's text its own node carrying the file.
  // carve-js#1739 coalesces that run back into the host's, and #1741 keeps the
  // host's span on the merged result, so the attribution is gone one stage
  // earlier than it used to be - at expansion rather than at resolution.
  const { gateway } = vault({ 'book/sub/child.crv': 'inlined text\n' })
  const result = await expandForPreview('Root {{ sub/child.crv }} tail.\n', { sourcePath: 'book/root.crv', gateway })
  assert.deepEqual(textFiles(result.doc), ['Root inlined text tail.|-'])
})

test('resolution coalesces that run back into the parent, losing the attribution', async () => {
  // And the half it was not: the tree that gets RENDERED is the resolved one,
  // where the three runs are one run again and the file is gone. So the
  // README's conclusion for plain text holds while its stated reason does not,
  // and the reason matters - it is why an element-producing child survives.
  const { gateway } = vault({ 'book/sub/child.crv': 'inlined text\n' })
  const expanded = await expandForPreview('Root {{ sub/child.crv }} tail.\n', { sourcePath: 'book/root.crv', gateway })
  assert.deepEqual(textFiles(resolveDocument(expanded.doc)), ['Root inlined text tail.|-'])
})

test('an inline include contributing only plain text marks nothing in the HTML', async () => {
  // And this is the real limit, the one the README has to state instead: a
  // text node is not an element, so there is nothing to carry the attribute
  // and nothing to jump from.
  const { gateway } = vault({ 'book/sub/child.crv': 'inlined text\n' })
  const result = await renderCarveWithIncludes('Root {{ sub/child.crv }} tail.\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.html, /Root inlined text tail\./)
  assert.deepEqual(originElements(result.html), [])
})

test('an inline directive naming block content is refused rather than expanded', async () => {
  // An image on its own line is a block, so the directive stays literal and
  // says why - it is not a silent case of "the gesture found nothing".
  const { gateway } = vault({ 'book/sub/child.crv': '![alt](pic.png)\n' })
  const result = await renderCarveWithIncludes('Root {{ sub/child.crv }} tail.\n', { sourcePath: 'book/root.crv', gateway })
  assert.match(result.html, /\{\{ sub\/child\.crv \}\}/)
  assert.deepEqual(result.diagnostics.map((d) => d.rule), ['include-block-in-inline'])
})
