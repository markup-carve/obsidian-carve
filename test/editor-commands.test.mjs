import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from '@markup-carve/carve'
import { fencedBlockEdit, headingEdit, inlineFormatEdit, linePrefixEdit, linkFormatEdit, listContinuationEdit, listIndentEdit, simpleTableEdit, taskToggleEdit } from '../dist-test/editor-commands.js'

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

// The engine is the oracle: the nesting depth of the list item that starts on `line`.
function itemDepth(source, line) {
  let found = null
  const visit = (value, depth) => {
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, depth))
    if (!value || typeof value !== 'object') return
    if (value.type === 'list_item' && value.pos?.startLine === line + 1 && found === null) found = depth
    for (const [key, child] of Object.entries(value)) if (key !== 'pos') visit(child, depth + (value.type === 'list' ? 1 : 0))
  }
  visit(parse(source, { positions: true }).children, 0)
  return found
}

function lineStart(source, line) {
  return source.split('\n').slice(0, line).reduce((offset, text) => offset + text.length + 1, 0)
}

function indentAt(source, line, outdent = false, lastLine = line) {
  const to = lineStart(source, lastLine) + source.split('\n')[lastLine].length
  const edit = listIndentEdit(source, lineStart(source, line), to, outdent)
  return edit && apply(source, edit.changes)
}

const indentCases = [
  ['bullet under a numbered item reaches its content column', '1. a\n- b', 1, false, '1. a\n   - b', 2],
  ['ten-wide parent needs four columns', '10. a\n11. b', 1, false, '10. a\n    1. b', 2],
  ['first child restarts at 1', '1. a\n2. b', 1, false, '1. a\n   1. b', 2],
  ['joining a child list takes the next ordinal', '1. a\n   1. x\n2. b', 2, false, '1. a\n   1. x\n   2. b', 2],
  ['alpha first child restarts at a', 'a. x\nb. y', 1, false, 'a. x\n   a. y', 2],
  ['roman first child restarts at i', 'i. x\nii. y', 1, false, 'i. x\n   i. y', 2],
  ['paren delimiter is kept', '1) a\n2) b', 1, false, '1) a\n   1) b', 2],
  ['bare-dot marker stays a bare dot', '. a\n. b', 1, false, '. a\n  . b', 2],
  ['nested list after a different marker kind', '- a\n  1. b\n  - c', 2, false, '- a\n  1. b\n     - c', 3],
  ['bullet keeps its character', '- a\n- b', 1, false, '- a\n  - b', 2],
  ['task item nests at the bullet content column', '- [ ] a\n- [x] b', 1, false, '- [ ] a\n  - [x] b', 2],
  ['bare marker after Enter', '- a\n- ', 1, false, '- a\n  - ', null],
  ['continuation lines and children move with the item', '- a\n- b\n  more\n  - c', 1, false, '- a\n  - b\n    more\n    - c', 2],
  ['marker width change keeps continuation lines in the item', '9. a\n10. b\n    more', 1, false, '9. a\n   1. b\n      more', 2],
  ['first item of a list keeps the default Tab', '- a', 0, false, null, 1],
  ['after a paragraph there is nothing to nest under', 'para\n- b', 1, false, null, 1],
  ['outdent to the parent marker column', '- a\n  - b', 1, true, '- a\n- b', 1],
  ['outdent takes the next ordinal in the parent list', '1. a\n   1. b', 1, true, '1. a\n2. b', 1],
  ['outdent from a ten-wide parent', '10. a\n    1. b\n       more', 1, true, '10. a\n11. b\n    more', 1],
  ['outdent of a bare marker', '- a\n  - x\n  - ', 2, true, '- a\n  - x\n- ', null],
  ['tab-indented child outdents', '- a\n\t- b', 1, true, '- a\n- b', 1],
  ['top-level outdent keeps the default', '- a', 0, true, null, 1],
]

for (const [name, source, line, outdent, expected, depth] of indentCases) {
  test(`list Tab: ${name}`, () => {
    const result = indentAt(source, line, outdent)
    assert.equal(result, expected)
    if (result === null) return
    // A bare marker is lazy text until it has content, so measure it with some.
    const measured = result.split('\n').map((text, index) => (index === line && /^[ \t]*\S+ ?(?:\[ \] )?$/.test(text) ? `${text}x` : text)).join('\n')
    assert.equal(itemDepth(measured, line), depth ?? (outdent ? itemDepth(source + 'x', line) - 1 : itemDepth(source + 'x', line) + 1))
  })
}

test('list Tab leaves non-items alone', () => {
  assert.equal(indentAt('paragraph', 0), null)
  assert.equal(indentAt('+ a\n+ b', 1), null)
  assert.equal(indentAt('(1) a\n(2) b', 1), null)
  assert.equal(indentAt('-\ta\n-\tb', 1), null)
  assert.equal(indentAt('```\n- a\n- b\n```', 2), null)
  assert.equal(indentAt('% - a\n% - b', 1), null)
})

test('list Tab moves each selected item once', () => {
  const ordered = indentAt('1. a\n2. b\n3. c\n   more\n4. d', 1, false, 3)
  assert.equal(ordered, '1. a\n   1. b\n   2. c\n      more\n4. d')
  assert.equal(itemDepth(ordered, 1), 2); assert.equal(itemDepth(ordered, 2), 2); assert.equal(itemDepth(ordered, 4), 1)
  const bullets = indentAt('- a\n  - b\n    - c\n  - d', 1, true, 3)
  assert.equal(bullets, '- a\n- b\n  - c\n- d')
  assert.equal(itemDepth(bullets, 1), 1); assert.equal(itemDepth(bullets, 2), 2); assert.equal(itemDepth(bullets, 3), 1)
})

test('source Enter continues bullets, numbering, and task state', () => {
  assert.equal(apply('- item', listContinuationEdit('- item', 0, 6, 6).changes), '- item\n- ')
  assert.equal(apply('9. item', listContinuationEdit('9. item', 0, 7, 7).changes), '9. item\n10. ')
  assert.equal(apply('- [x] done', listContinuationEdit('- [x] done', 0, 10, 10).changes), '- [x] done\n- [ ] ')
  assert.equal(apply('- [>] later', listContinuationEdit('- [>] later', 0, 11, 11).changes), '- [>] later\n- [ ] ')
  assert.equal(apply('a. x', listContinuationEdit('a. x', 0, 4, 4).changes), 'a. x\nb. ')
  assert.equal(apply('iv) x', listContinuationEdit('iv) x', 0, 5, 5).changes), 'iv) x\nv)  ')
  assert.equal(apply('. x', listContinuationEdit('. x', 0, 3, 3).changes), '. x\n. ')
  assert.equal(apply('- ', listContinuationEdit('- ', 0, 2, 2).changes), '')
  assert.equal(apply('- a\n- [ ] ', listContinuationEdit('- a\n- [ ] ', 4, 10, 10).changes), '- a\n')
})

test('source Enter leaves non-markers to the default', () => {
  for (const line of ['+ x', '(1) x', '-\tx', 'iV. x', 'paragraph']) assert.equal(listContinuationEdit(line, 0, line.length, line.length), null, line)
  assert.equal(listContinuationEdit('```\n- x\n```', 4, 7, 7), null)
})

test('source task shortcut creates and toggles tasks without rewriting content', () => {
  assert.equal(apply('do it', taskToggleEdit('do it', 0, 5).changes), '- [ ] do it')
  assert.equal(apply('- item', taskToggleEdit('- item', 0, 6).changes), '- [ ] item')
  assert.equal(apply('- [ ] item', taskToggleEdit('- [ ] item', 0, 10).changes), '- [x] item')
  assert.equal(apply('- [x] item', taskToggleEdit('- [x] item', 0, 10).changes), '- [ ] item')
  assert.equal(apply('- [?] item', taskToggleEdit('- [?] item', 0, 10).changes), '- [x] item')
  assert.equal(apply('+ item', taskToggleEdit('+ item', 0, 6).changes), '- [ ] + item')
})
