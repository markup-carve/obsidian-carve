import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import Prism from 'prismjs'

import { highlightCodeBlocks, withCarveGrammar } from '../dist-test/highlight.js'
import { renderCarve } from '../dist-test/render.js'

async function rendered(source) {
  const document = new Window().document
  const root = document.createElement('article')
  root.innerHTML = renderCarve(source)
  highlightCodeBlocks(root, await withCarveGrammar(Prism))
  return root
}

test('highlights a js fence with Prism tokens', async () => {
  const root = await rendered('```js\nconst answer = 42\n```\n')
  const code = root.querySelector('pre > code.language-js')
  assert.equal(code.querySelector('.token.keyword').textContent, 'const')
  assert.equal(code.querySelector('.token.number').textContent, '42')
  assert.equal(code.textContent, 'const answer = 42\n')
  assert.equal(root.querySelector('pre').classList.contains('language-js'), true)
})

for (const language of ['carve', 'crv']) {
  test(`highlights a ${language} fence with the Carve grammar`, async () => {
    const root = await rendered('```' + language + '\n# Title\n\nSome *bold* text.\n```\n')
    const code = root.querySelector(`pre > code.language-${language}`)
    assert.ok(code.querySelector('.token'), 'expected Prism token spans')
    assert.match(code.querySelector('.token.bold, .token.strong')?.textContent ?? '', /bold/)
    assert.equal(code.textContent, '# Title\n\nSome *bold* text.\n')
  })
}

test('a {.diff} fence keeps its line presentation and gains language tokens', async () => {
  const root = await rendered('{.diff}\n```js\n  keep();\n- const old = 1\n+ const fresh = 2\n```\n')
  const pre = root.querySelector('pre')
  assert.equal(pre.classList.contains('has-diff'), true)
  assert.equal(root.querySelectorAll('.line').length, 3)
  const removed = root.querySelector('.line.diff.remove')
  assert.equal(removed.querySelector('.diff-marker').textContent, '-')
  assert.equal(removed.querySelector('.token.keyword').textContent, 'const')
  assert.equal(root.querySelector('.line.diff.add .token.number').textContent, '2')
})

test('a fence in an unknown language stays plain, and a diff of it still gets lines', async () => {
  const root = await rendered('```nosuchlang\nx < y\n```\n\n{.diff}\n```nosuchlang\n- a < b\n```\n')
  const [plain, diff] = root.querySelectorAll('pre')
  assert.equal(plain.querySelector('.token'), null)
  assert.equal(plain.textContent, 'x < y\n')
  assert.equal(diff.classList.contains('has-diff'), true)
  assert.equal(diff.querySelector('.line.diff.remove').textContent, '- a < b')
})

test('without a highlighter, diff fences are still presented', () => {
  const document = new Window().document
  const root = document.createElement('article')
  root.innerHTML = renderCarve('{.diff}\n```js\n+ added()\n```\n')
  highlightCodeBlocks(root, null)
  assert.equal(root.querySelector('.line.diff.add .diff-marker').textContent, '+')
})

test('without a highlighter, an ordinary fence is left unchanged', () => {
  const document = new Window().document
  const root = document.createElement('article')
  root.innerHTML = '<pre><code class="language-js">+ ordinary();\n</code></pre>'
  const before = root.innerHTML
  highlightCodeBlocks(root, null)
  assert.equal(root.innerHTML, before)
})
