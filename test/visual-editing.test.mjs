import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, { document: window.document, Element: window.Element, HTMLLIElement: window.HTMLLIElement, HTMLInputElement: window.HTMLInputElement })
const { applyVisualInputRule, backspaceVisualListItem, normalizeVisualTaskCaret, visualTaskCaretKey, continueVisualList, formatVisualBlock, indentVisualListItem, insertFormattedText, insertPlainText, insertSanitizedHtml, insertVisualLink, toggleVisualList, toggleVisualTask, toggleVisualTaskAtSelection, wrapVisualSelection } = await import('../dist-test/visual-editing.js')
const { sourceToVisualDocument, visualHtmlToSource } = await import('../dist-test/wysiwyg.js')
const { carveToHtml } = await import('@markup-carve/carve')

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
  assert.equal(insertFormattedText(surface, '!', ['strong', 'em'], document.getSelection()), true)
  assert.equal(surface.innerHTML, '<p>say <em><strong>hello!</strong></em></p>')
})

test('links can be inserted at a collapsed caret without a dummy selection', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>See </p>'; document.body.append(surface)
  assert.equal(insertVisualLink(surface, 'https://example.com', 'Example', selectTextNode(surface.querySelector('p'), 4)), true)
  assert.equal(surface.innerHTML, '<p>See <a href="https://example.com">Example</a></p>')
  assert.equal(insertVisualLink(surface, 'javascript:alert(1)', 'unsafe', document.getSelection()), false)
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

test('multi-block formatting preserves a useful selection across transformed blocks', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>one</p><p>two</p>'; document.body.append(surface)
  const range = document.createRange(); range.setStart(surface.firstElementChild.firstChild, 0); range.setEnd(surface.lastElementChild.firstChild, 3)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  assert.equal(formatVisualBlock(surface, 'blockquote', selection), true)
  assert.equal(surface.innerHTML, '<blockquote>one</blockquote><blockquote>two</blockquote>')
  assert.equal(selection.toString(), 'onetwo')
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

test('leaving a parent list item preserves and outdents its nested children', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>parent<ul><li>child</li></ul></li><li>after</li></ul>'; document.body.append(surface)
  selectTextNode(surface.querySelector('li'), 2)
  assert.equal(toggleVisualList(surface, false), true)
  assert.equal(surface.innerHTML, '<p>parent</p><ul><li>child</li><li>after</li></ul>')
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

test('seeded task checkboxes are clickable and a toggle drops the extended state', () => {
  const visual = sourceToVisualDocument('- [ ] Draft\n- [x] Done\n- [>] Ship\n')
  assert.doesNotMatch(visual.html, /disabled/)
  assert.equal(visualHtmlToSource(visual.html).source, '- [ ] Draft\n- [x] Done\n- [>] Ship\n')
  const surface = document.createElement('article'); surface.innerHTML = visual.html; document.body.append(surface)
  surface.addEventListener('change', (event) => toggleVisualTask(surface, event.target))
  const ship = surface.querySelectorAll('input')[2]
  ship.click()
  assert.equal(ship.checked, true)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [ ] Draft\n- [x] Done\n- [x] Ship\n')
  ship.click()
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [ ] Draft\n- [x] Done\n- [ ] Ship\n')
})

test('task toolbar toggle also drops the extended state', () => {
  const surface = document.createElement('article'); surface.innerHTML = sourceToVisualDocument('- [?] Ship\n').html; document.body.append(surface)
  placeSelectionEnd(surface.querySelector('li'))
  assert.equal(toggleVisualTaskAtSelection(surface), true)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [x] Ship\n')
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

test('rich paste retains safe relative vault links', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p><br></p>'; document.body.append(surface); placeSelection(surface.querySelector('p'))
  assert.equal(insertSanitizedHtml(surface, '<a href="notes/Guide.crv">Guide</a>', document.getSelection()), true)
  assert.match(surface.innerHTML, /href="notes\/Guide\.crv"/)
})

test('Enter continues normal and task lists and exits an empty list item', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li><input type="checkbox"> task</li></ul>'; document.body.append(surface)
  placeSelectionEnd(surface.querySelector('li'))
  assert.equal(continueVisualList(surface), true)
  assert.match(surface.innerHTML, /<li><input type="checkbox" aria-label="Toggle task"> <br data-carve-placeholder=""><\/li>/)
  const empty = surface.querySelectorAll('li')[1]; placeSelection(empty)
  assert.equal(continueVisualList(surface), true)
  assert.equal(surface.innerHTML, '<ul><li><input type="checkbox"> task</li></ul><p><br></p>')
})

function caretIn(element, offset) {
  const range = document.createRange(); range.setStart(element, offset); range.collapse(true)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection
}

test('Enter after a seeded task gives a new checkbox item; typing lands after the box', () => {
  const visual = sourceToVisualDocument('- [x] done\n')
  const surface = document.createElement('article'); surface.innerHTML = visual.html; document.body.append(surface)
  const first = surface.querySelector('li'); caretIn(first.lastChild, first.lastChild.textContent.length)
  assert.equal(continueVisualList(surface), true)
  const next = surface.querySelectorAll('li')[1]
  assert.equal(next.firstChild.tagName, 'INPUT')
  assert.equal(next.firstChild.checked, false)
  assert.doesNotMatch(next.textContent, /\[/)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [x] done\n- [ ] \n')
  assert.equal(insertPlainText(surface, 'a', document.getSelection()), true)
  assert.equal(next.firstChild.tagName, 'INPUT', 'the box stays first')
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [x] done\n- [ ] a\n')
})

test('Enter in the middle of a task moves the tail after the new box and puts the caret before it', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li><input type="checkbox"> abcd</li></ul>'; document.body.append(surface)
  caretIn(surface.querySelector('li').lastChild, 3)
  assert.equal(continueVisualList(surface), true)
  insertPlainText(surface, 'X', document.getSelection())
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [ ] ab\n- [ ] Xcd\n')
})

test('Enter in the middle of a plain item puts the caret at the start of the moved text', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>abcd</li></ul>'; document.body.append(surface)
  caretIn(surface.querySelector('li').firstChild, 2)
  assert.equal(continueVisualList(surface), true)
  insertPlainText(surface, 'X', document.getSelection())
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- ab\n- Xcd\n')
})

test('turning an item into a task keeps the caret where it was', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<ul><li>abc</li></ul>'; document.body.append(surface)
  caretIn(surface.querySelector('li').firstChild, 2)
  assert.equal(toggleVisualTaskAtSelection(surface), true)
  insertPlainText(surface, 'X', document.getSelection())
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [ ] abXc\n')
})

test('a content-less task box in the source opens as a checkbox in the visual editor', () => {
  const source = '- [x] done\n- [ ] \n'
  const visual = sourceToVisualDocument(source)
  const surface = document.createElement('article'); surface.innerHTML = visual.html; document.body.append(surface)
  const items = Array.from(surface.querySelectorAll('li'))
  assert.deepEqual(items.map((item) => [item.firstElementChild?.tagName, item.querySelector('input')?.checked, item.textContent.trim()]), [['INPUT', true, 'done'], ['INPUT', false, '']])
  assert.equal(visual.semanticLoss, false)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, source)
  for (const [pending, checked] of [['* [x] \n', true], ['- [>]\n', false]]) {
    const seeded = sourceToVisualDocument(pending).html
    // Through the DOM, where `data-task-state=">"` is serialized with a raw `>`.
    const host = document.createElement('article'); host.innerHTML = seeded
    assert.equal(visualHtmlToSource(host.innerHTML).source, pending.replace(/^\* /, '- ').replace(/\]\n$/, '] \n'), pending)
    assert.match(seeded, /<input type="checkbox"/, pending)
    assert.doesNotMatch(seeded, /\[[x>]\]|CARVEPENDING/, pending)
    assert.equal(/checked/.test(seeded), checked, pending)
  }
  // A later paragraph makes `[ ]` ordinary item text, as the engine reads it.
  const loose = sourceToVisualDocument('- [ ]\n\n  paragraph\n')
  assert.doesNotMatch(loose.html, /<input|CARVEPENDING/)
  assert.doesNotMatch(visualHtmlToSource(loose.html).source, /CARVE/)
  // Escaped brackets are text, not a box.
  assert.doesNotMatch(sourceToVisualDocument('- \\[ \\]\n').html, /<input/)
})

function placeSelection(element) {
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(true)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection
}
function placeSelectionEnd(element) {
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection
}

function taskSurface(source) {
  const surface = document.createElement('article'); surface.innerHTML = sourceToVisualDocument(source).html; document.body.append(surface)
  return surface
}
function caretAt(node, offset) {
  const range = document.createRange(); range.setStart(node, offset); range.collapse(true)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection
}
const caret = () => { const selection = document.getSelection(); return [selection.anchorNode, selection.anchorOffset] }

test('Backspace at a task text removes box and bullet; the text becomes a paragraph where the item stood', () => {
  for (const [label, place] of [['after the space', (li) => [li.childNodes[1], 1]], ['before the space', (li) => [li.childNodes[1], 0]], ['before the box', (li) => [li, 0]]]) {
    const surface = taskSurface('- [ ] alpha\n- [ ] beta\n- [ ] gamma\n')
    const beta = surface.querySelectorAll('li')[1]
    assert.equal(backspaceVisualListItem(surface, caretAt(...place(beta))), true, label)
    const source = visualHtmlToSource(surface.innerHTML).source
    assert.equal(source, '- [ ] alpha\n\nbeta\n\n- [ ] gamma\n', label)
    // The engine reads it as a paragraph between two lists, not as part of `alpha`.
    assert.match(carveToHtml(source), /<\/ul>\n<p>beta<\/p>\n<ul>/, label)
    const [node, offset] = caret()
    assert.equal(node.nodeName === 'P' ? node.textContent : node.parentElement.textContent, 'beta', label)
    assert.equal(offset, 0, `${label}: the caret stays at the text start`)
  }
})

test('Backspace on the first task of a list does not merge it into the block above', () => {
  const surface = taskSurface('Intro\n\n- [x] alpha\n- [ ] beta\n')
  const alpha = surface.querySelector('li')
  assert.equal(backspaceVisualListItem(surface, caretAt(alpha.childNodes[1], 1)), true)
  const source = visualHtmlToSource(surface.innerHTML).source
  assert.equal(source, 'Intro\n\nalpha\n\n- [ ] beta\n')
  assert.match(carveToHtml(source), /<p>Intro<\/p>\n<p>alpha<\/p>/)
})

test('Backspace on a nested task leaves a paragraph inside the parent item', () => {
  const surface = taskSurface('- a\n\n  - [ ] child\n')
  const child = surface.querySelectorAll('li')[1]
  assert.equal(backspaceVisualListItem(surface, caretAt(child.childNodes[1], 1)), true)
  const source = visualHtmlToSource(surface.innerHTML).source
  assert.match(carveToHtml(source), /<li>\s*<p>a<\/p>\s*<p>child<\/p>\s*<\/li>/, source)
})

test('Backspace on an empty task ends the list, as Enter does', () => {
  const surface = taskSurface('- [ ] a\n- [ ] \n')
  const empty = surface.querySelectorAll('li')[1]
  assert.equal(backspaceVisualListItem(surface, caretAt(empty, empty.childNodes.length)), true)
  assert.equal(surface.querySelectorAll('li').length, 1)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [ ] a\n')
  assert.equal(caret()[0].nodeName, 'P', 'the caret stays on that line, now a paragraph')
})

test('a caret on or left of a task box moves to where the text starts', () => {
  const surface = taskSurface('- [ ] alpha\n- [ ] beta\n')
  const beta = surface.querySelectorAll('li')[1]
  for (const [node, offset] of [[beta, 0], [beta, 1], [beta.childNodes[1], 0]]) {
    assert.equal(normalizeVisualTaskCaret(surface, caretAt(node, offset)), true)
    assert.deepEqual(caret(), [beta.childNodes[1], 1])
  }
  assert.equal(normalizeVisualTaskCaret(surface, caretAt(beta.childNodes[1], 1)), false, 'already after the box')
  assert.equal(normalizeVisualTaskCaret(surface, caretAt(beta.childNodes[1], 3)), false, 'inside the text')
  const plain = taskSurface('- plain\n').querySelector('li')
  assert.equal(normalizeVisualTaskCaret(plain.closest('article'), caretAt(plain.firstChild, 0)), false, 'a plain item has no box')
})

test('Home goes to the task text; ArrowLeft from there goes to the line above', () => {
  const surface = taskSurface('- [ ] alpha\n- [ ] beta\n')
  const [alpha, beta] = surface.querySelectorAll('li')
  assert.equal(visualTaskCaretKey(surface, 'Home', caretAt(beta.childNodes[1], 3)), true)
  assert.deepEqual(caret(), [beta.childNodes[1], 1])
  assert.equal(visualTaskCaretKey(surface, 'ArrowLeft'), true)
  assert.deepEqual(caret(), [alpha.childNodes[1], ' alpha'.length])
  assert.equal(visualTaskCaretKey(surface, 'ArrowLeft', caretAt(beta.childNodes[1], 3)), false, 'inside the text the browser moves')
  assert.equal(visualTaskCaretKey(surface, 'ArrowLeft', caretAt(alpha.childNodes[1], 1)), true, 'nothing above: stay after the box')
  assert.deepEqual(caret(), [alpha.childNodes[1], 1])
})

test('an empty task with nested items keeps them when Backspace or Enter ends it', () => {
  for (const command of [backspaceVisualListItem, continueVisualList]) {
    const surface = taskSurface('- [ ] \n\n  - child\n')
    const parent = surface.querySelector('li')
    assert.equal(command(surface, caretAt(parent, 1)), true, command.name)
    assert.match(visualHtmlToSource(surface.innerHTML).source, /^- child\n$/m, command.name)
  }
})

test('the start of formatted task text counts as the task text start', () => {
  const surface = taskSurface('- [ ] alpha\n- [ ] *bold* text\n')
  const [alpha, bold] = surface.querySelectorAll('li')
  const inside = bold.querySelector('strong').firstChild
  assert.equal(normalizeVisualTaskCaret(surface, caretAt(inside, 0)), false, 'typing there stays bold')
  assert.equal(visualTaskCaretKey(surface, 'ArrowLeft', caretAt(inside, 0)), true)
  assert.deepEqual(caret(), [alpha.childNodes[1], ' alpha'.length])
  assert.equal(backspaceVisualListItem(surface, caretAt(inside, 0)), true)
  assert.equal(visualHtmlToSource(surface.innerHTML).source, '- [ ] alpha\n\n*bold* text\n')
})

test('an image in a task is content: Backspace after it is left to the browser', () => {
  const surface = document.createElement('article'); document.body.append(surface)
  surface.innerHTML = '<ul><li><input type="checkbox"> <img src="a.png" alt="a"></li><li><input type="checkbox"> <img src="b.png" alt="b">text</li></ul>'
  const [only, mixed] = surface.querySelectorAll('li')
  assert.equal(backspaceVisualListItem(surface, caretAt(only, only.childNodes.length)), false, 'an image-only task is not empty')
  assert.ok(surface.querySelector('img[alt="a"]'))
  assert.equal(backspaceVisualListItem(surface, caretAt(mixed, 3)), false, 'after the image')
  assert.equal(visualTaskCaretKey(surface, 'ArrowLeft', caretAt(mixed, 3)), false)
  assert.ok(mixed.querySelector('input'))
})

test('ending an empty task in the middle of a list keeps the document order', () => {
  for (const command of [backspaceVisualListItem, continueVisualList]) {
    const surface = taskSurface('- [ ] a\n- [ ] \n\n  - child\n- [ ] b\n')
    const empty = surface.querySelectorAll('li')[1]
    assert.equal(command(surface, caretAt(empty, 1)), true, command.name)
    const source = visualHtmlToSource(surface.innerHTML).source
    assert.ok(source.indexOf('child') < source.indexOf('b\n'), `${command.name}: ${JSON.stringify(source)}`)
    assert.ok(source.indexOf('- [ ] a') < source.indexOf('child'))
    assert.equal(caret()[0].nodeName, 'P', 'the caret stays where the item was')
    assert.equal(caret()[0].nextElementSibling?.querySelector('li')?.textContent, 'child')
  }
})
