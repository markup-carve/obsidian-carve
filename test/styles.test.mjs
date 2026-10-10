import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'
import { Window } from 'happy-dom'

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
// happy-dom ships no user-agent list styles; a browser sets these on every list.
const userAgent = 'ul { list-style-type: disc; } ol { list-style-type: decimal; }'

function render(container, source) {
  const window = new Window()
  const style = window.document.createElement('style'); style.textContent = `${userAgent}\n${css}`; window.document.head.append(style)
  window.document.body.innerHTML = `<div class="${container}">${carveToHtml(source)}</div>`
  const items = Array.from(window.document.querySelectorAll('li'))
  const item = (label) => items.find((li) => (li.querySelector(':scope > input')?.getAttribute('aria-label') ?? li.firstChild.textContent.trim()) === label)
  return { marker: (label) => window.getComputedStyle(item(label)).listStyleType, box: (label) => window.getComputedStyle(item(label).querySelector(':scope > input')) }
}

for (const container of ['carve-preview markdown-rendered', 'carve-visual-editor markdown-rendered']) {
  test(`task items in ${container.split(' ')[0]} drop the bullet, nested lists keep theirs`, () => {
    const { marker, box } = render(container, '- [ ] Parent\n\n  - child bullet\n  - [x] child task\n- plain\n\n1. step\n')
    assert.equal(marker('Parent'), 'none')
    assert.equal(marker('child task'), 'none')
    assert.equal(marker('child bullet'), 'disc')
    assert.equal(marker('plain'), 'disc')
    assert.equal(marker('step'), 'decimal')
    assert.match(box('Parent').marginInlineStart, /^calc\(.*\* -1\.5\)$/)
  })
}

// The theme variables Obsidian's app.css defines; the plugin only refers to them.
const theme = 'body { --text-normal: rgb(20, 20, 20); --text-muted: rgb(110, 110, 110); --text-faint: rgb(160, 160, 160); --checkbox-color: rgb(120, 80, 220); --checklist-done-color: rgb(110, 110, 110); --checklist-done-decoration: line-through; }'

function task(container, source) {
  const window = new Window()
  const style = window.document.createElement('style'); style.textContent = `${userAgent}\n${theme}\n${css}`; window.document.head.append(style)
  window.document.body.innerHTML = `<div class="${container}">${carveToHtml(source)}</div>`
  const item = (label) => window.document.querySelector(`li > input[aria-label="${label}"]`).parentElement
  return { item: (label) => window.getComputedStyle(item(label)), box: (label) => window.getComputedStyle(item(label).querySelector(':scope > input')), nested: (label) => window.getComputedStyle(item(label).querySelector(':scope > ul')) }
}

for (const container of ['carve-preview markdown-rendered', 'carve-visual-editor markdown-rendered', 'carve-construct-preview markdown-rendered']) {
  test(`done tasks in ${container.split(' ')[0]} fade and strike their own text, open ones stay plain`, () => {
    const { item, box, nested } = task(container, '- [x] done\n\n  - [ ] child\n- [ ] open\n- [-] dropped\n')
    assert.equal(item('done').textDecoration, 'line-through')
    assert.equal(item('done').color, 'rgb(110, 110, 110)')
    assert.equal(nested('done').color, 'rgb(20, 20, 20)')
    assert.equal(nested('done').display, 'inline-block')
    assert.match(item('child').textDecoration, /^(none|)$/)
    assert.match(item('open').textDecoration, /^(none|)$/)
    assert.match(item('dropped').textDecoration, /line-through/)
    assert.equal(box('done').opacity, '1')
    assert.equal(box('open').opacity, '1')
    assert.equal(Number(box('dropped').opacity), 0.55)
  })
}

test('extended task states get distinct box outlines', () => {
  const { box } = task('carve-preview markdown-rendered', '- [>] later\n- [?] maybe\n- [_] skip\n')
  assert.equal(box('later').outlineStyle, 'solid')
  assert.equal(box('maybe').outlineStyle, 'dotted')
  assert.equal(box('skip').outlineStyle, 'dashed')
})

test('source-view task checkboxes map the extended states and done text', () => {
  for (const [state, style] of [['>', 'solid'], ['?', 'dotted'], ['_', 'dashed']]) assert.match(css, new RegExp(`\\.carve-live-task-checkbox\\[data-task-state="${state.replace('?', '\\?')}"\\] \\{ outline: 1px ${style}`))
  assert.match(css, /\.carve-editor \.carve-live-task-done,\n\.carve-editor \.carve-live-task-cancelled \{\n  color: var\(--checklist-done-color, var\(--text-muted\)\);\n  text-decoration: var\(--checklist-done-decoration, line-through\);/)
})
