import assert from 'node:assert/strict'
import test from 'node:test'
import { directiveSiteAt, directiveSites, includeNavigation } from '../dist-test/include-navigation.js'
import { classifyDiagnostics, containmentMessage, directiveKey } from '../dist-test/includes.js'

/** A vault of the paths that exist. */
const existing = (...paths) => (path) => paths.includes(path)

test('the directive under the cursor is the one that is offered', () => {
  const source = '{{ one.crv }}\n\n{{ two.crv }}\n'
  assert.equal(directiveSiteAt(source, 4).path, 'one.crv')
  assert.equal(directiveSiteAt(source, 19).path, 'two.crv')
})

test('a cursor outside every directive offers nothing', () => {
  const source = 'Prose here.\n\n{{ one.crv }}\n'
  assert.equal(directiveSiteAt(source, 3), null)
})

test('the offered span covers the whole directive', () => {
  const site = directiveSiteAt('Text\n\n{{ one.crv }}\n', 8)
  assert.deepEqual([site.from, site.to], [6, 19])
})

test('a directive inside a fenced code block is not offered', () => {
  // The expander leaves it as code, so the gesture has to agree with the
  // preview. The live directive alongside it is what makes this a test of the
  // filter rather than of a document with nothing to offer.
  const source = '```\n{{ one.crv }}\n```\n\n{{ live.crv }}\n'
  assert.deepEqual(directiveSites(source).map((site) => site.path), ['live.crv'])
})

test('a directive inside a code span is not offered', () => {
  const source = 'Write `{{ one.crv }}` to include it.\n\n{{ live.crv }}\n'
  assert.deepEqual(directiveSites(source).map((site) => site.path), ['live.crv'])
})

test('a directive written inside a sentence is offered', () => {
  // The engine expands this one, so the editor offers it too.
  assert.equal(directiveSiteAt('see {{ one.crv }} here\n', 8).path, 'one.crv')
})

test('a token the engine does not treat as a directive is not offered', () => {
  const source = '{{ one.crv 3-7 }}\n\n{{ live.crv }}\n'
  assert.deepEqual(directiveSites(source).map((site) => site.path), ['live.crv'])
})

test('every live directive is offered, in source order', () => {
  const sites = directiveSites('{{ a.crv }}\n\n```\n{{ b.crv }}\n```\n\n{{ c.crv }}\n')
  assert.deepEqual(sites.map((site) => site.path), ['a.crv', 'c.crv'])
})

test('a target beside the including file opens at its vault path', () => {
  const outcome = includeNavigation('child.crv', 'book/root.crv', existing('book/child.crv'))
  assert.deepEqual(outcome, { kind: 'open', path: 'book/child.crv' })
})

test('a vault-root target opens at the vault root', () => {
  const outcome = includeNavigation('/top.crv', 'book/chapters/one.crv', existing('top.crv'))
  assert.deepEqual(outcome, { kind: 'open', path: 'top.crv' })
})

test('a target that climbs out of the vault is refused, not opened', () => {
  const outcome = includeNavigation('../outside.crv', 'root.crv', existing('outside.crv'))
  assert.equal(outcome.kind, 'denied')
})

test('a missing target says it could not be resolved', () => {
  const outcome = includeNavigation('child.crv', 'root.crv', existing())
  assert.deepEqual(outcome, { kind: 'missing', message: 'Include "child.crv" could not be resolved.' })
})

test('a refused jump is explained in the words the reading view uses', () => {
  // One wording, two surfaces: the diagnostic above the document and the
  // notice the gesture raises have to say the same thing about the same path.
  const warning = { line: 1, column: 1, rule: 'include-unresolved', message: 'Include "../outside.crv" could not be resolved.', start: 0, end: 1, file: 'root.crv' }
  const diagnostic = classifyDiagnostics([warning], new Set([directiveKey('root.crv', '../outside.crv')]))[0]
  const outcome = includeNavigation('../outside.crv', 'root.crv', existing())
  assert.equal(outcome.message, diagnostic.message)
  assert.equal(outcome.message, containmentMessage('../outside.crv'))
})

test('a token in a code span is not offered even when the same path is live elsewhere', () => {
  // Deciding liveness by path alone made this copy navigable, contradicting
  // both the preview and the documented rule.
  const source = 'Write `{{ one.crv }}` to include it.\n\n{{ one.crv }}\n'
  const sites = directiveSites(source)
  assert.deepEqual(sites.map((site) => site.from), [source.lastIndexOf('{{')])
})

test('a cursor inside the fenced copy of a live path offers nothing', () => {
  const source = '```\n{{ one.crv }}\n```\n\n{{ one.crv }}\n'
  assert.equal(directiveSiteAt(source, 6), null)
})

test('a cursor between two adjacent directives belongs to the one it opens', () => {
  const source = '{{ one.crv }}{{ two.crv }}\n'
  assert.equal(directiveSiteAt(source, 13).path, 'two.crv')
})

test('a cursor just past the closing braces is still on the directive', () => {
  const source = '{{ one.crv }}\n'
  assert.equal(directiveSiteAt(source, 13).path, 'one.crv')
})

test('a cursor well past the directive is not', () => {
  const source = '{{ one.crv }} and prose.\n'
  assert.equal(directiveSiteAt(source, 20), null)
})
