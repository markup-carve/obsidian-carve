// A code fence line, after any quote markers and indent.
const FENCE_LINE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})(.*)$/

/** Start of the line opening a code fence that is still open at `until`, or null. */
export function openFenceBefore(source: string, until: number): number | null {
  let open: { start: number; char: string; length: number } | null = null
  for (let start = 0; start < until;) {
    let end = source.indexOf('\n', start)
    if (end === -1) end = source.length
    const fence = FENCE_LINE.exec(source.slice(start, end))
    if (fence) {
      const run = fence[1] as string
      const rest = fence[2] as string
      if (open) { if (run[0] === open.char && run.length >= open.length && rest.trim() === '') open = null }
      else if (!(run[0] === '`' && rest.includes('`'))) open = { start, char: run[0] as string, length: run.length }
    }
    start = end + 1
  }
  return open?.start ?? null
}
