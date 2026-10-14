import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'
import { directiveSites } from '../dist-test/include-navigation.js'
import { renderCarve } from '../dist-test/render.js'

/**
 * Every name lookup compares case exactly (carve 0.1.8, carve-js 0.1.10,
 * markup-carve/carve#2732).
 *
 * This is the delta in tonight's engine a reader of a note sees directly: a
 * cross-reference whose case does not match its target used to render as a
 * working link and now renders as the literal source text, so a note loses a
 * link rather than following one to the differently-cased heading.
 *
 * Measured across the pin move in separate installs: on carve-js 0.1.9
 * `</#plan>` against `{#Plan}` rendered `<a href="#Plan">Plan</a>`; on 0.1.10
 * it renders `&lt;/#plan&gt;`. So the wrong-case cases below fail on the
 * previous pin, which is what makes them an answer to the delta rather than a
 * restatement of today's behavior.
 *
 * Driven through `renderCarve`, the plugin's own path, so the plugin's render
 * options cannot quietly reintroduce the old resolution.
 */

test('an exactly cased cross-reference still links', () => {
  const html = renderCarve('{#Plan}\n# Plan\n\nSee </#Plan>.\n')
  assert.match(html, /<a href="#Plan">/)
})

test('a wrongly cased cross-reference renders as literal text', () => {
  const html = renderCarve('{#Plan}\n# Plan\n\nSee </#plan>.\n')
  assert.doesNotMatch(html, /href="#Plan"/)
  assert.match(html, /&lt;\/#plan&gt;/)
})

test('a wrongly cased collapsed reference stays literal', () => {
  const html = renderCarve('See [Plan][] and [plan][].\n\n# Plan\n')
  assert.match(html, /<a href="#Plan">Plan<\/a>/)
  assert.ok(html.includes('[plan][]'), `the wrongly cased reference resolved: ${html}`)
})

/**
 * The same rule reaches include selectors, which the engine already compared
 * exactly before this release. Pinned so the two cannot drift apart, and
 * recorded as unchanged rather than claimed as new.
 */
test('an include selector carries its case to the engine unchanged', () => {
  const [exact] = directiveSites('{{ sub/frag.crv #Alpha }}\n')
  assert.equal(exact.path, 'sub/frag.crv')

  const [lower] = directiveSites('{{ sub/frag.crv #alpha }}\n')
  assert.equal(lower.path, 'sub/frag.crv')
})

/**
 * A selector does not leak into the path the navigation gesture opens. If it
 * did, opening the directive would look for a note called
 * `sub/frag.crv #Alpha` and report it missing.
 */
test('a selector is not glued onto the path the gesture opens', () => {
  for (const source of ['{{ sub/frag.crv }}\n', '{{ sub/frag.crv #Alpha }}\n']) {
    const [site] = directiveSites(source)
    assert.equal(site.path, 'sub/frag.crv', `wrong path for ${JSON.stringify(source)}`)
  }
})

/** The engine now recognizes compact selectors, quoted paths, and adjacent options. */
test('converged include spellings stay live in navigation', () => {
  for (const source of [
    '{{ sub/frag.crv#Alpha }}\n',
    '{{ "sub/frag.crv"#Alpha }}\n',
    '{{ sub/frag.crv@shift:1 }}\n',
  ]) {
    const [site] = directiveSites(source)
    assert.equal(site.path, 'sub/frag.crv', source)
    assert.equal(source.slice(site.from, site.to), source.trim(), source)
  }
})
