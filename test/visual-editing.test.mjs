import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, { document: window.document, Element: window.Element })
const { applyVisualInputRule, formatVisualBlock, insertPlainText, toggleVisualList, wrapVisualSelection } = await import('../dist-test/visual-editing.js')

function selectTextNode(element, offset) {
  const range = document.createRange(); range.setStart(element.firstChild, offset); range.collapse(true)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection
}

test('typing Markdown heading syntax creates the corresponding rendered heading', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>### </p>'; document.body.append(surface)
  assert.equal(applyVisualInputRule(surface, selectTextNode(surface.firstElementChild, 4)), true)
  assert.equal(surface.innerHTML, '<h3><br></h3>')
})

test('heading input rules preserve text typed or pasted after the marker', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>##### Human heading</p>'; document.body.append(surface)
  assert.equal(applyVisualInputRule(surface, selectTextNode(surface.firstElementChild, 19)), true)
  assert.equal(surface.innerHTML, '<h5>Human heading</h5>')
})

test('list and quote input rules create actual editable DOM blocks', () => {
  for (const [source, expected] of [['- ', '<ul><li><br></li></ul>'], ['1. ', '<ol><li><br></li></ol>'], ['> ', '<blockquote><br></blockquote>']]) {
    const surface = document.createElement('article'); const paragraph = document.createElement('p'); paragraph.textContent = source; surface.append(paragraph); document.body.append(surface)
    assert.equal(applyVisualInputRule(surface, selectTextNode(surface.firstElementChild, source.length)), true)
    assert.equal(surface.innerHTML, expected)
  }
})

test('typing a task marker inside a visual list creates a real checkbox', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>[ ] </li></ul>'; document.body.append(surface)
  assert.equal(applyVisualInputRule(surface, selectTextNode(surface.querySelector('li'), 4)), true)
  assert.equal(surface.innerHTML, '<ul><li><input type="checkbox" disabled=""> </li></ul>')
})

test('plain-text paste uses Range APIs and cannot inject markup', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>safe </p>'; document.body.append(surface)
  assert.equal(insertPlainText(surface, '<b>literal</b>', selectTextNode(surface.firstElementChild, 5)), true)
  assert.equal(surface.innerHTML, '<p>safe &lt;b&gt;literal&lt;/b&gt;</p>')
})

test('structured formatting uses Range and DOM operations', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>human text</p>'; document.body.append(surface)
  const range = document.createRange(); range.setStart(surface.querySelector('p').firstChild, 0); range.setEnd(surface.querySelector('p').firstChild, 5)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  assert.equal(wrapVisualSelection(surface, 'strong', {}, selection), true)
  assert.equal(surface.innerHTML, '<p><strong>human</strong> text</p>')
  assert.equal(formatVisualBlock(surface, 'h3', selection), true)
  assert.equal(surface.querySelector('h3').textContent, 'human text')
  assert.equal(toggleVisualList(surface, false, document.getSelection()), true)
  assert.equal(surface.innerHTML, '<ul><li><strong>human</strong> text</li></ul>')
})
