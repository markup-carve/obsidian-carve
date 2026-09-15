import assert from 'node:assert/strict'
import test from 'node:test'
import { BUNDLE_MANIFEST, bundleEntryPath, bundleManifest, bundlePath, bundleSummary, foldersFor, manifestPath, planBundle } from '../dist-test/bundle.js'

/** A vault of `path -> source`, counting reads. */
function vault(files) {
  const state = new Map(Object.entries(files))
  const reads = []
  return {
    reads,
    gateway: {
      mtime: (path) => (state.has(path) ? 1 : null),
      read: async (path) => {
        reads.push(path)
        if (!state.has(path)) throw new Error(`No such file: ${path}`)
        return state.get(path)
      },
    },
  }
}

const plan = (source, sourcePath, files) => planBundle(source, { sourcePath, gateway: vault(files).gateway })

test('the bundle holds the document and every file it reaches', async () => {
  const result = await plan('Root.\n\n{{ sub/child.crv }}\n', 'book/root.crv', {
    'book/sub/child.crv': 'Child.\n\n{{ deeper.crv }}\n',
    'book/sub/deeper.crv': 'Deeper.\n',
  })
  assert.deepEqual(result.files, ['book/root.crv', 'book/sub/child.crv', 'book/sub/deeper.crv'])
  assert.deepEqual(result.missing, [])
})

test('the entry document comes first, even when it is also a target', async () => {
  // A document that includes itself is a cycle the engine refuses, but the
  // path is still in the dependency set; the entry must not appear twice.
  const result = await plan('{{ root.crv }}\n', 'book/root.crv', { 'book/root.crv': '{{ root.crv }}\n' })
  assert.deepEqual(result.files, ['book/root.crv'])
})

test('a target that could not be read is named rather than dropped', async () => {
  // It is part of the dependency set and has no bytes, so a bundle that left
  // it out silently would look complete.
  const result = await plan('{{ there.crv }}\n\n{{ gone.crv }}\n', 'book/root.crv', { 'book/there.crv': 'Here.\n' })
  assert.deepEqual(result.files, ['book/root.crv', 'book/there.crv'])
  assert.deepEqual(result.missing, ['book/gone.crv'])
})

test('a target outside the vault is recorded as refused, not as missing', async () => {
  // It never became a vault path, so it is in neither of the other two lists.
  const result = await plan('{{ ../secrets.crv }}\n', 'root.crv', {})
  assert.deepEqual(result.files, ['root.crv'])
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.denied, [{ file: 'root.crv', path: '../secrets.crv' }])
})

test('every file keeps its vault path inside the bundle', () => {
  // Which is what leaves a /vault-root directive resolving: the bundle root is
  // the vault root, so the spelling still names the same file.
  assert.equal(bundleEntryPath('book/root.bundle', 'book/sub/child.crv'), 'book/root.bundle/book/sub/child.crv')
  assert.equal(bundleEntryPath('book/root.bundle', 'shared/glossary.crv'), 'book/root.bundle/shared/glossary.crv')
})

test('the folders a bundle entry needs are listed outermost first', () => {
  assert.deepEqual(foldersFor('book/root.bundle/book/sub/child.crv'), ['book', 'book/root.bundle', 'book/root.bundle/book', 'book/root.bundle/book/sub'])
  assert.deepEqual(foldersFor('top.crv'), [])
})

test('the bundle folder is derived from the document and steps aside', () => {
  assert.equal(bundlePath('book/root.crv', () => false), 'book/root.bundle')
  assert.equal(bundlePath('book/root.crv', (path) => path === 'book/root.bundle'), 'book/root.bundle-2')
  assert.equal(bundlePath('root.crv', () => true), null)
})

test('the manifest names the entry, what was copied and what was not', async () => {
  const result = await plan('{{ there.crv }}\n\n{{ gone.crv }}\n', 'book/root.crv', { 'book/there.crv': 'Here.\n' })
  assert.deepEqual(JSON.parse(bundleManifest(result)), {
    document: 'book/root.crv',
    files: ['book/root.crv', 'book/there.crv'],
    missing: ['book/gone.crv'],
    denied: [],
  })
})

test('the summary states the count and every target it could not take', async () => {
  const result = await plan('{{ there.crv }}\n\n{{ gone.crv }}\n\n{{ ../../out.crv }}\n', 'book/root.crv', { 'book/there.crv': 'Here.\n' })
  const summary = bundleSummary(result, 'book/root.bundle')
  assert.match(summary, /Bundled into book\/root\.bundle: 2 files\./)
  assert.match(summary, /1 target could not be read; listed in carve-bundle\.json\./)
  assert.match(summary, /1 target outside the vault was not read\./)
  assert.equal(BUNDLE_MANIFEST, 'carve-bundle.json')
})

test('the entry document is never read from the vault', async () => {
  // Its bytes come from the open view, which may hold unsaved edits, so a
  // bundle of a dirty document carries what the author is looking at.
  const files = { 'book/root.crv': 'STALE ON DISK\n', 'book/sub/child.crv': 'Child.\n' }
  const disk = vault(files)
  const result = await planBundle('Root.\n\n{{ sub/child.crv }}\n', { sourcePath: 'book/root.crv', gateway: disk.gateway })
  assert.deepEqual(result.files, ['book/root.crv', 'book/sub/child.crv'])
  assert.deepEqual(disk.reads, ['book/sub/child.crv'])
})

test('the manifest steps aside for a file that occupies its name', () => {
  // A document may include `/carve-bundle.json`, which lands at exactly the
  // path the manifest wants. Writing the manifest second would then fail and
  // leave a half-written bundle.
  assert.equal(manifestPath(['book/root.crv']), 'carve-bundle.json')
  assert.equal(manifestPath(['book/root.crv', 'carve-bundle.json']), 'carve-bundle-2.json')
  assert.equal(manifestPath(['carve-bundle.json', 'carve-bundle-2.json']), 'carve-bundle-3.json')
})

test('the manifest name search cannot run out', () => {
  // It probes a set already in hand, so one more candidate than there are
  // files is always free. A cap would need a fallback, and the only one
  // available is a name known to be occupied.
  const crowded = ['carve-bundle.json', ...Array.from({ length: 400 }, (_v, n) => `carve-bundle-${n + 2}.json`)]
  assert.equal(manifestPath(crowded), 'carve-bundle-402.json')
})

test('the manifest name is the one the plan carries, not a constant', async () => {
  const result = await plan('{{ /carve-bundle.json }}\n', 'book/root.crv', { 'carve-bundle.json': 'included.\n' })
  assert.deepEqual(result.files, ['book/root.crv', 'carve-bundle.json'])
  assert.equal(result.manifest, 'carve-bundle-2.json')
  assert.equal(BUNDLE_MANIFEST, 'carve-bundle.json')
})

test('every refused target is named, past the warning cap', async () => {
  // The diagnostics are capped by the engine, so a manifest built from them
  // would quietly shorten. These come from the resolver instead.
  // The engine retains 100 warnings by default, so 130 refusals cross it.
  const directives = Array.from({ length: 130 }, (_v, n) => `{{ ../out-${n}.crv }}`).join('\n\n')
  const result = await plan(`${directives}\n`, 'root.crv', {})
  assert.equal(result.denied.length, 130)
  assert.ok(result.diagnostics.length < 130, `diagnostics were not capped: ${result.diagnostics.length}`)
  assert.ok(result.suppressed > 0, 'nothing was suppressed')
  assert.deepEqual(result.denied[129], { file: 'root.crv', path: '../out-129.crv' })
})

test('the same spelling in two files is two refused targets', async () => {
  const result = await plan('{{ ../out.crv }}\n\n{{ deep/inner.crv }}\n', 'root.crv', { 'deep/inner.crv': '{{ ../../out.crv }}\n' })
  assert.deepEqual(result.denied, [{ file: 'root.crv', path: '../out.crv' }, { file: 'deep/inner.crv', path: '../../out.crv' }])
})
