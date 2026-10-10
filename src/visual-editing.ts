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
  const anchor = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  if (tags.every((tag) => anchor?.closest(tag) && surface.contains(anchor.closest(tag)))) return insertPlainText(surface, text, selection)
  const textNode = document.createTextNode(text); let content: Node = textNode
  for (const tag of tags) { const wrapper = document.createElement(tag); wrapper.append(content); content = wrapper }
  range.insertNode(content)
  range.setStart(textNode, textNode.length); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range)
  return true
}

export function safeVisualHref(href: string): boolean {
  const value = href.trim(); if (!value || /[\u0000-\u001f]/.test(value)) return false
  return /^(?:https?:|mailto:|tel:|obsidian:|#|\/)/i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

export function insertVisualLink(surface: HTMLElement, href: string, label = href, selection: Selection | null = document.getSelection()): boolean {
  const range = rangeIn(surface, selection); if (!range || !safeVisualHref(href)) return false
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
  let first: HTMLElement | null = null; let last: HTMLElement | null = null
  for (const current of blocks) {
    const replacement = document.createElement(tag)
    if (tag === 'pre') replacement.textContent = current.textContent
    else while (current.firstChild) replacement.append(current.firstChild)
    current.replaceWith(replacement); first ??= replacement; last = replacement
  }
  if (first && last && blocks.length > 1 && selection) {
    const restored = document.createRange(); restored.setStart(first, 0); restored.setEnd(last, last.childNodes.length)
    selection.removeAllRanges(); selection.addRange(restored)
  } else if (first) placeCaretAtStart(first)
  return true
}

export function toggleVisualList(surface: HTMLElement, ordered: boolean, selection: Selection | null = document.getSelection()): boolean {
  const block = activeBlock(surface, selection)
  if (!block) return false
  const item = block.closest('li')
  const list = item?.parentElement
  const wanted = ordered ? 'OL' : 'UL'
  if (item && list?.tagName === wanted) { placeCaretAtStart(itemToParagraph(item, list)); return true }
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
  if (itemContentEmpty(item)) return endEmptyItem(item, list)
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
  if (!next.textContent?.trim()) next.append(task ? placeholderBreak() : document.createElement('br'))
  item.after(next)
  // After the box, never before it: typed text must land in the item's content.
  if (task) placeCaretAfterTaskBox(next); else placeCaretAtStart(next)
  return true
}

/** An empty-line break the source conversion drops, so an empty task item is not a hard break. */
function placeholderBreak(): HTMLBRElement {
  const br = document.createElement('br'); br.setAttribute('data-carve-placeholder', ''); return br
}

function placeCaretAfterTaskBox(item: HTMLLIElement): void {
  const space = item.firstChild?.nextSibling
  const range = document.createRange()
  if (space?.nodeType === 3 && space.textContent?.startsWith(' ')) range.setStart(space, 1)
  else range.setStart(item, 1)
  range.collapse(true)
  const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
}

/** A toggled `[>]`/`[-]`/`[?]` item becomes a plain done/open task, not an attribute. */
function clearTaskState(checkbox: HTMLInputElement): void {
  checkbox.closest('li')?.removeAttribute('data-task-state')
}

export function toggleVisualTask(surface: HTMLElement, checkbox: HTMLInputElement): boolean {
  if (checkbox.type !== 'checkbox' || !surface.contains(checkbox) || !checkbox.closest('li')) return false
  checkbox.toggleAttribute('checked', checkbox.checked)
  clearTaskState(checkbox)
  return true
}

export function toggleVisualTaskAtSelection(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const item = activeListItem(surface, selection)
  if (item) {
    const existing = Array.from(item.children).find((child) => child instanceof HTMLInputElement && child.type === 'checkbox') as HTMLInputElement | undefined
    if (existing) { existing.checked = !existing.checked; existing.toggleAttribute('checked', existing.checked); clearTaskState(existing); return true }
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Toggle task'); item.prepend(checkbox, ' '); return true
  }
  const block = activeBlock(surface, selection); if (!block || block.tagName === 'LI') return false
  const list = document.createElement('ul'); const created = document.createElement('li'); const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Toggle task'); created.append(checkbox, ' ')
  while (block.firstChild) created.append(block.firstChild)
  list.append(created); block.replaceWith(list); placeCaretAtEnd(created); return true
}

/** Enter (or Backspace) on an empty item: outdent it, or end the list with an empty paragraph. */
function endEmptyItem(item: HTMLLIElement, list: HTMLElement): boolean {
  const parentItem = list.parentElement?.closest<HTMLLIElement>('li')
  if (parentItem) { parentItem.after(item); if (!list.children.length) list.remove(); placeCaretAtStart(item); return true }
  // Nested items stay, as a list after the new paragraph.
  const nested = directList(item)
  const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); list.after(paragraph, ...(nested ? [nested] : [])); item.remove(); if (!list.children.length) list.remove(); placeCaretAtStart(paragraph); return true
}

/** Turn a list item into a paragraph where it stands, splitting the list around it. */
function itemToParagraph(item: HTMLLIElement, list: HTMLElement): HTMLParagraphElement {
  const descendants = directList(item); descendants?.remove()
  const paragraph = document.createElement('p'); while (item.firstChild) paragraph.append(item.firstChild)
  const before = document.createElement(list.tagName.toLowerCase())
  const after = document.createElement(list.tagName.toLowerCase())
  let passed = false
  for (const sibling of Array.from(list.children)) {
    if (sibling === item) { passed = true; continue }
    ;(passed ? after : before).append(sibling)
  }
  if (descendants?.tagName === after.tagName) { while (after.firstChild) descendants.append(after.firstChild) }
  list.replaceWith(...(before.children.length ? [before] : []), paragraph, ...(descendants ? [descendants] : []), ...(after.children.length ? [after] : []))
  return paragraph
}

/** The checkbox that makes `item` a task: its first child, ignoring whitespace. */
function taskCheckbox(item: HTMLLIElement): HTMLInputElement | null {
  for (const child of Array.from(item.childNodes)) {
    if (child.nodeType === 3 && !(child.textContent ?? '').trim()) continue
    return child instanceof HTMLInputElement && child.type === 'checkbox' ? child : null
  }
  return null
}

/** Where a task's text starts: after the box and the one space that follows it. */
function taskTextStart(box: HTMLInputElement): { node: Node; offset: number } {
  const next = box.nextSibling
  if (next?.nodeType === 3 && next.textContent?.startsWith(' ')) return { node: next, offset: 1 }
  return { node: box.parentNode!, offset: Array.prototype.indexOf.call(box.parentNode!.childNodes, box) + 1 }
}

/** The task item whose box a collapsed caret sits on or left of, with where its text starts. */
function caretBeforeTaskText(surface: HTMLElement, selection: Selection | null): { item: HTMLLIElement; box: HTMLInputElement; start: { node: Node; offset: number }; before: boolean } | null {
  const range = rangeIn(surface, selection)
  if (!range?.collapsed) return null
  const container = range.startContainer
  const element = container instanceof Element ? container : container.parentElement
  const item = element?.closest<HTMLLIElement>('li')
  if (!item || !surface.contains(item)) return null
  const box = taskCheckbox(item)
  if (!box) return null
  const start = taskTextStart(box)
  const probe = document.createRange(); probe.setStart(start.node, start.offset); probe.collapse(true)
  const order = probe.comparePoint(container, range.startOffset)
  if (order < 0) return { item, box, start, before: true }
  // Inside a leading `<strong>` and the like, offset 0 is still where the text starts.
  probe.setEnd(container, range.startOffset)
  return order === 0 || !probe.toString() ? { item, box, start, before: false } : null
}

function setCaret(node: Node, offset: number, selection: Selection | null): void {
  const range = document.createRange(); range.setStart(node, offset); range.collapse(true)
  selection?.removeAllRanges(); selection?.addRange(range)
}

/**
 * A caret never sits on or left of a task checkbox: a click there, Home, or an
 * arrow landing at the line start puts it where the task's text starts.
 */
export function normalizeVisualTaskCaret(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const found = caretBeforeTaskText(surface, selection)
  if (!found?.before) return false
  setCaret(found.start.node, found.start.offset, selection)
  return true
}

/** The end of the last text before `node` in the surface, ignoring whitespace between blocks. */
function previousTextEnd(surface: HTMLElement, node: Node): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(surface, 4)
  let last: Text | null = null
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.compareDocumentPosition(node) & 4 && (current.textContent ?? '').trim()) last = current as Text
  }
  return last ? { node: last, offset: last.length } : null
}

/**
 * Home and ArrowLeft around a task box, as in Obsidian: Home goes to where the
 * text starts, ArrowLeft from there to the end of the line above. True when handled.
 */
export function visualTaskCaretKey(surface: HTMLElement, key: string, selection: Selection | null = document.getSelection()): boolean {
  if (key !== 'Home' && key !== 'ArrowLeft') return false
  if (key === 'Home') {
    const range = rangeIn(surface, selection)
    const element = range?.startContainer instanceof Element ? range.startContainer : range?.startContainer.parentElement
    const item = element?.closest<HTMLLIElement>('li')
    const box = item && surface.contains(item) ? taskCheckbox(item) : null
    if (!range?.collapsed || !box || directList(item!)?.contains(range.startContainer)) return false
    const start = taskTextStart(box); setCaret(start.node, start.offset, selection); return true
  }
  const found = caretBeforeTaskText(surface, selection)
  if (!found) return false
  const previous = previousTextEnd(surface, found.box)
  if (previous) setCaret(previous.node, previous.offset, selection)
  else setCaret(found.start.node, found.start.offset, selection)
  return true
}

/** A task item with no text, holding a collapsed caret (outside its nested list). */
function emptyTaskAtCaret(surface: HTMLElement, selection: Selection | null): HTMLLIElement | null {
  const range = rangeIn(surface, selection)
  if (!range?.collapsed) return null
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const item = element?.closest<HTMLLIElement>('li')
  return item && surface.contains(item) && taskCheckbox(item) && itemContentEmpty(item) ? item : null
}

/**
 * Backspace at the start of a task's text removes the box and the bullet together:
 * the text becomes a paragraph where the item stood. An empty task ends the list,
 * like Enter on it.
 */
export function backspaceVisualTask(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  const empty = emptyTaskAtCaret(surface, selection)
  if (empty?.parentElement && /^(?:UL|OL)$/.test(empty.parentElement.tagName)) return endEmptyItem(empty, empty.parentElement)
  const found = caretBeforeTaskText(surface, selection)
  const list = found?.item.parentElement
  if (!found || !list || !/^(?:UL|OL)$/.test(list.tagName)) return false
  const space = found.box.nextSibling
  if (space?.nodeType === 3 && space.textContent?.startsWith(' ')) { space.textContent = space.textContent.slice(1); if (!space.textContent) space.remove() }
  found.box.remove()
  found.item.removeAttribute('data-task-state')
  placeCaretAtStart(itemToParagraph(found.item, list))
  return true
}

/** Backspace at an item boundary mirrors mature outline editors. */
export function backspaceVisualListItem(surface: HTMLElement, selection: Selection | null = document.getSelection()): boolean {
  if (backspaceVisualTask(surface, selection)) return true
  const item = activeListItem(surface, selection); const range = rangeIn(surface, selection)
  if (!item || !range?.collapsed) return false
  const before = range.cloneRange(); before.selectNodeContents(item); before.setEnd(range.startContainer, range.startOffset)
  const prefix = before.cloneContents()
  for (const child of Array.from(prefix.querySelectorAll('input,br,ul,ol'))) child.remove()
  if ((prefix.textContent ?? '').length) return false
  if (indentVisualListItem(surface, true, selection)) return true
  const previous = item.previousElementSibling as HTMLLIElement | null
  if (previous?.tagName === 'LI') {
    const nested = directList(previous); const ownNested = directList(item); ownNested?.remove(); const marker = document.createComment('caret')
    if (nested) previous.insertBefore(marker, nested); else previous.append(marker)
    while (item.firstChild) previous.insertBefore(item.firstChild, nested)
    if (ownNested) {
      if (nested?.tagName === ownNested.tagName) { while (ownNested.firstChild) nested.append(ownNested.firstChild) }
      else previous.append(ownNested)
    }
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
    if (element.tagName === 'A' && !safeVisualHref(element.getAttribute('href') ?? '')) element.removeAttribute('href')
  }
  range.deleteContents(); const tail = template.content.lastChild; range.insertNode(template.content)
  if (tail) { range.setStartAfter(tail); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range) }
  return true
}
