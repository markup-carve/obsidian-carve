import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, { document: window.document, Element: window.Element, HTMLLIElement: window.HTMLLIElement, HTMLInputElement: window.HTMLInputElement })
const { toggleVisualList } = await import('../dist-test/visual-editing.js')

function leaveList(block) {
  const surface = document.createElement('article')
  surface.innerHTML = `<ul><li>lead${block}</li><li>next</li></ul>`
  document.body.append(surface)
  const range = document.createRange()
  range.setStart(surface.querySelector('li').firstChild, 2)
  range.collapse(true)
  const selection = document.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  assert.equal(toggleVisualList(surface, false), true)
  return surface
}

for (const tag of ['details', 'aside', 'section', 'figure', 'dl']) {
  test(`leaving a list keeps ${tag} outside the new paragraph`, () => {
    const block = tag === 'details' ? '<details><summary>Q</summary><p>A</p></details>' : `<${tag}><p>A</p></${tag}>`
    const surface = leaveList(block)
    assert.equal(surface.children[0].tagName, 'P')
    assert.equal(surface.children[0].textContent, 'lead')
    assert.equal(surface.children[1].tagName, tag.toUpperCase())
    assert.equal(surface.children[2].tagName, 'UL')
    assert.equal(surface.querySelector('p details, p aside, p section, p figure, p dl'), null)
  })
}

test('inline opaque content stays inside the paragraph', () => {
  const surface = leaveList('<carve-opaque class="is-inline">widget</carve-opaque>')
  assert.equal(surface.children[0].innerHTML, 'lead<carve-opaque class="is-inline">widget</carve-opaque>')
})
