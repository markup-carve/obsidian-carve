import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { CARVE_CLIPBOARD_TYPE, carveClipboardPaste, carveClipboardPayload, pickPasteText, rebaseDirectives, writeCarveClipboard } from '../dist-test/clipboard.js'
import { flattenDocument } from '../dist-test/flatten.js'
import { expandForPreview } from '../dist-test/includes.js'

function vault(files) {
  const state = new Map(Object.entries(files))
  return {
    mtime: (path) => (state.has(path) ? 1 : null),
    read: async (path) => {
      if (!state.has(path)) throw new Error(`No such file: ${path}`)
      return state.get(path)
    },
  }
}

class FakeItem {
  constructor(items) { this.items = items; this.types = Object.keys(items) }
  async getType(type) {
    if (!(type in this.items)) throw new Error(`NotFoundError: ${type}`)
    return this.items[type]
  }
}

/**
 * The clipboard as Obsidian 1.13.7 measured it: an unprefixed custom type is
 * accepted by the constructor and refused asynchronously by `write`.
 */
function chromiumClipboard({ refuseWrite = false } = {}) {
  const board = {
    items: [],
    writes: [],
    texts: [],
    async write(items) {
      board.writes.push(items)
      await Promise.resolve()
      for (const item of items) {
        for (const type of item.types) {
          if (refuseWrite || (type !== 'text/plain' && !type.startsWith('web '))) throw new Error(`NotAllowedError: Type ${type} not supported on write`)
        }
      }
      board.items = items
    },
    async writeText(text) {
      board.texts.push(text)
      board.items = [new FakeItem({ 'text/plain': new Blob([text], { type: 'text/plain' }) })]
    },
    async read() { return board.items },
  }
  return board
}

const BOOK = {
  'book/root.crv': '# Root\n\n{{ sub/child.crv }}\n',
  'book/sub/child.crv': '## Child\n',
}

async function copyBook(clipboard, options = { rich: true, ClipboardItem: FakeItem }) {
  const gateway = vault(BOOK)
  const source = BOOK['book/root.crv']
  const flattened = await flattenDocument(source, { sourcePath: 'book/root.crv', gateway })
  const payload = carveClipboardPayload(source, 'book/root.crv', flattened.text)
  return { outcome: await writeCarveClipboard(clipboard, payload, options), flattened: flattened.text, gateway }
}

test('a relative directive is respelled from the vault root', () => {
  const { text, rebased } = rebaseDirectives('# Root\n\n{{ sub/child.crv }}\n', 'book/root.crv')
  assert.equal(text, '# Root\n\n{{ /book/sub/child.crv }}\n')
  assert.equal(rebased, 1)
})

test('rebasing keeps the section and options and normalizes dot segments', () => {
  const { text } = rebaseDirectives('{{ ../shared/part.crv #intro @shift:1 }}\n', 'book/sub/root.crv')
  assert.equal(text, '{{ /book/shared/part.crv #intro @shift:1 }}\n')
})

test('a path that needs quoting stays quoted', () => {
  const { text } = rebaseDirectives('{{ "my notes/a \\"b\\".crv" }}\n', 'book/root.crv')
  assert.equal(text, '{{ "/book/my notes/a \\"b\\".crv" }}\n')
})

test('root, escaping and non-live directives are left exactly as written', () => {
  const source = '{{ /already.crv }}\n\n{{ ../../out.crv }}\n\nWrite `{{ code.crv }}` here.\n'
  const { text, rebased } = rebaseDirectives(source, 'book/root.crv')
  assert.equal(text, source)
  assert.equal(rebased, 0)
})

test('the flattened document goes on text/plain and the Carve flavor carries the author document', async () => {
  const clipboard = chromiumClipboard()
  const { outcome, flattened } = await copyBook(clipboard)
  assert.equal(outcome, 'carve')
  const [item] = clipboard.items
  assert.deepEqual(item.types.sort(), ['text/plain', 'web text/x-carve'])
  const plain = await (await item.getType('text/plain')).text()
  assert.equal(plain, flattened)
  assert.doesNotMatch(plain, /\{\{/, 'a foreign editor must not receive directives')
  assert.equal(await (await item.getType(CARVE_CLIPBOARD_TYPE)).text(), '# Root\n\n{{ /book/sub/child.crv }}\n')
})

test('the Carve type is the ruled web custom format name', () => {
  assert.equal(CARVE_CLIPBOARD_TYPE, 'web text/x-carve')
})

test('a write refused after construction falls back to the flattened text', async () => {
  const clipboard = chromiumClipboard({ refuseWrite: true })
  const { outcome, flattened } = await copyBook(clipboard)
  assert.equal(outcome, 'plain')
  assert.deepEqual(clipboard.texts, [flattened])
})

test('mobile writes the flattened text without attempting the Carve flavor', async () => {
  const clipboard = chromiumClipboard()
  const { outcome, flattened } = await copyBook(clipboard, { rich: false, ClipboardItem: FakeItem })
  assert.equal(outcome, 'plain')
  assert.equal(clipboard.writes.length, 0)
  assert.deepEqual(clipboard.texts, [flattened])
})

test('a clipboard that refuses both writes surfaces the failure', async () => {
  const clipboard = chromiumClipboard({ refuseWrite: true })
  clipboard.writeText = async () => { await Promise.resolve(); throw new Error('NotAllowedError') }
  await assert.rejects(copyBook(clipboard), /NotAllowedError/)
})

test('a paste into another folder still includes the same file', async () => {
  const clipboard = chromiumClipboard()
  const { flattened, gateway } = await copyBook(clipboard)
  const pasted = await pickPasteText(await clipboard.read(), flattened)
  const expansion = await expandForPreview(pasted, { sourcePath: 'notes/scratch.crv', gateway })
  assert.deepEqual(expansion.diagnostics, [])
  assert.deepEqual(expansion.resolvedPaths, ['book/sub/child.crv'])
})

test('a Carve flavor whose plain half is not the pasted text is ignored', async () => {
  const item = new FakeItem({
    'text/plain': new Blob(['other'], { type: 'text/plain' }),
    [CARVE_CLIPBOARD_TYPE]: new Blob(['{{ /x.crv }}'], { type: CARVE_CLIPBOARD_TYPE }),
  })
  assert.equal(await pickPasteText([item], 'pasted'), 'pasted')
})

test('Windows line breaks on the plain half still match', async () => {
  const item = new FakeItem({
    'text/plain': new Blob(['a\r\nb'], { type: 'text/plain' }),
    [CARVE_CLIPBOARD_TYPE]: new Blob(['carve'], { type: CARVE_CLIPBOARD_TYPE }),
  })
  assert.equal(await pickPasteText([item], 'a\nb'), 'carve')
})

async function editorPaste(clipboard, plain) {
  const window = new Window()
  const saved = {}
  for (const name of ['window', 'document', 'navigator', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'Node', 'HTMLElement']) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true, writable: true })
  }
  try {
    const { EditorView } = await import('@codemirror/view')
    const { EditorState } = await import('@codemirror/state')
    const parent = window.document.createElement('div')
    window.document.body.appendChild(parent)
    const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: [carveClipboardPaste(() => clipboard)] }) })
    const data = new window.DataTransfer()
    data.setData('text/plain', plain)
    view.contentDOM.dispatchEvent(new window.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    for (let i = 0; i < 20 && view.state.doc.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    const doc = view.state.doc.toString()
    view.destroy()
    return doc
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    await window.happyDOM.close()
  }
}

test('pasting into the source editor inserts the Carve flavor', async () => {
  const clipboard = chromiumClipboard()
  const { flattened } = await copyBook(clipboard)
  assert.equal(await editorPaste(clipboard, flattened), '# Root\n\n{{ /book/sub/child.crv }}\n')
})

test('pasting plain text from elsewhere inserts that text', async () => {
  const clipboard = chromiumClipboard()
  await clipboard.writeText('from a browser')
  assert.equal(await editorPaste(clipboard, 'from a browser'), 'from a browser')
})

test('an empty flattened document still pastes its Carve flavor', async () => {
  const clipboard = chromiumClipboard()
  await writeCarveClipboard(clipboard, { plain: '', carve: '{{ /empty.crv }}\n' }, { rich: true, ClipboardItem: FakeItem })
  assert.equal(await editorPaste(clipboard, ''), '{{ /empty.crv }}\n')
})
