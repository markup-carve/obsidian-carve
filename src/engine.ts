import { parse, type DocumentNode } from '@markup-carve/carve'

/**
 * Translate a UTF-8 byte offset into a UTF-16 one.
 *
 * Carve 0.2 positions count UTF-8 BYTES (C2-A-027); every offset on this side
 * - a CodeMirror selection head, a `String.prototype.slice` - counts UTF-16
 * units. An ASCII-only source cannot differ, so the walk is skipped.
 */
export function byteToUtf16(source: string): (offset: number) => number {
  // eslint-disable-next-line no-control-regex
  if (!/[^\u0000-\u007f]/.test(source)) return (offset) => Math.min(Math.max(offset, 0), source.length)
  const units: number[] = []
  for (let index = 0; index < source.length;) {
    const code = source.codePointAt(index) as number
    const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    for (let byte = 0; byte < bytes; byte++) units.push(index)
    index += code > 0xffff ? 2 : 1
  }
  units.push(source.length)
  return (offset) => units[Math.min(Math.max(offset, 0), units.length - 1)] as number
}

/**
 * One node of the tree with its source range in UTF-16 units: the shape the
 * 0.1 editor session handed out, rebuilt from a positioned 0.2 parse (0.2 has
 * no incremental session; `UPGRADING.md` "parse again").
 *
 * `path` is the node's RFC 6901 pointer, so a list item is `/children/1/children/0`.
 * `tokens` holds the trailing `{...}` attribute of an inline node, the one
 * source token the editor surfaces still read.
 */
export interface MappedToken { role: 'attribute'; start: number; end: number }
export interface MappedNode { path: string; type: string; start: number; end: number; tokens: MappedToken[]; node: Record<string, unknown> }

/** The positioned tree of `source`, every node flattened in document order. */
export function mappedNodes(source: string, document?: DocumentNode): MappedNode[] {
  const tree = document ?? parse(source, { positions: true })
  const toUtf16 = byteToUtf16(source)
  const nodes: MappedNode[] = []
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown> & { type?: unknown; pos?: { startOffset?: number; endOffset?: number; file?: string } }
    const pos = record.pos
    if (typeof record.type === 'string' && record.type !== 'document' && pos?.startOffset !== undefined && pos.endOffset !== undefined && pos.file === undefined) {
      const start = toUtf16(pos.startOffset)
      const end = toUtf16(pos.endOffset)
      nodes.push({ path, type: record.type, start, end, tokens: attributeTokens(source, record, start, end), node: record })
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'pos' || key === 'attrs' || key === 'data') continue
      if (Array.isArray(child)) child.forEach((item, index) => walk(item, `${path}/${key}/${index}`))
      else if (child !== null && typeof child === 'object' && typeof (child as { type?: unknown }).type === 'string') walk(child, `${path}/${key}`)
    }
  }
  walk(tree, '')
  return nodes
}

// An inline node's range covers its trailing `{...}` attribute; a block's does not.
function attributeTokens(source: string, record: Record<string, unknown>, start: number, end: number): MappedToken[] {
  if (record.attrs === undefined || end <= start || source[end - 1] !== '}') return []
  const open = source.lastIndexOf('{', end - 1)
  if (open <= start) return []
  return [{ role: 'attribute', start: open, end }]
}
