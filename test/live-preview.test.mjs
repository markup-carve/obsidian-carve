import assert from 'node:assert/strict'
import test from 'node:test'
import { livePresentations } from '../dist-test/live-preview.js'

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
