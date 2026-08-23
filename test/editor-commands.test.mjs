import assert from 'node:assert/strict'
import test from 'node:test'
import { headingEdit, inlineFormatEdit, linkFormatEdit } from '../dist-test/editor-commands.js'

function apply(source, changes) {
  for (const change of [...changes].reverse()) source = source.slice(0, change.from) + change.insert + source.slice(change.to)
  return source
}

test('inline formatting wraps only the selection and preserves its logical selection', () => {
  const edit = inlineFormatEdit('human text', 0, 5, '*')
  assert.equal(apply('human text', edit.changes), '*human* text')
  assert.deepEqual([edit.anchor, edit.head], [1, 6])
})

test('inline formatting toggles off without rewriting selected content', () => {
  const edit = inlineFormatEdit('*human* text', 1, 6, '*')
  assert.equal(apply('*human* text', edit.changes), 'human text')
  assert.deepEqual([edit.anchor, edit.head], [0, 5])
})

test('link formatting leaves the destination ready for source editing', () => {
  const edit = linkFormatEdit('human', 0, 5)
  assert.equal(apply('human', edit.changes), '[human]()')
  assert.deepEqual([edit.anchor, edit.head], [8, 8])
})

test('heading edits replace only an existing marker or insert a new one', () => {
  assert.equal(apply('### Human\nnext', headingEdit('### Human\nnext', 0, 9, 2).changes), '## Human\nnext')
  assert.equal(apply('Human\nnext', headingEdit('Human\nnext', 0, 5, 3).changes), '### Human\nnext')
  assert.equal(apply('### Human\nnext', headingEdit('### Human\nnext', 0, 9, 0).changes), 'Human\nnext')
})
