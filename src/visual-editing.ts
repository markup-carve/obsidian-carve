const BLOCK_SELECTOR = 'p,div,h1,h2,h3,h4,h5,h6,blockquote,pre,li'

function activeBlock(surface: HTMLElement, selection: Selection | null = document.getSelection()): HTMLElement | null {
  const node = selection?.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  const block = element?.closest<HTMLElement>(BLOCK_SELECTOR) ?? null
  return block && surface.contains(block) ? block : null
}

export function placeCaretAtStart(element: HTMLElement): void {
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(true)
  const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
}
function placeCaretAtEnd(element: HTMLElement): void { const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }

/** Apply familiar Markdown input rules to the rendered DOM, never to saved source. */
export function applyVisualInputRule(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  if (!selection?.isCollapsed) return false
  const block = activeBlock(surface, selection)
  if (!block) return false
  const text = block.textContent ?? ''
  if (block.tagName === 'LI') {
    const task = /^\[([ xX])\]\s/.exec(text)
    if (!task) return false
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.disabled = true; checkbox.checked = task[1]!.toLowerCase() === 'x'
    block.textContent = text.slice(task[0].length); block.prepend(checkbox, ' '); placeCaretAtEnd(block); return true
  }
  if (!/^(?:P|DIV)$/.test(block.tagName)) return false
  const heading = /^(#{1,6})\s/.exec(text)
  if (heading) {
    const replacement = document.createElement(`h${heading[1]!.length}`)
    replacement.textContent = text.slice(heading[0].length)
    if (!replacement.textContent) replacement.append(document.createElement('br'))
    block.replaceWith(replacement); placeCaretAtStart(replacement); return true
  }
  const list = /^(?:[-*+] |1[.)] )$/.exec(text)
  if (list) {
    const parent = document.createElement(list[0].startsWith('1') ? 'ol' : 'ul')
    const item = document.createElement('li'); item.append(document.createElement('br')); parent.append(item)
    block.replaceWith(parent); placeCaretAtStart(item); return true
  }
  if (text === '> ') {
    const quote = document.createElement('blockquote'); quote.append(document.createElement('br'))
    block.replaceWith(quote); placeCaretAtStart(quote); return true
  }
  return false
}

export function insertPlainText(surface: HTMLElement, text: string, selection: Selection | null = document.getSelection()): boolean {
  if (!selection?.rangeCount || !surface.contains(selection.anchorNode)) return false
  const range = selection.getRangeAt(0); range.deleteContents()
  const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true)
  selection.removeAllRanges(); selection.addRange(range); return true
}

function rangeIn(surface: HTMLElement, selection: Selection | null = document.getSelection()): Range | null {
  return selection?.rangeCount && surface.contains(selection.anchorNode) ? selection.getRangeAt(0) : null
}

function unwrap(element: Element): void { element.replaceWith(...Array.from(element.childNodes)) }

export function wrapVisualSelection(surface: HTMLElement, tag: string, attributes: Record<string, string> = {}, selection: Selection | null = document.getSelection()): boolean {
  const range = rangeIn(surface, selection)
  if (!range || range.collapsed) return false
  const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement
  const existing = anchor?.closest(tag)
  if (existing && surface.contains(existing)) { unwrap(existing); return true }
  const wrapper = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) wrapper.setAttribute(name, value)
  try { range.surroundContents(wrapper) } catch { wrapper.append(range.extractContents()); range.insertNode(wrapper) }
  range.selectNodeContents(wrapper); selection?.removeAllRanges(); selection?.addRange(range); return true
}

export function formatVisualBlock(surface: HTMLElement, tag: string, selection: Selection | null = document.getSelection()): boolean {
  const block = activeBlock(surface, selection)
  if (!block) return false
  const replacement = document.createElement(tag)
  if (tag === 'pre') replacement.textContent = block.textContent
  else while (block.firstChild) replacement.append(block.firstChild)
  block.replaceWith(replacement); placeCaretAtStart(replacement); return true
}

export function toggleVisualList(surface: HTMLElement, ordered: boolean, selection: Selection | null = document.getSelection()): boolean {
  const block = activeBlock(surface, selection)
  if (!block) return false
  const item = block.closest('li')
  const list = item?.parentElement
  const wanted = ordered ? 'OL' : 'UL'
  if (item && list?.tagName === wanted) {
    const paragraph = document.createElement('p'); while (item.firstChild) paragraph.append(item.firstChild)
    list.replaceWith(paragraph); placeCaretAtStart(paragraph); return true
  }
  const created = document.createElement(ordered ? 'ol' : 'ul'); const createdItem = document.createElement('li')
  while (block.firstChild) createdItem.append(block.firstChild)
  created.append(createdItem); block.replaceWith(created); placeCaretAtStart(createdItem); return true
}

export function insertVisualRule(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const block = activeBlock(surface, selection)
  if (!block) return false
  const rule = document.createElement('hr'); const paragraph = document.createElement('p'); paragraph.append(document.createElement('br'))
  block.after(rule, paragraph); placeCaretAtStart(paragraph); return true
}

export function unlinkVisualSelection(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const range = rangeIn(surface, selection); if (!range) return false
  const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement
  const link = anchor?.closest('a'); if (!link || !surface.contains(link)) return false
  unwrap(link); return true
}

export function clearVisualFormatting(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const range = rangeIn(surface, selection); if (!range || range.collapsed) return false
  const text = document.createTextNode(range.toString()); range.deleteContents(); range.insertNode(text)
  range.selectNode(text); selection?.removeAllRanges(); selection?.addRange(range); return true
}
