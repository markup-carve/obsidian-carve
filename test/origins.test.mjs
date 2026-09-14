import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, { document: window.document, Element: window.Element })
const { ORIGIN_ATTRIBUTE, isFolderRelativeDestination, claimRenderedOrigins } = await import('../dist-test/render.js')

const host = (html) => { const element = document.createElement('div'); element.innerHTML = html; return element }

test('a destination written relative to its own folder is recognized', () => {
  assert.equal(isFolderRelativeDestination('foo.crv'), true)
  assert.equal(isFolderRelativeDestination('sub/foo.crv'), true)
  assert.equal(isFolderRelativeDestination('./foo.crv'), true)
  assert.equal(isFolderRelativeDestination('../foo.crv'), true)
})

test('a destination that names its target without a folder is not', () => {
  assert.equal(isFolderRelativeDestination('https://example.com/a'), false)
  assert.equal(isFolderRelativeDestination('mailto:someone@example.com'), false)
  assert.equal(isFolderRelativeDestination('//example.com/a'), false)
  assert.equal(isFolderRelativeDestination('/Top.crv'), false)
  assert.equal(isFolderRelativeDestination('#section'), false)
  assert.equal(isFolderRelativeDestination(''), false)
})

test('a link in an embedded note is claimed by the embedded note', () => {
  const root = host('<p><a href="foo.crv">n</a></p>')
  claimRenderedOrigins(root, 'sub/note.crv')
  assert.equal(root.querySelector('a').getAttribute(ORIGIN_ATTRIBUTE), 'sub/note.crv')
})

test('an external link in an embedded note is left alone', () => {
  const root = host('<p><a href="https://example.com/a">n</a></p>')
  claimRenderedOrigins(root, 'sub/note.crv')
  assert.equal(root.querySelector('a').getAttribute(ORIGIN_ATTRIBUTE), null)
})

test('an origin the document wrote itself is dropped', () => {
  const root = host('<p><a href="foo.crv" data-carve-origin="elsewhere.crv">n</a></p>')
  claimRenderedOrigins(root, 'sub/note.crv')
  assert.equal(root.querySelector('a').getAttribute(ORIGIN_ATTRIBUTE), 'sub/note.crv')
})

test('an authored origin on a link no file claims is dropped too', () => {
  // A vault-root destination is never stamped, so nothing would overwrite an
  // authored value there; it has to be removed outright.
  const root = host('<p><a href="/Top.crv" data-carve-origin="elsewhere.crv">n</a></p>')
  claimRenderedOrigins(root, 'sub/note.crv')
  assert.equal(root.querySelector('a').getAttribute(ORIGIN_ATTRIBUTE), null)
})

test('a document with no file of its own carries no origin at all', () => {
  const root = host('<p><a href="foo.crv" data-carve-origin="elsewhere.crv">n</a></p>')
  claimRenderedOrigins(root, '')
  assert.equal(root.querySelector('a').getAttribute(ORIGIN_ATTRIBUTE), null)
})
