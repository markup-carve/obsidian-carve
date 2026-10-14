import assert from 'node:assert/strict'
import test from 'node:test'
import Prism from 'prismjs'
import { Window } from 'happy-dom'
import { withCarveGrammar } from '../dist-test/highlight.js'
import { HIGHLIGHT_DEBOUNCE_MS, HIGHLIGHT_FULL_CONTEXT, HIGHLIGHT_MARGIN, carveHighlighting, carveTokenRanges, highlightWindow } from '../dist-test/syntax.js'
import { openFenceBefore } from '../dist-test/fences.js'

const prism = await withCarveGrammar(Prism)

/** Classes on the range that covers `needle` (its `nth` occurrence), or ''. */
function classesAt(source, needle, nth = 0) {
  let at = -1
  for (let index = 0; index <= nth; index++) at = source.indexOf(needle, at + 1)
  assert.notEqual(at, -1, `${JSON.stringify(needle)} not in source`)
  const ranges = carveTokenRanges(source, prism).filter((range) => range.from <= at && range.to >= at + needle.length)
  return ranges.map((range) => range.className).join(' ')
}

const has = (source, needle, token, nth = 0) => assert.match(classesAt(source, needle, nth), new RegExp(`carve-tok-${token}(?: |$)`), `${JSON.stringify(needle)} in ${JSON.stringify(source)} is not ${token}`)
const lacks = (source, needle, token, nth = 0) => assert.doesNotMatch(classesAt(source, needle, nth), new RegExp(`carve-tok-${token}(?: |$)`), `${JSON.stringify(needle)} in ${JSON.stringify(source)} is ${token}`)

test('only a closed block on the first line is front matter; a later --- is a thematic break', () => {
  const source = '---\ntitle: x\n---\n\nIntro\n\n---\n\nafter the break\n'
  has(source, 'title', 'front-matter')
  lacks(source, 'after the break', 'front-matter')
  lacks(source, 'after the break', 'property')
  has(source, '---', 'thematic-break', 2)
  lacks('Intro\n\n---\n\nafter\n', 'after', 'front-matter')
})

test('a shorter fence does not close a longer one', () => {
  const source = '```` js\n```\nstill code\n````\n\n*out*\n'
  has(source, 'still code', 'code-block')
  has(source, '*out*', 'bold')
})

test('a fence and a heading inside a quote or a list item keep their context', () => {
  has('> ```\n> *code*\n> ```\n', '*code*', 'code-block')
  lacks('> ```\n> *code*\n> ```\n', '*code*', 'bold')
  has('- item\n\n  ```\n  *code*\n  ```\n', '*code*', 'code-block')
})

test('a table needs its closing pipe', () => {
  lacks('| a | b\n', 'a', 'table')
})

test('escapes and intraword delimiters stay literal', () => {
  lacks('\\*not bold\\*\n', 'not bold', 'bold')
  lacks('a*b*c\n', 'b', 'bold')
  lacks('snake_case_name\n', 'case', 'underline')
})

test('comments, mark, super and subscript, definitions and CriticMarkup are recognized', () => {
  has('a %% hidden %% b\n', 'hidden', 'comment')
  has('%%%\nblock\n%%%\n', 'block', 'comment')
  has('a =marked= b\n', 'marked', 'highlight')
  has('x{^2^} H{,2,}O\n', '{^2^}', 'superscript')
  has('x{^2^} H{,2,}O\n', '{,2,}', 'subscript')
  has(':: term\n: def\n', 'term', 'definition-term')
  has('a {++new++} b\n', 'new', 'inserted')
  has('a {--old--} b\n', 'old', 'deleted')
})

test('an attribute line is attributes, not a tag', () => {
  const source = '{#intro .featured}\nPara\n'
  has(source, '#intro', 'attributes')
  lacks(source, '#intro', 'tag')
  has('see #carve here\n', '#carve', 'tag')
})

test('an include directive is one token, so a selector is not a tag', () => {
  for (const line of ['{{ frag.crv }}', '{{ frag.crv #Alpha }}', '{{ frag.crv#Alpha }}', '{{ "frag.crv"#Alpha }}', '{{ frag.crv@shift:1 }}']) {
    has(`${line}\n`, line.slice(3, 11), 'include-directive')
    lacks(`${line}\n`, line.slice(3, 11), 'tag')
  }
})

test('nested inline runs keep every class', () => {
  const classes = classesAt('> a *bold* b\n', 'bold')
  assert.match(classes, /carve-tok-blockquote/)
  assert.match(classes, /carve-tok-bold/)
})

test('wikilinks are marked outside literal constructs only', () => {
  has('See [[My Note]] now\n', '[[My Note]]', 'wikilink')
  has('See ![[Embed]] now\n', '![[Embed]]', 'wikilink')
  lacks('See `[[Code]]` now\n', '[[Code]]', 'wikilink')
  lacks('```\n[[Fenced]]\n```\n', '[[Fenced]]', 'wikilink')
  lacks('%% [[Hidden]] %%\n', '[[Hidden]]', 'wikilink')
  lacks('\\[[Escaped]]\n', 'Escaped', 'wikilink')
})

test('ranges are offset into the document and never overlap', () => {
  const source = '# Head\n\n- a *b* [[C]]\n'
  const ranges = carveTokenRanges(source, prism, 100)
  for (const [index, range] of ranges.entries()) {
    assert.ok(range.from >= 100 && range.to <= 100 + source.length && range.to > range.from)
    if (index) assert.ok(range.from >= ranges[index - 1].to, 'ranges overlap')
  }
})

test('the lines that froze the old tokenizer stay fast', () => {
  for (const source of ['['.repeat(2000), '[a]('.repeat(1000)]) {
    const started = performance.now()
    carveTokenRanges(source, prism)
    const elapsed = performance.now() - started
    assert.ok(elapsed < 2000, `${JSON.stringify(source.slice(0, 8))}... took ${elapsed.toFixed(0)} ms`)
  }
})

test('the highlight window keeps context near the top and bounds the work further down', () => {
  const source = 'line\n\n'.repeat(100_000)
  assert.deepEqual(highlightWindow(source, 0, 2000).from, 0)
  const far = highlightWindow(source, 400_000, 402_000)
  assert.ok(far.from > 400_000 - HIGHLIGHT_MARGIN - 10 && far.from <= 400_000 - HIGHLIGHT_MARGIN + 2, `starts at ${far.from}`)
  assert.equal(source.slice(far.from - 2, far.from), '\n\n', 'the window starts after a blank line')
  assert.ok(far.to >= 402_000 + HIGHLIGHT_MARGIN && far.to < 402_000 + HIGHLIGHT_MARGIN + 10)
  assert.ok(far.to - far.from < 2 * HIGHLIGHT_MARGIN + 2_100)
  assert.equal(highlightWindow(source, HIGHLIGHT_FULL_CONTEXT - 1, HIGHLIGHT_FULL_CONTEXT).from, 0)
})

test('the editor extension colors the source once Prism loads, and again after an edit', async () => {
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
    const view = new EditorView({ parent, state: EditorState.create({ doc: '# Head\n', extensions: [carveHighlighting(async () => prism)] }) })
    const settle = async (selector) => {
      for (let i = 0; i < 100 && !parent.querySelector(selector); i++) await new Promise((resolve) => setTimeout(resolve, 10))
      return parent.querySelector(selector)
    }
    assert.ok(await settle('.carve-tok-title'), 'the heading was not colored')
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\nA *bold* move\n' } })
    await new Promise((resolve) => setTimeout(resolve, HIGHLIGHT_DEBOUNCE_MS))
    assert.equal((await settle('.carve-tok-bold'))?.textContent.includes('bold'), true, 'the edit was not re-colored')
    view.destroy()
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    await window.happyDOM.close()
  }
})

test('a distant window starting inside a code fence moves back to its opener', () => {
  const body = 'code line\n\n'.repeat(10_000)
  const source = 'intro\n\n````\n' + body + '````\n\nafter\n'
  const opener = source.indexOf('````')
  const view = opener + 100_000
  assert.equal(highlightWindow(source, view, view + 2000).from, opener)
  assert.equal(openFenceBefore(source, source.indexOf('after')), null)
  assert.equal(openFenceBefore('> ```\n> x\n', 8), 0)
  assert.equal(openFenceBefore('a ```inline``` b\n```\nx\n', 22), 17)
})

test('a distant window stays bounded when no blank line is near', () => {
  const source = 'word '.repeat(60_000) + '\n' + 'more\n'.repeat(40_000)
  const view = 250_000
  const window = highlightWindow(source, view, view + 2000)
  assert.ok(window.from >= view - 2 * HIGHLIGHT_MARGIN, `starts at ${window.from}`)
})
