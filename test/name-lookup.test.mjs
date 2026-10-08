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

/**
 * The spellings markup-carve/carve#2775 converged - `{{ path#section }}` with
 * no space, a quoted path, and an option with no space before its marker - are
 * NOT recognized by this engine, and that is correct here: #2775 merged to the
 * spec after the 0.1.8 tag, so no published engine implements them yet.
 *
 * This is pinned as a FACT ABOUT THE ENGINE rather than as desired behavior.
 * When the plugin moves to an engine built past that commit, these become live
 * directives, `directiveSites` starts returning them, and this test fails -
 * which is the notice that the navigation and containment paths now have more
 * spellings to carry.
 */
test('the converged include spellings are not live on this engine yet', () => {
  for (const source of [
    '{{ sub/frag.crv#Alpha }}\n',
    '{{ "sub/frag.crv"#Alpha }}\n',
    '{{ sub/frag.crv@heading-shift:1 }}\n',
  ]) {
    assert.equal(
      directiveSites(source).length,
      0,
      `${JSON.stringify(source)} is now a live directive. markup-carve/carve#2775 has reached this `
        + 'engine, so the navigation, containment and preview paths need cases for it.',
    )
  }
})

/** The engine is what decides this, not the plugin's prefilter. */
test('the directive prefilter cannot miss a spelling', () => {
  // Every include spelling opens with `{{`, which is all the prefilter tests
  // before it asks the engine. Stated here so a future spelling that does not
  // is caught as a prefilter bug rather than as a missing directive.
  for (const source of ['{{ a.crv }}', '{{ a.crv #S }}', '{{ "a.crv"#S }}', '{{ a.crv@o:v }}']) {
    assert.ok(source.includes('{{'), `${source} would be skipped by the prefilter`)
  }
})

/** Guards the suite above: a renderer returning nothing would pass the negatives. */
test('renderCarve actually renders', () => {
  const html = renderCarve('# Plan\n')
  assert.match(html, /<h1[^>]*>Plan<\/h1>/)
  assert.ok(carveToHtml('# Plan\n').length > 0)
})
