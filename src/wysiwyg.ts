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

const OPAQUE_TYPES = new Set(['admonition', 'div', 'line_block', 'footnote', 'footnote_ref', 'inline_footnote', 'abbreviation_def', 'abbreviation', 'comment', 'insert', 'delete', 'substitution', 'critic_comment', 'raw_inline', 'tag', 'mention'])

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

function protectAdvanced(source: string): { source: string; opaque: OpaqueConstruct[] } {
  const nodes = createEditorSession(source).snapshot().nodes
  const candidates: Array<{ start: number; end: number; type: string }> = []
  for (const node of nodes) {
    if (node.type && OPAQUE_TYPES.has(node.type)) candidates.push({ start: node.start, end: node.end, type: node.type })
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
  for (const [index, item] of protectedBody.opaque.entries()) html = html.split(item.token).join(`<span class="carve-visual-opaque" data-carve-opaque="${index}" contenteditable="false" role="button" tabindex="0" title="Edit exact Carve source">${escapeHtml(item.label)}</span>`)
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
  html = html.replace(/<span\b[^>]*data-carve-opaque="(\d+)"[^>]*>[\s\S]*?<\/span>/gi, (_whole, rawIndex: string) => opaque[Number(rawIndex)]?.token ?? '')
  return html
    .replace(/<section(?:\s[^>]*)?>/gi, '')
    .replace(/<\/section\s*>/gi, '')
    .replace(/<br\s+data-carve-placeholder(?:="")?\s*\/?\s*>/gi, '')
    .replace(/<(p|div)(?:\s[^>]*)?>\s*(?:<br(?:\s[^>]*)?\/?\s*>\s*)*<\/\1>/gi, '')
}
