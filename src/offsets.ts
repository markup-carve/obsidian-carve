/**
 * Translate a codepoint offset into a UTF-16 one.
 *
 * The engine's positions count CODEPOINTS; every offset on this side - a
 * CodeMirror selection head, a `String.prototype.slice` - counts UTF-16 units.
 * The two agree until a document holds one astral character, and from there
 * every offset after it is off by one unit per emoji. A source with no high
 * surrogate in it cannot differ, so the walk is skipped entirely.
 */
export function codepointToUtf16(source: string): (offset: number) => number {
  if (!/[\uD800-\uDBFF]/.test(source)) return (offset) => offset
  const units: number[] = []
  for (let index = 0; index < source.length;) {
    units.push(index)
    index += (source.codePointAt(index) as number) > 0xffff ? 2 : 1
  }
  units.push(source.length)
  return (offset) => units[Math.min(Math.max(offset, 0), units.length - 1)] as number
}
