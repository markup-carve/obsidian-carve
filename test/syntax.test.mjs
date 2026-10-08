import assert from 'node:assert/strict'
import test from 'node:test'
import { StringStream } from '@codemirror/language'
import { carveStreamParser } from '../dist-test/syntax.js'

/**
 * The Live Preview highlighter, driven directly over its own StreamParser.
 *
 * `syntax.ts` had no coverage at all, which is how an include directive came to
 * be painted as an Obsidian tag: nothing here reads the token names, so a rule
 * claiming the wrong span is invisible until a user looks at a note.
 */

/** Token names the parser returns for `line`, one per consumed span. */
function tokens(line) {
  const state = carveStreamParser.startState()
  const stream = new StringStream(line, 2, 2)
  const out = []
  let guard = 0
  while (!stream.eol()) {
    if (guard++ > 500) throw new Error(`parser did not advance on ${JSON.stringify(line)}`)
    const start = stream.pos
    const token = carveStreamParser.token(stream, state)
    if (stream.pos === start) stream.next()
    out.push([token, line.slice(start, stream.pos)])
    stream.start = stream.pos
  }
  return out
}

/** The token covering `text`, or null. */
function tokenFor(line, text) {
  return tokens(line).find(([, span]) => span === text)?.[0] ?? null
}

test('an include directive is one token, not a tag', () => {
  assert.equal(tokenFor('{{ frag.crv }}', '{{ frag.crv }}'), 'keyword')
})

/**
 * Every spelling, including the four markup-carve/carve#2775 converged. The
 * rule takes the whole `{{ ... }}` span, so these are covered by construction
 * rather than one arm per spelling - which is the failure a sibling lane found
 * in four other grammars, where a pattern requiring whitespace before `#`
 * highlighted a valid document wrongly.
 */
test('every include spelling highlights as one directive', () => {
  for (const line of [
    '{{ frag.crv }}',
    '{{ frag.crv #Alpha }}',
    '{{ frag.crv#Alpha }}',
    '{{ "frag.crv"#Alpha }}',
    '{{ frag.crv@heading-shift:1 }}',
    '{{ frag.crv #Alpha@heading-shift:1 }}',
  ]) {
    assert.equal(tokenFor(line, line), 'keyword', `${line} did not highlight as one directive`)
  }
})

/**
 * The regression this guards. Before the directive rule existed, the tag rule
 * claimed the selector and a section reference was painted as an Obsidian tag.
 */
test('a selector inside a directive is not painted as a tag', () => {
  const names = tokens('{{ frag.crv #Alpha }}').map(([name]) => name)
  assert.ok(!names.includes('tagName'), `a tag token appeared: ${JSON.stringify(tokens('{{ frag.crv #Alpha }}'))}`)
})

/** A real tag outside a directive still highlights, so the fix did not overreach. */
test('an ordinary tag still highlights', () => {
  assert.equal(tokenFor('see #carve here', '#carve'), 'tagName')
})

/** A directive inside a code span is code, because the code rule runs first. */
test('a directive inside a code span stays code', () => {
  assert.equal(tokenFor('`{{ frag.crv }}`', '`{{ frag.crv }}`'), 'monospace')
})

/** Controls, so a parser returning null for everything would not pass the above. */
test('the parser still recognizes the constructs it always did', () => {
  assert.equal(tokens('# Heading')[0][0], 'heading')
  assert.equal(tokenFor('a *strong* word', '*strong*'), 'strong')
  assert.equal(tokenFor('a [link](x) here', '[link](x)'), 'link')
  assert.equal(tokenFor('a [[Guide]] here', '[[Guide]]'), 'link')
})
