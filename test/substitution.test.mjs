import assert from 'node:assert/strict'
import test from 'node:test'
import { substitutionHalves } from '../dist-test/substitution.js'

test('the halves split at the first top-level arrow', () => {
  assert.deepEqual(substitutionHalves('{~old~>new~}'), { old: 'old', new: 'new' })
  assert.deepEqual(substitutionHalves('{~a~>b~>c~}'), { old: 'a', new: 'b~>c' })
  assert.deepEqual(substitutionHalves('{~ *o* ~> _n_ ~}'), { old: ' *o* ', new: ' _n_ ' })
})

test('an arrow the engine does not read as a split point yields no halves', () => {
  // carve#2083 - inside a code span it is text, so the pair is a strikethrough.
  assert.equal(substitutionHalves('{~a `x~>y` b~}'), null)
  assert.equal(substitutionHalves('{~nothing~}'), null)
})

test('an empty half comes back empty rather than swallowing the other', () => {
  assert.deepEqual(substitutionHalves('{~~>new~}'), { old: '', new: 'new' })
  assert.deepEqual(substitutionHalves('{~old~>~}'), { old: 'old', new: '' })
})
