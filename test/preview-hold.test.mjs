import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'
import { EditorSelection, EditorState } from '@codemirror/state'
import { isBareListMarker, previewHoldUpdate, shouldHoldRender } from '../dist-test/preview-hold.js'
import { listContinuationEdit } from '../dist-test/editor-commands.js'

const bare = [
  '-', '- ', '*', '* ', '-\t',
  '1.', '2. ', '10)', 'a.', 'B)', 'i.', 'iv) ', 'XII.', '.', '. ',
  '- [ ]', '- [ ] ', '* [x]', '- [X]', '- [-]', '- [>]', '- [?]', '- [_]',
  '  - ', '    1. ', '> - ', '> > 1.', '>- ',
]
const notBare = [
  '', ' ', '+', '+ ', '- a', '1. one', '- [ ] todo', '-a', '--', '---', '* * *', '- - -',
  'ab.', 'iV.', '1', 'a', '-[ ]', 'text -', '> ', '- [y]', '1. [ ]', '> + ',
]

for (const line of bare) {
  test(`bare marker: ${JSON.stringify(line)}`, () => {
    assert.equal(isBareListMarker(line), true)
  })
}

for (const line of notBare) {
  test(`not a bare marker: ${JSON.stringify(line)}`, () => {
    assert.equal(isBareListMarker(line), false)
  })
}

test('the hold covers exactly the reading the engine folds into the item above', () => {
  assert.match(carveToHtml('- first\n- '), /<li>first\n-<\/li>/)
  assert.match(carveToHtml('- first\n- t'), /<li>t<\/li>/)
})

test('the render holds on a bare marker typed under a list', () => {
  const text = '- first\n- second\n- '
  assert.equal(shouldHoldRender(text, 2), true)
  assert.equal(shouldHoldRender(text, 1), false)
  assert.equal(shouldHoldRender('- first\n- second\n- t', 2), false)
})

test('the render holds on a bare marker inside a quote', () => {
  assert.equal(shouldHoldRender('> - a\n> - ', 1), true)
})

test('the render does not hold on a marker inside a code fence', () => {
  assert.equal(shouldHoldRender('```\n- \n```\n', 1), false)
  assert.equal(shouldHoldRender('~~~~\n```\n- \n', 2), false)
  assert.equal(shouldHoldRender('```\n- \n```\n- ', 3), true)
})

test('an unclosed fence runs to the end', () => {
  assert.equal(shouldHoldRender('~~~\nx\ny\n-', 3), false)
})

test('a fence opened on a list-item line still counts', () => {
  assert.equal(shouldHoldRender('- ```\n  - \n  ```\n', 1), false)
  assert.equal(shouldHoldRender('> - ```\n>   - \n', 1), false)
  assert.equal(shouldHoldRender('- ```\n  x\n  ```\n- ', 3), true)
})

test('a marker back at the item column ends the item, and with it the fence', () => {
  assert.equal(shouldHoldRender('> - ```\n> - \n', 1), true)
})

test('an inline code span is not a fence opener', () => {
  assert.equal(shouldHoldRender('```code```\n\n- a\n- ', 3), true)
})

test('a marker line is not a fence closer', () => {
  assert.equal(shouldHoldRender('```\n- ```\n-', 2), false)
})

test('the render does not hold for an out-of-range line', () => {
  assert.equal(shouldHoldRender('- ', 3), false)
  assert.equal(shouldHoldRender('- ', -1), false)
})

test('CRLF line endings split like LF', () => {
  assert.equal(shouldHoldRender('- a\r\n- \r\n', 1), true)
  assert.equal(shouldHoldRender('```\r\n- \r\n```\r\n', 1), false)
})

test('repeated roman and alpha markers do not backtrack exponentially', () => {
  const started = performance.now()
  for (const line of ['i. '.repeat(5000) + 'x', 'I) '.repeat(5000) + 'x', '> '.repeat(5000) + 'x', 'ii.'.repeat(5000)]) {
    assert.equal(isBareListMarker(line), false)
  }
  assert.ok(performance.now() - started < 1000)
})

function enter(state) {
  const head = state.selection.main.head; const line = state.doc.lineAt(head)
  const edit = listContinuationEdit(state.doc.toString(), line.from, line.to, head)
  assert.ok(edit, 'Enter continues the list')
  return state.update({ changes: edit.changes, selection: EditorSelection.cursor(edit.head) })
}
const focused = { hasFocus: true }

test('Enter after a task leaves a content-less box under the cursor and the preview holds', () => {
  const start = EditorState.create({ doc: '- [x] done', selection: { anchor: 10 } })
  const transaction = enter(start)
  assert.equal(transaction.state.doc.toString(), '- [x] done\n- [ ] ')
  assert.equal(transaction.state.selection.main.head, transaction.state.doc.length)
  // The engine reads `- [ ] ` as a plain item with text `[ ]`, which is what the hold keeps off screen.
  assert.match(carveToHtml('- [x] done\n- [ ] '), /<li>\[ \]<\/li>/)
  const update = { docChanged: true, selectionSet: true, focusChanged: false, state: transaction.state, view: focused }
  assert.deepEqual(previewHoldUpdate(update, null), { heldLine: 1, render: false })
})

test('the hold on a content-less box releases on the first character, on leaving the line, or on blur', () => {
  const held = EditorState.create({ doc: '- [x] done\n- [ ] ', selection: { anchor: 17 } })
  const typed = held.update({ changes: { from: 17, insert: 'a' }, selection: { anchor: 18 } }).state
  assert.deepEqual(previewHoldUpdate({ docChanged: true, selectionSet: true, focusChanged: false, state: typed, view: focused }, 1), { heldLine: null, render: true })
  const moved = held.update({ selection: { anchor: 3 } }).state
  assert.deepEqual(previewHoldUpdate({ docChanged: false, selectionSet: true, focusChanged: false, state: moved, view: focused }, 1), { heldLine: null, render: true })
  const along = held.update({ selection: { anchor: 13 } }).state
  assert.deepEqual(previewHoldUpdate({ docChanged: false, selectionSet: true, focusChanged: false, state: along, view: focused }, 1), { heldLine: 1, render: false })
  assert.deepEqual(previewHoldUpdate({ docChanged: false, selectionSet: false, focusChanged: true, state: held, view: { hasFocus: false } }, 1), { heldLine: null, render: true })
  assert.deepEqual(previewHoldUpdate({ docChanged: false, selectionSet: true, focusChanged: false, state: moved, view: focused }, null), { heldLine: null, render: false })
})
