import assert from 'node:assert/strict'
import test from 'node:test'
import { carveToHtml } from '@markup-carve/carve'

test('the renderer produces Obsidian-ready HTML', () => {
  const html = carveToHtml('# Human markup\n\nA *strong* idea and [link](https://example.com).', { allowRawHtml: false })
  assert.match(html, /<h1[^>]*>Human markup<\/h1>/)
  assert.match(html, /<strong>strong<\/strong>/)
  assert.match(html, /href="https:\/\/example.com"/)
})

test('raw HTML is disabled on the plugin path', () => {
  const html = carveToHtml('<script>alert(1)</script>', { allowRawHtml: false })
  assert.doesNotMatch(html, /<script>/)
})
