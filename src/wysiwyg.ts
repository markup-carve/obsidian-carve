import { carveToAstJson, htmlToCarve } from '@markup-carve/carve'
import { renderCarve } from './render.js'

export interface VisualDocument {
  frontmatter: string
  body: string
  html: string
  canonicalBody: string
  canonicalizes: boolean
  semanticLoss: boolean
  diagnostics: string[]
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
  const html = renderCarve(body)
  const converted = htmlToCarve(html, { mode: 'safe' })
  const beforeSemantics = semanticJson(body)
  const afterSemantics = semanticJson(converted.value)
  return {
    frontmatter,
    body,
    html,
    canonicalBody: converted.value,
    canonicalizes: converted.value !== body,
    semanticLoss: beforeSemantics === null || afterSemantics === null || beforeSemantics !== afterSemantics,
    diagnostics: diagnosticMessages(converted.report),
  }
}

export function visualHtmlToSource(html: string, frontmatter = ''): { source: string; diagnostics: string[] } {
  const cleanHtml = html.replace(/<br\s+data-carve-placeholder(?:="")?\s*\/?\s*>/gi, '')
  const converted = htmlToCarve(cleanHtml, { mode: 'safe' })
  return { source: `${frontmatter}${converted.value}`, diagnostics: diagnosticMessages(converted.report) }
}
