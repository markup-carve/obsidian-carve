import { parse as parseCarve, type BlockNode, type InlineNode } from '@markup-carve/carve'
import { parse as parseYaml } from 'yaml'
import { parse as parseToml } from 'smol-toml'

export interface CarveHeading { level: number; text: string; line: number; id?: string }
export interface CarveLink { target: string; label: string; embed: boolean }
export interface CarveMetadata {
  headings: CarveHeading[]
  links: CarveLink[]
  tags: string[]
  properties: Record<string, unknown>
}

const inlineText = (nodes: InlineNode[]): string => nodes.map((node) => {
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('content' in node && typeof node.content === 'string') return node.content
  if ('children' in node && Array.isArray(node.children)) return inlineText(node.children)
  return ''
}).join('')

function walkBlocks(nodes: BlockNode[], headings: CarveHeading[]): void {
  for (const node of nodes) {
    if (node.type === 'heading') headings.push({ level: node.level, text: inlineText(node.children), line: node.pos?.startLine ?? 1, id: node.attrs?.id })
    if ('children' in node && Array.isArray(node.children)) {
      const children = node.children as unknown[]
      if (children.some((child) => typeof child === 'object' && child !== null && 'type' in child)) walkBlocks(children as BlockNode[], headings)
    }
    if (node.type === 'list') for (const item of node.items) walkBlocks(item.children, headings)
  }
}

export function extractMetadata(source: string): CarveMetadata {
  const document = parseCarve(source, { positions: true })
  const headings: CarveHeading[] = []
  walkBlocks(document.children, headings)
  const links: CarveLink[] = []
  for (const match of source.matchAll(/(!?)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)) {
    const target = match[2]?.trim()
    if (target) links.push({ target, label: match[3]?.trim() || target, embed: match[1] === '!' })
  }
  const tags = [...new Set([...source.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((match) => match[1]).filter(Boolean) as string[])]
  let properties: Record<string, unknown> = {}
  if (document.frontmatter) {
    try {
      const parsed = document.frontmatter.format === 'yaml' ? parseYaml(document.frontmatter.content)
        : document.frontmatter.format === 'toml' ? parseToml(document.frontmatter.content)
          : document.frontmatter.format === 'json' ? JSON.parse(document.frontmatter.content || '{}') : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) properties = parsed as Record<string, unknown>
      else properties = { format: document.frontmatter.format, raw: document.frontmatter.content }
    } catch { properties = { format: document.frontmatter.format, raw: document.frontmatter.content, parseError: true } }
  }
  return { headings, links, tags, properties }
}

export function withCrvExtension(target: string): string {
  const hash = target.indexOf('#')
  const path = hash === -1 ? target : target.slice(0, hash)
  const fragment = hash === -1 ? '' : target.slice(hash)
  return `${/\.[a-z0-9]+$/i.test(path) ? path : `${path}.crv`}${fragment}`
}
