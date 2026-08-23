import { carveToAstJson, createEditorSession, htmlToCarve } from '@markup-carve/carve'
import { renderCarve } from './render.js'

export interface VisualDocument {
  frontmatter: string
  body: string
  html: string
  canonicalBody: string
  canonicalizes: boolean
  semanticLoss: boolean
  diagnostics: string[]
  opaque: readonly OpaqueConstruct[]
}

export interface OpaqueConstruct { token: string; source: string; label: string; kind: string }

const OPAQUE_TYPES = new Set(['admonition', 'div', 'line_block', 'footnote', 'footnote_ref', 'inline_footnote', 'abbreviation_def', 'abbreviation', 'comment', 'insert', 'delete', 'substitution', 'critic_comment', 'raw_inline', 'tag', 'mention', 'math'])
const OPAQUE_BLOCKS = new Set(['admonition', 'div', 'line_block', 'footnote', 'abbreviation_def'])
function opaqueBlock(item: Pick<OpaqueConstruct, 'kind' | 'source'>): boolean { return OPAQUE_BLOCKS.has(item.kind) || item.kind === 'mermaid' || (item.kind === 'math' && item.source.includes('\n')) }

function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function opaqueLabel(kind: string, authored: string): string {
  const summary = authored.replace(/\s+/g, ' ').trim().slice(0, 60)
  return `${kind.replace(/_/g, ' ')}${summary ? ` · ${summary}` : ''}`
}

export function updateOpaqueConstruct(opaque: readonly OpaqueConstruct[], index: number, source: string): OpaqueConstruct | null {
  const item = opaque[index]
  if (!item) return null
  item.source = source
  item.label = opaqueLabel(item.kind, source)
  return item
}

export type OpaquePrompt = (label: string, value: string) => string | null
export function editOpaqueWithPrompts(item: OpaqueConstruct, prompt: OpaquePrompt): string | null {
  const one = (label: string, value: string, build: (next: string) => string): string | null => { const next = prompt(label, value); return next === null ? null : build(next) }
  if (item.kind === 'tag' || item.kind === 'mention') return one(item.kind === 'tag' ? 'Tag' : 'Mention', item.source.slice(1), (value) => `${item.source[0]}${value.replace(/^[@#]/, '')}`)
  if (item.kind === 'inline_footnote') return one('Inline footnote', item.source.slice(2, -1), (value) => `^[${value}]`)
  if (item.kind === 'footnote') {
    const trailing = item.source.endsWith('\n') ? '\n' : ''; const match = /^\[\^([^\]]+)\]:\s*([\s\S]*?)\n?$/.exec(item.source)
    if (match) { const label = prompt('Footnote label', match[1]!); if (label === null) return null; const body = prompt('Footnote body', match[2]!); return body === null ? null : `[^${label}]: ${body}${trailing}` }
  }
  if (item.kind === 'math') {
    const match = /^(\$+`)([\s\S]*)(`)$/.exec(item.source)
    if (match) return one('Math expression', match[2]!, (value) => `${match[1]}${value}${match[3]}`)
  }
  if (item.kind === 'wikilink' || item.kind === 'embed') {
    const match = /^(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(item.source)
    if (match) {
      const target = prompt('Note target', match[2]!); if (target === null) return null
      const label = prompt('Display label (empty uses target)', match[3] ?? ''); if (label === null) return null
      return `${match[1]}[[${target}${label ? `|${label}` : ''}]]`
    }
  }
  if (item.kind === 'mermaid') {
    const match = /^(`{3,})[ \t]*mermaid[^\n]*\n([\s\S]*?)\n\1\n?$/.exec(item.source)
    if (match) return one('Mermaid diagram source', match[2]!, (value) => `${match[1]}mermaid\n${value}\n${match[1]}`)
  }
  if (item.kind === 'raw_inline') {
    const match = /^`([\s\S]*)`\{=([^}]+)\}$/.exec(item.source)
    if (match) { const value = prompt('Raw value', match[1]!); if (value === null) return null; const format = prompt('Raw format', match[2]!); return format === null ? null : `\`${value}\`{=${format}}` }
  }
  if (item.kind === 'substitution') {
    const match = /^\{~([\s\S]*)~>([\s\S]*)~\}$/.exec(item.source)
    if (match) { const old = prompt('Original text', match[1]!); if (old === null) return null; const next = prompt('Replacement text', match[2]!); return next === null ? null : `{~${old}~>${next}~}` }
  }
  const critic: Record<string, [string, string, string]> = { insert: ['Inserted text', '{+', '+}'], delete: ['Deleted text', '{-', '-}'], critic_comment: ['Review comment', '{#', '#}'], comment: ['Comment', '{%', '%}'] }
  const criticShape = critic[item.kind]
  if (criticShape && item.source.startsWith(criticShape[1]) && item.source.endsWith(criticShape[2])) return one(criticShape[0], item.source.slice(2, -2), (value) => `${criticShape[1]}${value}${criticShape[2]}`)
  if (item.kind === 'admonition') {
    const match = /^:::\s+(\S+)(?:\s+"([^"]*)")?\n([\s\S]*)\n:::$/.exec(item.source)
    if (match) {
      const type = prompt('Callout type', match[1]!); if (type === null) return null
      const title = prompt('Callout title', match[2] ?? ''); if (title === null) return null
      const body = prompt('Callout body', match[3]!); return body === null ? null : `::: ${type}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''}\n${body}\n:::`
    }
  }
  return prompt('Exact Carve source', item.source)
}

export function renderOpaqueConstruct(item: OpaqueConstruct): string {
  const rendered = renderCarve(item.source).trim()
  if (!rendered || !rendered.replace(/<[^>]*>/g, '').trim()) return `<code>${escapeHtml(item.label)}</code>`
  if (!opaqueBlock(item)) {
    const paragraph = /^<p>([\s\S]*)<\/p>$/.exec(rendered)
    if (paragraph) return paragraph[1]!
  }
  return rendered
}

function protectAdvanced(source: string): { source: string; opaque: OpaqueConstruct[] } {
  const nodes = createEditorSession(source).snapshot().nodes
  const candidates: Array<{ start: number; end: number; type: string }> = []
  for (const node of nodes) {
    if (node.type && OPAQUE_TYPES.has(node.type)) candidates.push({ start: node.start, end: node.end, type: node.type })
    if (node.type === 'code_block' && /^`{3,}[ \t]*mermaid\b/i.test(source.slice(node.start, node.end))) candidates.push({ start: node.start, end: node.end, type: 'mermaid' })
    for (const token of node.tokens) if (token.role === 'attribute') candidates.push({ start: token.start, end: token.end, type: 'attributes' })
    if (node.type === 'text') for (const match of source.slice(node.start, node.end).matchAll(/!?\[\[[^\]]+\]\]/g)) candidates.push({ start: node.start + match.index!, end: node.start + match.index! + match[0].length, type: match[0].startsWith('!') ? 'embed' : 'wikilink' })
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end)
  const selected: typeof candidates = []
  for (const candidate of candidates) {
    const previous = selected.at(-1)
    if (previous && candidate.start < previous.end) continue
    selected.push(candidate)
  }
  const opaque: OpaqueConstruct[] = selected.map((range, index) => {
    let token = `CARVEOPAQUE${index}X9F3A`
    while (source.includes(token)) token += 'X'
    const authored = source.slice(range.start, range.end)
    return { token, source: authored, kind: range.type, label: opaqueLabel(range.type, authored) }
  })
  let protectedSource = source
  for (let index = selected.length - 1; index >= 0; index--) {
    const authored = opaque[index]!.source
    protectedSource = protectedSource.slice(0, selected[index]!.start) + opaque[index]!.token + (authored.endsWith('\n') ? '\n' : '') + protectedSource.slice(selected[index]!.end)
  }
  return { source: protectedSource, opaque }
}

function restoreAdvanced(source: string, opaque: readonly OpaqueConstruct[]): string {
  for (const item of opaque) {
    if (item.kind === 'attributes') source = source.split(`${item.token}\n\n`).join(`${item.source}\n`)
    else if (item.source.endsWith('\n')) source = source.split(`${item.token}\n\n`).join(`${item.source}\n`)
    source = source.split(item.token).join(item.source)
  }
  return source
}

function semanticJson(source: string): string | null {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean)
    if (!value || typeof value !== 'object') return value
    const nodeType = 'type' in value ? value.type : undefined
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'pos' && key !== 'srcByteLength' && !(nodeType === 'thematic_break' && key === 'marker')).map(([key, child]) => [key, clean(child)]))
  }
  try { return JSON.stringify(clean(carveToAstJson(source))) } catch { return null }
}

function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  const opening = source.match(/^(---(?:yaml|toml|json)?\r?\n)/)
  if (!opening) return { frontmatter: '', body: source }
  const closing = /(?:^|\n)---(?:\r?\n|$)/g
  closing.lastIndex = opening[0].length
  const match = closing.exec(source)
  if (!match) return { frontmatter: '', body: source }
  const end = match.index + match[0].length
  return { frontmatter: source.slice(0, end), body: source.slice(end) }
}

function diagnosticMessages(report: unknown): string[] {
  if (!report || typeof report !== 'object' || !('diagnostics' in report) || !Array.isArray(report.diagnostics)) return []
  return report.diagnostics.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && 'message' in item) return String(item.message)
    return JSON.stringify(item)
  })
}

export function sourceToVisualDocument(source: string): VisualDocument {
  const { frontmatter, body } = splitFrontmatter(source)
  const protectedBody = protectAdvanced(body)
  let html = renderCarve(protectedBody.source)
  for (const [index, item] of protectedBody.opaque.entries()) html = html.split(item.token).join(`<carve-opaque class="carve-visual-opaque ${opaqueBlock(item) ? 'is-block' : 'is-inline'}" data-carve-opaque="${index}" contenteditable="false" role="button" tabindex="0" title="Edit this Carve construct">${renderOpaqueConstruct(item)}</carve-opaque>`)
  const converted = htmlToCarve(normalizeVisualHtml(html, protectedBody.opaque), { mode: 'safe' })
  const beforeSemantics = semanticJson(body)
  const canonicalBody = restoreAdvanced(converted.value, protectedBody.opaque)
  const afterSemantics = semanticJson(canonicalBody)
  return {
    frontmatter,
    body,
    html,
    canonicalBody,
    canonicalizes: canonicalBody !== body,
    semanticLoss: beforeSemantics === null || afterSemantics === null || beforeSemantics !== afterSemantics,
    diagnostics: diagnosticMessages(converted.report),
    opaque: protectedBody.opaque,
  }
}

export function visualHtmlToSource(html: string, frontmatter = '', opaque: readonly OpaqueConstruct[] = []): { source: string; diagnostics: string[] } {
  const cleanHtml = normalizeVisualHtml(html, opaque)
  const converted = htmlToCarve(cleanHtml, { mode: 'safe' })
  return { source: `${frontmatter}${restoreAdvanced(converted.value, opaque)}`, diagnostics: diagnosticMessages(converted.report) }
}

/** Browser empty blocks represent spacing, not authored hard breaks. */
export function normalizeVisualHtml(html: string, opaque: readonly OpaqueConstruct[] = []): string {
  html = html.replace(/<carve-opaque\b[^>]*data-carve-opaque="(\d+)"[^>]*>[\s\S]*?<\/carve-opaque>/gi, (_whole, rawIndex: string) => opaque[Number(rawIndex)]?.token ?? '')
  return html
    .replace(/<section(?:\s[^>]*)?>/gi, '')
    .replace(/<\/section\s*>/gi, '')
    .replace(/<br\s+data-carve-placeholder(?:="")?\s*\/?\s*>/gi, '')
    .replace(/<(p|div)(?:\s[^>]*)?>\s*(?:<br(?:\s[^>]*)?\/?\s*>\s*)*<\/\1>/gi, '')
}
