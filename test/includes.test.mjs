import assert from 'node:assert/strict'
import test from 'node:test'
import { IncludeCache, MAX_CACHE_ENTRIES, classifyDiagnostics, expandForPreview, renderCarveWithIncludes, resolveVaultPath } from '../dist-test/includes.js'
import { ORIGIN_ATTRIBUTE } from '../dist-test/render.js'

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
