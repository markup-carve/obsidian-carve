/**
 * Whether the split preview should keep its last render while the author types
 * a new list item. A marker with nothing after it is paragraph text, so `- `
 * typed under a list folds into the item above for one keystroke.
 */
import { BULLET_MARKER, ORDERED_MARKER, TASK_BOX_MARKER, codeBlockLines } from './editor-commands.js'

// Unlike the Tab/Enter commands, a marker still waiting for its space counts:
// `-` folds into the item above just like `- `.
const BARE_MARKER = new RegExp(
  String.raw`^[ \t]*(?:>[ \t]*)*(?:${BULLET_MARKER}(?:[ \t]+${TASK_BOX_MARKER})?|${ORDERED_MARKER})[ \t]*$`,
)

/** Whether a line holds only a list marker (and, for a bullet, a task box). */
export function isBareListMarker(line: string): boolean {
  return BARE_MARKER.test(line)
}

/** Whether a render should wait while the cursor is on zero-based `line` of `source`. */
export function shouldHoldRender(source: string, line: number): boolean {
  const lines = source.split(/\r\n|\r|\n/)
  if (line < 0 || line >= lines.length || !isBareListMarker(lines[line]!)) return false
  const code = codeBlockLines(source)
  return code !== null && !code.has(line)
}
