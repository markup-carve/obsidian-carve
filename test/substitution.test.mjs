import assert from 'node:assert/strict'
import test from 'node:test'
import { substitutionHalves } from '../dist-test/substitution.js'

test('a substitution arrow is strikethrough text in 0.2, so it yields no halves (U-069)', () => {
  assert.equal(substitutionHalves('{~old~>new~}'), null)
  assert.equal(substitutionHalves('{~a~>b~>c~}'), null)
  assert.equal(substitutionHalves('{~ *o* ~> _n_ ~}'), null)
})

test('an arrow the engine does not read as a split point yields no halves', () => {
  // carve#2083 - inside a code span it is text, so the pair is a strikethrough.
  assert.equal(substitutionHalves('{~a `x~>y` b~}'), null)
  assert.equal(substitutionHalves('{~nothing~}'), null)
})

test('an empty half is no substitution either in 0.2 (U-069)', () => {
  assert.equal(substitutionHalves('{~~>new~}'), null)
  assert.equal(substitutionHalves('{~old~>~}'), null)
})
