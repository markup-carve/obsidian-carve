import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, { document: window.document, Node: window.Node })
const { captureVisualSnapshot, restoreVisualSnapshot } = await import('../dist-test/visual-history.js')

test('visual history restores both DOM and caret position', () => {
  const surface = document.createElement('article'); surface.innerHTML = '<p>before</p>'; document.body.append(surface)
  const range = document.createRange(); range.setStart(surface.querySelector('p').firstChild, 3); range.collapse(true)
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  const snapshot = captureVisualSnapshot(surface, selection)
  surface.innerHTML = '<h1>after</h1>'
  assert.equal(restoreVisualSnapshot(surface, snapshot, selection), true)
  assert.equal(surface.innerHTML, '<p>before</p>')
  assert.equal(selection.anchorNode.textContent, 'before')
  assert.equal(selection.anchorOffset, 3)
})
