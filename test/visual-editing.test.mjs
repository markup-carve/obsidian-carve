import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, { document: window.document, Element: window.Element, HTMLLIElement: window.HTMLLIElement, HTMLInputElement: window.HTMLInputElement })
const { applyVisualInputRule, backspaceVisualListItem, continueVisualList, formatVisualBlock, indentVisualListItem, insertFormattedText, insertPlainText, insertSanitizedHtml, insertVisualLink, toggleVisualList, toggleVisualTask, toggleVisualTaskAtSelection, wrapVisualSelection } = await import('../dist-test/visual-editing.js')
const { visualHtmlToSource } = await import('../dist-test/wysiwyg.js')

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

test('horizontal-rule and code-fence input rules create visual blocks', () => {
  for (const [source, expected] of [['--- ', '<hr><p><br></p>'], ['``` ', '<pre><br></pre>']]) {
    const surface = document.createElement('article'); const paragraph = document.createElement('p'); paragraph.textContent = source; surface.append(paragraph); document.body.append(surface)
    assert.equal(applyVisualInputRule(surface, selectTextNode(paragraph, source.length)), true)
    assert.equal(surface.innerHTML, expected)
  }
})

test('typing a task marker inside a visual list creates a real checkbox', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>[ ] </li></ul>'; document.body.append(surface)
  assert.equal(applyVisualInputRule(surface, selectTextNode(surface.querySelector('li'), 4)), true)
  assert.equal(surface.innerHTML, '<ul><li><input type="checkbox" aria-label="Toggle task"> </li></ul>')
})

test('plain-text paste uses Range APIs and cannot inject markup', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>safe </p>'; document.body.append(surface)
  assert.equal(insertPlainText(surface, '<b>literal</b>', selectTextNode(surface.firstElementChild, 5)), true)
  assert.equal(surface.innerHTML, '<p>safe &lt;b&gt;literal&lt;/b&gt;</p>')
})

test('collapsed-caret formatting applies to subsequently typed text', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>say </p>'; document.body.append(surface)
  assert.equal(insertFormattedText(surface, 'hello', ['strong', 'em'], selectTextNode(surface.querySelector('p'), 4)), true)
  assert.equal(surface.innerHTML, '<p>say <em><strong>hello</strong></em></p>')
})

test('links can be inserted at a collapsed caret without a dummy selection', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>See </p>'; document.body.append(surface)
  assert.equal(insertVisualLink(surface, 'https://example.com', 'Example', selectTextNode(surface.querySelector('p'), 4)), true)
  assert.equal(surface.innerHTML, '<p>See <a href="https://example.com">Example</a></p>')
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

test('Tab and Shift+Tab nest and unnest visual list items', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>one</li><li>two</li></ul>'; document.body.append(surface)
  const second = surface.querySelectorAll('li')[1]
  const selection = selectTextNode(second, 1)
  assert.equal(indentVisualListItem(surface, false, selection), true)
  assert.equal(surface.innerHTML, '<ul><li>one<ul><li>two</li></ul></li></ul>')
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- one\n  - two\n')
  assert.equal(indentVisualListItem(surface, true, document.getSelection()), true)
  assert.equal(surface.innerHTML, '<ul><li>one</li><li>two</li></ul>')
})

test('list conversion preserves every sibling and changes list kind structurally', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>one</li><li>two</li><li>three</li></ul>'; document.body.append(surface)
  selectTextNode(surface.querySelectorAll('li')[1], 1)
  assert.equal(toggleVisualList(surface, false), true)
  assert.equal(surface.innerHTML, '<ul><li>one</li></ul><p>two</p><ul><li>three</li></ul>')
  selectTextNode(surface.querySelector('li'), 1)
  assert.equal(toggleVisualList(surface, true), true)
  assert.equal(surface.innerHTML, '<ol><li>one</li></ol><p>two</p><ul><li>three</li></ul>')
})

test('Enter splits a visual list item at the caret', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>first second</li></ul>'; document.body.append(surface)
  selectTextNode(surface.querySelector('li'), 6)
  assert.equal(continueVisualList(surface), true)
  assert.equal(surface.innerHTML, '<ul><li>first </li><li>second</li></ul>')
})

test('visual task checkboxes are interactive and serialize their state', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li><input type="checkbox" aria-label="Toggle task"> task</li></ul>'; document.body.append(surface)
  const checkbox = surface.querySelector('input'); checkbox.checked = true
  assert.equal(toggleVisualTask(surface, checkbox), true)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [x] task\n')
})

test('task toolbar converts prose and toggles an existing task without syntax', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>do this</p>'; document.body.append(surface)
  selectTextNode(surface.querySelector('p'), 2)
  assert.equal(toggleVisualTaskAtSelection(surface), true)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [ ] do this\n')
  assert.equal(toggleVisualTaskAtSelection(surface), true)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [x] do this\n')
})

test('Backspace joins a top-level list item and outdents a nested item', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>one</li><li>two</li></ul>'; document.body.append(surface)
  placeSelection(surface.querySelectorAll('li')[1])
  assert.equal(backspaceVisualListItem(surface), true)
  assert.equal(surface.innerHTML, '<ul><li>onetwo</li></ul>')
  surface.innerHTML = '<ul><li>one<ul><li>two</li></ul></li></ul>'; placeSelection(surface.querySelectorAll('li')[1])
  assert.equal(backspaceVisualListItem(surface), true)
  assert.equal(surface.innerHTML, '<ul><li>one</li><li>two</li></ul>')
})

test('rich paste is allowlisted and strips executable or presentation markup', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>start </p>'; document.body.append(surface)
  assert.equal(insertSanitizedHtml(surface, '<strong style="color:red">safe</strong><script>alert(1)</script><a href="javascript:x">link</a>', selectTextNode(surface.querySelector('p'), 6)), true)
  assert.equal(surface.innerHTML, '<p>start <strong>safe</strong>alert(1)<a>link</a></p>')
})

test('Enter continues normal and task lists and exits an empty list item', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li><input type="checkbox"> task</li></ul>'; document.body.append(surface)
  placeSelectionEnd(surface.querySelector('li'))
  assert.equal(continueVisualList(surface), true)
  assert.match(surface.innerHTML, /<li><input type="checkbox" aria-label="Toggle task"> <br><\/li>/)
  const empty = surface.querySelectorAll('li')[1]; placeSelection(empty)
  assert.equal(continueVisualList(surface), true)
  assert.equal(surface.innerHTML, '<ul><li><input type="checkbox"> task</li></ul><p><br></p>')
})

function placeSelection(element) {
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(true)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection
}
function placeSelectionEnd(element) {
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection
}
