import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import Prism from 'prismjs'

import { highlightCodeBlocks, withCarveGrammar } from '../dist-test/highlight.js'
import { renderCarve } from '../dist-test/render.js'

async function highlighted(source) {
  const document = new Window().document
  const root = document.createElement('article')
  root.innerHTML = renderCarve('```carve\n' + source + '```\n')
  highlightCodeBlocks(root, await withCarveGrammar(Prism))
  return root.querySelector('pre > code.language-carve')
}

test('a marker below paragraph text stays lazy text', async () => {
  const source = 'a\n: \n'
  const code = await highlighted(source)
  assert.equal(code.textContent, source)
  assert.equal(code.querySelector('.token.definition-list, .token.list'), null)
})

test('a list after a blank line gets a list token', async () => {
  const source = 'a\n\n- x\n'
  const code = await highlighted(source)
  assert.equal(code.textContent, source)
  assert.equal(code.querySelector('.token.list')?.textContent, '- ')
})

test('a description in a footnote keeps its definition scope', async () => {
  const source = '[^a]:\n    :: term\n    : desc\n'
  const code = await highlighted(source)
  assert.equal(code.textContent, source)
  assert.match(code.querySelector('.token.definition-list')?.textContent ?? '', /term\n    : desc/)
})
