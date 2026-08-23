import assert from 'node:assert/strict'
import test from 'node:test'
import { LIVE_PREVIEW_IDLE_MS, livePresentations, livePreviewDelay } from '../dist-test/live-preview.js'

test('typed ### heading becomes an H3 presentation outside the cursor', () => {
  assert.deepEqual(livePresentations('### Human heading', [{ from: 17, to: 17 }]), [
    { kind: 'heading', from: 0, to: 17, level: 3 },
    { kind: 'hide', from: 0, to: 4 },
  ])
})

test('heading source syntax is revealed while its cursor is active', () => {
  assert.deepEqual(livePresentations('### Human heading', [{ from: 6, to: 6 }]), [])
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
    { kind: 'widget', at: 0, label: '☑', className: 'carve-live-task-marker' },
    { kind: 'hide', from: 0, to: 6 },
  ])
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
  assert.deepEqual(livePresentations(source, [{ from: 8, to: 8 }]), [])
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
  assert.ok(shown.some((item) => item.kind === 'widget' && item.label === '🖼 alt'))
  assert.ok(shown.some((item) => item.kind === 'mark' && item.className === 'carve-live-caption' && source.slice(item.from, item.to) === 'Caption'))
  assert.deepEqual(livePresentations(source, [{ from: 5, to: 5 }]).filter((item) => item.kind === 'widget' && item.className === 'carve-live-image'), [])
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
  assert.deepEqual(livePresentations(source, [{ from: 19, to: 19 }]), [])
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
