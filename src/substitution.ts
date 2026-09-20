import { createEditorSession } from '@markup-carve/carve'

interface Bounded { path: string; type?: string; start: number; end: number }

/**
 * A substitution splits at the FIRST TOP-LEVEL `~>` (carve#2083): an arrow
 * inside code, math, an inline literal or a comment is not one, and neither is
 * an escaped `\~>`. Scanning the authored text cannot see that, so the split
 * comes from the engine's own `old` and `new` child offsets instead.
 */
export function substitutionBounds(
  nodes: readonly Bounded[],
  node: Bounded,
): { oldStart: number; oldEnd: number; newStart: number; newEnd: number } {
  const under = (half: string): readonly Bounded[] => {
    const prefix = `${node.path}/${half}/`
    return nodes.filter((candidate) => candidate.path.startsWith(prefix)
      && !candidate.path.slice(prefix.length).includes('/'))
  }
  const olds = under('old')
  const news = under('new')
  const oldStart = node.start + 2
  const newEnd = node.end - 2
  return {
    oldStart,
    oldEnd: olds.length > 0 ? olds[olds.length - 1]!.end : oldStart,
    newStart: news.length > 0 ? news[0]!.start : newEnd,
    newEnd,
  }
}

/** The two halves of a standalone `{~ … ~}` source, or null when it holds no top-level arrow. */
export function substitutionHalves(source: string): { old: string; new: string } | null {
  const nodes: readonly Bounded[] = createEditorSession(source).snapshot().nodes
  const node = nodes.find((candidate) => candidate.type === 'substitution'
    && candidate.start === 0 && candidate.end === source.length)
  if (!node) return null
  const bounds = substitutionBounds(nodes, node)
  return { old: source.slice(bounds.oldStart, bounds.oldEnd), new: source.slice(bounds.newStart, bounds.newEnd) }
}
