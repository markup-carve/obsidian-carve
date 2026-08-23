import assert from 'node:assert/strict'
import test from 'node:test'
import { fencedBlockEdit, headingEdit, inlineFormatEdit, linePrefixEdit, linkFormatEdit, listContinuationEdit, listIndentEdit, simpleTableEdit } from '../dist-test/editor-commands.js'

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

test('table row commands insert before and after the active row', () => {
  const source = '| A | B |\n| x | y |'
  assert.equal(apply(source, simpleTableEdit(source, 16, 'row-before').changes), '| A | B |\n|  |  |\n| x | y |')
  assert.equal(apply(source, simpleTableEdit(source, 16, 'row-after').changes), '| A | B |\n| x | y |\n|  |  |')
})

test('table column commands modify every row on the selected axis', () => {
  const source = '| A | B |\n| x | y |'
  assert.equal(apply(source, simpleTableEdit(source, 16, 'column-before').changes), '| A |  | B |\n| x |  | y |')
  assert.equal(apply(source, simpleTableEdit(source, 16, 'column-after').changes), '| A | B |  |\n| x | y |  |')
})

test('table commands refuse escaped and ragged grids', () => {
  assert.equal(simpleTableEdit('| a \\| b |', 3, 'column-after'), null)
  assert.equal(simpleTableEdit('| a | b |\n| x |', 3, 'column-after'), null)
})

test('table deletion protects the final row and column', () => {
  const source = '| A | B |\n| x | y |'
  assert.equal(apply(source, simpleTableEdit(source, 16, 'delete-row').changes), '| A | B |')
  assert.equal(apply(source, simpleTableEdit(source, 16, 'delete-column').changes), '| A |\n| x |')
  assert.equal(simpleTableEdit('| only |', 3, 'delete-row'), null)
  assert.equal(simpleTableEdit('| only |', 3, 'delete-column'), null)
  assert.equal(simpleTableEdit('| only |\n\n| unrelated |', 3, 'delete-row'), null)
})

test('line prefixes toggle without changing line content', () => {
  assert.equal(apply('human', linePrefixEdit('human', 0, 5, 'bullet').changes), '- human')
  assert.equal(apply('- human', linePrefixEdit('- human', 0, 7, 'bullet').changes), 'human')
  assert.equal(apply('- human', linePrefixEdit('- human', 0, 7, 'task').changes), '- [ ] human')
  assert.equal(apply('human', linePrefixEdit('human', 0, 5, 'quote').changes), '> human')
  assert.equal(apply('human', linePrefixEdit('human', 0, 5, 'ordered').changes), '1. human')
  assert.equal(apply('1. human', linePrefixEdit('1. human', 0, 8, 'ordered').changes), 'human')
})

test('code fences wrap only the selected source', () => {
  const source = 'before\ncode\nafter'
  const edit = fencedBlockEdit(source, 7, 11, 'js')
  assert.equal(apply(source, edit.changes), 'before\n```js\ncode\n```\nafter')
})

test('source list indentation follows Tab and Shift+Tab', () => {
  assert.equal(apply('- nested', listIndentEdit('- nested', 0, 8).changes), '  - nested')
  assert.equal(apply('  - nested', listIndentEdit('  - nested', 0, 10, true).changes), '- nested')
  assert.equal(listIndentEdit('paragraph', 0, 9), null)
})

test('source Enter continues bullets, numbering, and task state', () => {
  assert.equal(apply('- item', listContinuationEdit('- item', 0, 6, 6).changes), '- item\n- ')
  assert.equal(apply('9. item', listContinuationEdit('9. item', 0, 7, 7).changes), '9. item\n10. ')
  assert.equal(apply('- [x] done', listContinuationEdit('- [x] done', 0, 10, 10).changes), '- [x] done\n- [ ] ')
  assert.equal(apply('- ', listContinuationEdit('- ', 0, 2, 2).changes), '')
})
