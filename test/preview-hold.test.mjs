import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'
import { isBareListMarker, shouldHoldRender } from '../dist-test/preview-hold.js'

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
