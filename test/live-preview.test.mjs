import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { LIVE_PREVIEW_IDLE_MS, createCarveLivePreview, livePresentations, livePreviewDelay, taskToggle } from '../dist-test/live-preview.js'

test('typed ### heading becomes an H3 presentation outside the cursor', () => {
  assert.deepEqual(livePresentations('### Human heading', [{ from: 17, to: 17 }]), [
    { kind: 'heading', from: 0, to: 17, level: 3 },
    { kind: 'hide', from: 0, to: 4 },
  ])
})

test('heading marker is revealed under the cursor but the heading keeps its size', () => {
  assert.deepEqual(livePresentations('### Human heading', [{ from: 6, to: 6 }]), [
    { kind: 'heading', from: 0, to: 17, level: 3 },
  ])
  assert.deepEqual(livePresentations('### Human heading', [{ from: 0, to: 0 }]), [
    { kind: 'heading', from: 0, to: 17, level: 3 },
  ])
})

test('list items and table rows keep their line styling under the cursor', () => {
  assert.deepEqual(livePresentations('- item', [{ from: 4, to: 4 }]), [
    { kind: 'line', at: 0, className: 'carve-live-list-item' },
  ])
  const table = livePresentations('|= A |= B |\n| x | y |', [{ from: 14, to: 14 }])
  assert.equal(table.filter((item) => item.kind === 'line' && item.className === 'carve-live-table-row').length, 2)
  assert.equal(table.filter((item) => item.kind === 'mark' && item.className === 'carve-live-table-cell').length, 0)
})

test('inline markers hide and semantic styling remains', () => {
  assert.deepEqual(livePresentations('A *strong* choice', [{ from: 17, to: 17 }]), [
    { kind: 'hide', from: 2, to: 3 },
    { kind: 'mark', from: 3, to: 9, className: 'carve-live-strong' },
    { kind: 'hide', from: 9, to: 10 },
  ])
})

test('Unicode before markup still maps to CodeMirror UTF-16 offsets', () => {
  assert.deepEqual(livePresentations('😀 /human/', [{ from: 10, to: 10 }]), [
    { kind: 'hide', from: 3, to: 4 },
    { kind: 'mark', from: 4, to: 9, className: 'carve-live-emphasis' },
    { kind: 'hide', from: 9, to: 10 },
  ])
})

test('list and task syntax becomes visible semantic markers', () => {
  assert.deepEqual(livePresentations('- item', [{ from: 6, to: 6 }]).slice(1), [
    { kind: 'widget', at: 0, label: '•', className: 'carve-live-list-marker' },
    { kind: 'hide', from: 0, to: 2 },
  ])
  assert.deepEqual(livePresentations('- [x] done', [{ from: 10, to: 10 }]).slice(1), [
    { kind: 'task', at: 0, state: 'x' },
    { kind: 'hide', from: 0, to: 6 },
    { kind: 'mark', from: 6, to: 10, className: 'carve-live-task-done' },
  ])
  assert.deepEqual(livePresentations('- [ ] open', [{ from: 10, to: 10 }]).slice(1), [
    { kind: 'task', at: 0, state: ' ' },
    { kind: 'hide', from: 0, to: 6 },
  ])
  assert.deepEqual(livePresentations('- [-] dropped', [{ from: 13, to: 13 }]).slice(1), [
    { kind: 'task', at: 0, state: '-' },
    { kind: 'hide', from: 0, to: 6 },
    { kind: 'mark', from: 6, to: 13, className: 'carve-live-task-cancelled' },
  ])
  assert.deepEqual(livePresentations('- [>] later', [{ from: 11, to: 11 }]).slice(1), [
    { kind: 'task', at: 0, state: '>' },
    { kind: 'hide', from: 0, to: 6 },
  ])
})

test('a checked parent strikes only its own paragraph, not the nested items', () => {
  const source = '- [x] parent\n\n  - [ ] child\n'
  const marks = livePresentations(source, [{ from: source.length, to: source.length }]).filter((item) => item.kind === 'mark')
  assert.deepEqual(marks, [{ kind: 'mark', from: 6, to: 12, className: 'carve-live-task-done' }])
})

test('a task keeps its checkbox on the cursor line and reveals the marker only at the box', () => {
  const full = [
    { kind: 'line', at: 0, className: 'carve-live-list-item' },
    { kind: 'task', at: 0, state: 'x' },
    { kind: 'hide', from: 0, to: 6 },
    { kind: 'mark', from: 6, to: 10, className: 'carve-live-task-done' },
  ]
  for (const at of [6, 8, 10]) assert.deepEqual(livePresentations('- [x] done', [{ from: at, to: at }]), full, `caret at ${at}`)
  for (const at of [0, 2, 3, 4, 5]) {
    assert.deepEqual(livePresentations('- [x] done', [{ from: at, to: at }]), [{ kind: 'line', at: 0, className: 'carve-live-list-item' }], `caret at ${at}`)
  }
  assert.deepEqual(livePresentations('- [x] done', [{ from: 4, to: 8 }]), [{ kind: 'line', at: 0, className: 'carve-live-list-item' }])
})

test('a bullet with only a task box, as Enter leaves it, draws a checkbox, not brackets', () => {
  // The engine reads a content-less box as a plain item whose text is `[ ]`.
  const source = '- [x] done\n- [ ] '
  const end = source.length
  const pending = livePresentations(source, [{ from: end, to: end }]).filter((item) => (item.at ?? item.from) >= 11)
  assert.deepEqual(pending, [
    { kind: 'line', at: 11, className: 'carve-live-list-item' },
    { kind: 'task', at: 11, state: ' ' },
    { kind: 'hide', from: 11, to: 17 },
  ])
  assert.equal(pending.some((item) => item.kind === 'widget'), false, 'no bullet glyph in front of the box')
  for (const [text, state, hideTo] of [['* [x] ', 'x', 6], ['- [>]', '>', 5], ['- [_]  ', '_', 7], ['- [?] ', '?', 6], ['- [-] ', '-', 6], ['- [X] ', 'X', 6]]) {
    // With no caret on the line; `- [>]` with the caret after `]` touches the box.
    assert.deepEqual(livePresentations(text, []), [
      { kind: 'line', at: 0, className: 'carve-live-list-item' },
      { kind: 'task', at: 0, state },
      { kind: 'hide', from: 0, to: hideTo },
    ], JSON.stringify(text))
  }
  // The caret on the box itself reveals the raw marker.
  assert.deepEqual(livePresentations('- [ ] ', [{ from: 4, to: 4 }]), [{ kind: 'line', at: 0, className: 'carve-live-list-item' }])
  assert.deepEqual(livePresentations('- [ ] ', [{ from: 5, to: 5 }]), [{ kind: 'line', at: 0, className: 'carve-live-list-item' }])
  // Not a box: escaped brackets, an unknown state, a box after other text, an ordered item.
  for (const text of ['- \\[ \\] ', '- [y] ', '- a [ ] ', '1. [ ] ']) {
    assert.equal(livePresentations(text, [{ from: text.length, to: text.length }]).some((item) => item.kind === 'task'), false, JSON.stringify(text))
  }
})

test('a content-less box above a nested list still draws a checkbox', () => {
  const source = '- [>] \n  - nested'
  const parent = livePresentations(source, [{ from: source.length, to: source.length }]).filter((item) => (item.at ?? item.from) < 7)
  assert.deepEqual(parent, [
    { kind: 'line', at: 0, className: 'carve-live-list-item' },
    { kind: 'task', at: 0, state: '>' },
    { kind: 'hide', from: 0, to: 6 },
  ])
})

test('taskToggle toggles a content-less box too', () => {
  assert.deepEqual(taskToggle('- [ ] ', 0), { from: 3, to: 4, insert: 'x' })
  assert.deepEqual(taskToggle('* [x]', 0), { from: 3, to: 4, insert: ' ' })
})

test('taskToggle checks an open or extended task and unchecks a done one', () => {
  assert.deepEqual(taskToggle('- [ ] a', 0), { from: 3, to: 4, insert: 'x' })
  assert.deepEqual(taskToggle('- [X] a', 0), { from: 3, to: 4, insert: ' ' })
  assert.deepEqual(taskToggle('x\n  * [>] a', 4), { from: 7, to: 8, insert: 'x' })
  assert.equal(taskToggle('- plain', 0), null)
})

test('the source-view task widget is a checkbox that toggles the marker on click', async () => {
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
    const doc = 'top\n\n- [ ] open\n- [x] done\n- [>] later\n'
    const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [createCarveLivePreview()] }) })
    const boxes = async () => {
      for (let i = 0; i < 60 && !parent.querySelector('.carve-live-task-checkbox'); i++) await new Promise((resolve) => setTimeout(resolve, 10))
      return Array.from(parent.querySelectorAll('input.carve-live-task-checkbox'))
    }
    const found = await boxes()
    assert.deepEqual(found.map((box) => [box.type, box.classList.contains('task-list-item-checkbox'), box.checked, box.dataset.taskState ?? null]), [
      ['checkbox', true, false, null],
      ['checkbox', true, true, null],
      ['checkbox', true, false, '>'],
    ])
    found[0].click()
    assert.equal(view.state.doc.toString(), 'top\n\n- [x] open\n- [x] done\n- [>] later\n')
    assert.equal(found[0].checked, false, 'the box follows the source, not its own native toggle')
    found[1].click()
    assert.equal(view.state.doc.toString(), 'top\n\n- [x] open\n- [ ] done\n- [>] later\n')
    assert.equal(view.state.selection.main.head, 0)
    // A quick reversal (an undo) before the preview refreshes must not leave a stale box.
    view.dispatch({ changes: [{ from: 8, to: 9, insert: ' ' }, { from: 19, to: 20, insert: 'x' }] })
    assert.equal(view.state.doc.toString(), doc)
    const refreshed = await (async () => { await new Promise((resolve) => setTimeout(resolve, 300)); return Array.from(parent.querySelectorAll('input.carve-live-task-checkbox')) })()
    assert.deepEqual(refreshed.map((box) => box.checked), [false, true, false])
    view.destroy()
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    await window.happyDOM.close()
  }
})

test('after Enter on a task the new line shows a clickable checkbox, also under the caret', async () => {
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
    const doc = '- [x] done\n- [ ] '
    const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [createCarveLivePreview()] }) })
    for (let i = 0; i < 60 && parent.querySelectorAll('.carve-live-task-checkbox').length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    const boxes = Array.from(parent.querySelectorAll('input.carve-live-task-checkbox'))
    assert.deepEqual(boxes.map((box) => box.checked), [true, false])
    const lines = Array.from(parent.querySelectorAll('.cm-line')).map((line) => line.textContent)
    assert.deepEqual(lines, ['done', ''], 'neither the bracket text nor a bullet glyph is shown')
    boxes[1].click()
    assert.equal(view.state.doc.toString(), '- [x] done\n- [x] ')
    assert.equal(view.state.selection.main.head, doc.length)
    view.destroy()
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    await window.happyDOM.close()
  }
})

test('links show their label and reveal their destination at the cursor', () => {
  const source = '[label](https://example.com)'
  assert.deepEqual(livePresentations(source, [{ from: source.length, to: source.length }]), [
    { kind: 'hide', from: 0, to: 1 },
    { kind: 'mark', from: 1, to: 6, className: 'carve-live-link' },
    { kind: 'hide', from: 6, to: 28 },
  ])
  assert.deepEqual(livePresentations(source, [{ from: 20, to: 20 }]), [])
})

test('table source becomes styled header and body cells', () => {
  const shown = livePresentations('|= A |= B |\n| x | y |', [{ from: 21, to: 21 }])
  assert.equal(shown.filter((item) => item.kind === 'line' && item.className === 'carve-live-table-row').length, 2)
  assert.equal(shown.filter((item) => item.kind === 'mark' && item.className === 'carve-live-table-header').length, 2)
  assert.equal(shown.filter((item) => item.kind === 'mark' && item.className === 'carve-live-table-cell').length, 2)
})

test('fenced code hides fences but reveals them while editing the block', () => {
  const source = '```js\ncode\n```'
  assert.deepEqual(livePresentations(source, [{ from: source.length, to: source.length }]), [
    { kind: 'hide', from: 0, to: 6 },
    { kind: 'line', at: 6, className: 'carve-live-code-block' },
    { kind: 'mark', from: 6, to: 10, className: 'carve-live-code-block-content' },
    { kind: 'hide', from: 10, to: 14 },
  ])
  assert.deepEqual(livePresentations(source, [{ from: 8, to: 8 }]), [
    { kind: 'line', at: 6, className: 'carve-live-code-block' },
  ])
})

test('attached attributes become a readable badge and reveal at the cursor', () => {
  const source = '{#hero .wide}\n### Head'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.deepEqual(shown.filter((item) => item.kind === 'widget' || (item.kind === 'hide' && item.from === 0)), [
    { kind: 'widget', at: 0, label: '#hero .wide', className: 'carve-live-attribute' },
    { kind: 'hide', from: 0, to: 13 },
  ])
  assert.equal(livePresentations(source, [{ from: 5, to: 5 }]).some((item) => item.kind === 'hide' && item.from === 0 && item.to === 13), false)
})

test('semantic reparsing is debounced and bounded for responsive typing', () => {
  assert.equal(livePreviewDelay(100_000), LIVE_PREVIEW_IDLE_MS)
  assert.equal(livePreviewDelay(250_000), LIVE_PREVIEW_IDLE_MS)
  assert.equal(livePreviewDelay(250_001), null)
})

test('images and captions become readable widgets without losing source', () => {
  const source = '![alt](image.png)\n^ Caption'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.ok(shown.some((item) => item.kind === 'image' && item.destination === 'image.png' && item.alt === 'alt'))
  assert.ok(shown.some((item) => item.kind === 'mark' && item.className === 'carve-live-caption' && source.slice(item.from, item.to) === 'Caption'))
  assert.deepEqual(livePresentations(source, [{ from: 5, to: 5 }]).filter((item) => item.kind === 'image'), [])
})

test('footnote references and definitions get distinct source-backed widgets', () => {
  const source = 'Text[^a]\n\n[^a]: note'
  const widgets = livePresentations(source, [{ from: source.length, to: source.length }]).filter((item) => item.kind === 'widget')
  assert.deepEqual(widgets, [
    { kind: 'widget', at: 4, label: 'a', className: 'carve-live-footnote-ref' },
    { kind: 'widget', at: 10, label: '↳ a', className: 'carve-live-footnote-def' },
  ])
})

test('admonition fences collapse to a named container outside the cursor', () => {
  const source = '::: note "Title"\nbody\n:::'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.ok(shown.some((item) => item.kind === 'widget' && item.label === 'note "Title"'))
  assert.equal(shown.filter((item) => item.kind === 'hide').length, 2)
  assert.deepEqual(livePresentations(source, [{ from: 19, to: 19 }]), [
    { kind: 'line', at: 17, className: 'carve-live-container' },
  ])
})

test('math delimiters hide while their authored content remains mapped', () => {
  assert.deepEqual(livePresentations('Inline $`x`', [{ from: 11, to: 11 }]), [
    { kind: 'hide', from: 7, to: 9 },
    { kind: 'mark', from: 9, to: 10, className: 'carve-live-math' },
    { kind: 'hide', from: 10, to: 11 },
  ])
})

test('comments retain readable text while their delimiters hide', () => {
  const source = 'before {% hidden %} after\n\n%% block note'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.equal(shown.filter((item) => item.kind === 'mark' && item.className === 'carve-live-comment').length, 2)
  assert.ok(shown.some((item) => item.kind === 'mark' && source.slice(item.from, item.to).trim() === 'hidden'))
  assert.ok(shown.some((item) => item.kind === 'mark' && source.slice(item.from, item.to) === 'block note'))
})

test('CriticMarkup distinguishes inserts, deletes, substitutions, and comments', () => {
  const source = '{+inserted+} {-deleted-} {~old~>new~} {#comment#}'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.deepEqual(shown.filter((item) => item.kind === 'mark').map((item) => [item.className, source.slice(item.from, item.to)]), [
    ['carve-live-insert', 'inserted'],
    ['carve-live-delete', 'deleted'],
    ['carve-live-delete', 'old'],
    ['carve-live-insert', 'new'],
    ['carve-live-comment', 'comment'],
  ])
})

test('tags, mentions, and raw inline payloads receive semantic presentation', () => {
  const source = '#tag @user `<b>x</b>`{=html}'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.deepEqual(shown.filter((item) => item.kind === 'mark').map((item) => [item.className, source.slice(item.from, item.to)]), [
    ['carve-live-tag', 'tag'],
    ['carve-live-mention', 'user'],
    ['carve-live-raw', '<b>x</b>'],
  ])
  assert.ok(shown.some((item) => item.kind === 'widget' && item.label === 'html'))
})

test('Obsidian wikilinks and embeds become source-backed widgets', () => {
  const source = 'See [[Note|human label]] and ![[Picture]].'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.deepEqual(shown.filter((item) => item.kind === 'widget').map((item) => [item.className, item.label]), [
    ['carve-live-wikilink', '↗ human label'],
  ])
  assert.ok(shown.some((item) => item.kind === 'image' && item.destination === 'Picture'))
  assert.equal(livePresentations(source, [{ from: 8, to: 8 }]).some((item) => item.kind === 'widget' && item.className === 'carve-live-wikilink'), false)
})

test('a substitution splits at the first top-level arrow, not the last one anywhere', () => {
  // carve#2083. The greedy scan this replaces took the last arrow in the pair.
  const source = '{~a~>b~>c~}'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.deepEqual(shown.filter((item) => item.kind === 'mark').map((item) => [item.className, source.slice(item.from, item.to)]), [
    ['carve-live-delete', 'a'],
    ['carve-live-insert', 'b~>c'],
  ])
})

test('a pair whose only arrow sits inside a code span is a strikethrough', () => {
  const source = '{~a `x~>y` b~}'
  const shown = livePresentations(source, [{ from: source.length, to: source.length }])
  assert.deepEqual(shown.filter((item) => item.className === 'carve-live-delete' || item.className === 'carve-live-insert'), [])
})

test('an empty half keeps the other half addressable', () => {
  for (const [source, marks] of [
    ['{~~>new~}', [['carve-live-insert', 'new']]],
    ['{~old~>~}', [['carve-live-delete', 'old']]],
  ]) {
    const shown = livePresentations(source, [{ from: source.length, to: source.length }])
    assert.deepEqual(
      shown.filter((item) => item.kind === 'mark' && item.from !== item.to).map((item) => [item.className, source.slice(item.from, item.to)]),
      marks,
      source,
    )
  }
})
