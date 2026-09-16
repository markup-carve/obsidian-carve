import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

import { decorateLanguageDiffs } from '../dist-test/diff.js'

test('presents a {.diff} language fence line by line', () => {
  const document = new Window().document
  const root = document.createElement('article')
  root.innerHTML = '<pre class="diff"><code class="language-js">  keep();\n- old();\n+ fresh();\n</code></pre>'

  decorateLanguageDiffs(root)

  const pre = root.querySelector('pre')
  assert.equal(pre.classList.contains('has-diff'), true)
  assert.equal(root.querySelectorAll('.line').length, 3)
  assert.equal(root.querySelector('.line.diff.remove .diff-marker').textContent, '-')
  assert.equal(root.querySelector('.line.diff.add .diff-marker').textContent, '+')
})

test('leaves an ordinary language fence unchanged', () => {
  const document = new Window().document
  const root = document.createElement('article')
  root.innerHTML = '<pre><code class="language-js">+ ordinary();\n</code></pre>'
  const before = root.innerHTML

  decorateLanguageDiffs(root)

  assert.equal(root.innerHTML, before)
})
