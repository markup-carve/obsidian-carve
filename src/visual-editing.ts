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

function directList(item: HTMLLIElement): HTMLElement | null {
  return Array.from(item.children).find((child) => /^(?:UL|OL)$/.test(child.tagName)) as HTMLElement | undefined ?? null
}

function itemContentEmpty(item: HTMLLIElement): boolean {
  const clone = item.cloneNode(true) as HTMLLIElement
  directList(clone)?.remove()
  for (const child of Array.from(clone.querySelectorAll('input,br'))) child.remove()
  return !(clone.textContent ?? '').trim()
}

/** Apply familiar Markdown input rules to the rendered DOM, never to saved source. */
export function applyVisualInputRule(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  if (!selection?.isCollapsed) return false
  const block = activeBlock(surface, selection)
  if (!block) return false
  const text = block.textContent ?? ''
  if (block.tagName === 'LI') {
    const task = /^\[([ xX])\]\s/.exec(text)
    if (!task) return false
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task[1]!.toLowerCase() === 'x'; checkbox.setAttribute('aria-label', 'Toggle task')
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
  if (text === '--- ') {
    const rule = document.createElement('hr'); const paragraph = document.createElement('p'); paragraph.append(document.createElement('br'))
    block.replaceWith(rule, paragraph); placeCaretAtStart(paragraph); return true
  }
  if (text === '``` ') {
    const code = document.createElement('pre'); code.append(document.createElement('br'))
    block.replaceWith(code); placeCaretAtStart(code); return true
  }
  return false
}

export function insertPlainText(surface: HTMLElement, text: string, selection: Selection | null = document.getSelection()): boolean {
  if (!selection?.rangeCount || !surface.contains(selection.anchorNode)) return false
  const range = selection.getRangeAt(0); range.deleteContents()
  const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true)
  selection.removeAllRanges(); selection.addRange(range); return true
}

export function insertFormattedText(surface: HTMLElement, text: string, tags: readonly string[], selection: Selection | null = document.getSelection()): boolean {
  const range = rangeIn(surface, selection); if (!range || !range.collapsed || !text) return false
  let content: Node = document.createTextNode(text)
  for (const tag of tags) { const wrapper = document.createElement(tag); wrapper.append(content); content = wrapper }
  range.insertNode(content)
  range.setStartAfter(content); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range)
  return true
}

export function insertVisualLink(surface: HTMLElement, href: string, label = href, selection: Selection | null = document.getSelection()): boolean {
  const range = rangeIn(surface, selection); if (!range || !href) return false
  if (!range.collapsed) return wrapVisualSelection(surface, 'a', { href }, selection)
  const link = document.createElement('a'); link.href = href; link.textContent = label || href; range.insertNode(link)
  range.setStartAfter(link); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range); return true
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
  const block = activeBlock(surface, selection); const range = rangeIn(surface, selection)
  if (!block || block.tagName === 'LI') return false
  const blocks = range && !range.collapsed
    ? Array.from(surface.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,blockquote,pre')).filter((candidate) => range.intersectsNode(candidate) && !candidate.parentElement?.closest('blockquote'))
    : [block]
  if (!blocks.length) return false
  let first: HTMLElement | null = null
  for (const current of blocks) {
    const replacement = document.createElement(tag)
    if (tag === 'pre') replacement.textContent = current.textContent
    else while (current.firstChild) replacement.append(current.firstChild)
    current.replaceWith(replacement); first ??= replacement
  }
  if (first) placeCaretAtStart(first); return true
}

export function toggleVisualList(surface: HTMLElement, ordered: boolean, selection: Selection | null = document.getSelection()): boolean {
  const block = activeBlock(surface, selection)
  if (!block) return false
  const item = block.closest('li')
  const list = item?.parentElement
  const wanted = ordered ? 'OL' : 'UL'
  if (item && list?.tagName === wanted) {
    const paragraph = document.createElement('p'); while (item.firstChild) paragraph.append(item.firstChild)
    const before = document.createElement(list.tagName.toLowerCase())
    const after = document.createElement(list.tagName.toLowerCase())
    let passed = false
    for (const sibling of Array.from(list.children)) {
      if (sibling === item) { passed = true; continue }
      ;(passed ? after : before).append(sibling)
    }
    list.replaceWith(...(before.children.length ? [before] : []), paragraph, ...(after.children.length ? [after] : [])); placeCaretAtStart(paragraph); return true
  }
  if (item && list && /^(?:UL|OL)$/.test(list.tagName)) {
    const replacement = document.createElement(ordered ? 'ol' : 'ul')
    while (list.firstChild) replacement.append(list.firstChild)
    list.replaceWith(replacement); placeCaretAtStart(item); return true
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

function activeListItem(surface: HTMLElement, selection: Selection | null): HTMLLIElement | null {
  const block = activeBlock(surface, selection)
  const item = block?.closest<HTMLLIElement>('li') ?? null
  return item && surface.contains(item) ? item : null
}

export function indentVisualListItem(surface: HTMLElement, outdent = false, selection: Selection | null = document.getSelection()): boolean {
  const item = activeListItem(surface, selection)
  const list = item?.parentElement
  if (!item || !list || !/^(?:UL|OL)$/.test(list.tagName)) return false
  if (outdent) {
    const parentItem = list.parentElement?.closest<HTMLLIElement>('li')
    if (!parentItem) return false
    parentItem.after(item)
    if (!list.children.length) list.remove()
    placeCaretAtStart(item); return true
  }
  const previous = item.previousElementSibling
  if (!(previous instanceof HTMLLIElement)) return false
  let nested = Array.from(previous.children).find((child) => child.tagName === list.tagName) as HTMLOListElement | HTMLUListElement | undefined
  if (!nested) { nested = document.createElement(list.tagName.toLowerCase()) as HTMLOListElement | HTMLUListElement; previous.append(nested) }
  nested.append(item); placeCaretAtStart(item); return true
}

export function continueVisualList(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const item = activeListItem(surface, selection)
  const list = item?.parentElement
  if (!item || !list || !/^(?:UL|OL)$/.test(list.tagName)) return false
  if (itemContentEmpty(item)) {
    const parentItem = list.parentElement?.closest<HTMLLIElement>('li')
    if (parentItem) { parentItem.after(item); if (!list.children.length) list.remove(); placeCaretAtStart(item); return true }
    const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); list.after(paragraph); item.remove(); if (!list.children.length) list.remove(); placeCaretAtStart(paragraph); return true
  }
  const next = document.createElement('li')
  const task = Array.from(item.children).find((child) => child instanceof HTMLInputElement && child.type === 'checkbox') as HTMLInputElement | undefined
  if (task) { const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Toggle task'); next.append(checkbox, ' ') }
  const range = rangeIn(surface, selection)
  if (range?.collapsed && item.contains(range.startContainer)) {
    const tail = range.cloneRange(); tail.setEnd(item, item.childNodes.length)
    const nested = directList(item); if (nested && tail.intersectsNode(nested)) tail.setEndBefore(nested)
    const fragment = tail.extractContents()
    for (const input of Array.from(fragment.querySelectorAll('input'))) input.remove()
    if (fragment.textContent || fragment.querySelector?.('*')) next.append(fragment)
  }
  if (!next.textContent?.trim()) next.append(document.createElement('br'))
  item.after(next); placeCaretAtStart(next); return true
}

export function toggleVisualTask(surface: HTMLElement, checkbox: HTMLInputElement): boolean {
  if (checkbox.type !== 'checkbox' || !surface.contains(checkbox) || !checkbox.closest('li')) return false
  checkbox.toggleAttribute('checked', checkbox.checked)
  return true
}

export function toggleVisualTaskAtSelection(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const item = activeListItem(surface, selection)
  if (item) {
    const existing = Array.from(item.children).find((child) => child instanceof HTMLInputElement && child.type === 'checkbox') as HTMLInputElement | undefined
    if (existing) { existing.checked = !existing.checked; existing.toggleAttribute('checked', existing.checked); return true }
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Toggle task'); item.prepend(checkbox, ' '); return true
  }
  const block = activeBlock(surface, selection); if (!block || block.tagName === 'LI') return false
  const list = document.createElement('ul'); const created = document.createElement('li'); const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Toggle task'); created.append(checkbox, ' ')
  while (block.firstChild) created.append(block.firstChild)
  list.append(created); block.replaceWith(list); placeCaretAtEnd(created); return true
}

/** Backspace at an item boundary mirrors mature outline editors. */
export function backspaceVisualListItem(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const item = activeListItem(surface, selection); const range = rangeIn(surface, selection)
  if (!item || !range?.collapsed) return false
  const before = range.cloneRange(); before.selectNodeContents(item); before.setEnd(range.startContainer, range.startOffset)
  const prefix = before.cloneContents()
  for (const child of Array.from(prefix.querySelectorAll('input,br,ul,ol'))) child.remove()
  if ((prefix.textContent ?? '').length) return false
  if (indentVisualListItem(surface, true, selection)) return true
  const previous = item.previousElementSibling as HTMLLIElement | null
  if (previous?.tagName === 'LI') {
    const nested = directList(previous); const marker = document.createComment('caret')
    if (nested) previous.insertBefore(marker, nested); else previous.append(marker)
    while (item.firstChild) previous.insertBefore(item.firstChild, nested)
    item.remove(); const caret = document.createRange(); caret.setStartBefore(marker); caret.collapse(true); marker.remove()
    selection?.removeAllRanges(); selection?.addRange(caret); return true
  }
  return false
}

const SAFE_PASTE_TAGS = new Set(['A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'I', 'LI', 'MARK', 'OL', 'P', 'PRE', 'S', 'STRONG', 'SUB', 'SUP', 'U', 'UL'])
export function insertSanitizedHtml(surface: HTMLElement, html: string, selection: Selection | null = document.getSelection()): boolean {
  const range = rangeIn(surface, selection); if (!range) return false
  const template = document.createElement('template'); template.innerHTML = html
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (!SAFE_PASTE_TAGS.has(element.tagName)) { element.replaceWith(...Array.from(element.childNodes)); continue }
    for (const attribute of Array.from(element.attributes)) if (!(element.tagName === 'A' && attribute.name === 'href')) element.removeAttribute(attribute.name)
    if (element.tagName === 'A' && !/^(?:https?:|mailto:|#|\/)/i.test(element.getAttribute('href') ?? '')) element.removeAttribute('href')
  }
  range.deleteContents(); const tail = template.content.lastChild; range.insertNode(template.content)
  if (tail) { range.setStartAfter(tail); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range) }
  return true
}
