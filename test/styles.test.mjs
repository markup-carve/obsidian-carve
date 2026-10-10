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
