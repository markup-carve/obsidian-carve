/**
 * Whether the split preview should keep its last render while the author types
 * a new list item. A marker with nothing after it is paragraph text, so `- `
 * typed under a list folds into the item above for one keystroke.
 */
import type { EditorState } from '@codemirror/state'
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

/** The cursor line when it holds back the render, else null. */
export function heldCursorLine(state: EditorState): number | null {
  const line = state.doc.lineAt(state.selection.main.head).number - 1
  return shouldHoldRender(state.doc.toString(), line) ? line : null
}

/** What an editor update does to a held split preview: the line still held, and whether to render now. */
export function previewHoldUpdate(
  update: { docChanged: boolean; selectionSet: boolean; focusChanged: boolean; state: EditorState; view: { hasFocus: boolean } },
  heldLine: number | null,
): { heldLine: number | null; render: boolean } {
  if (update.docChanged) {
    const line = heldCursorLine(update.state)
    return { heldLine: line, render: line === null }
  }
  if (heldLine === null) return { heldLine, render: false }
  if (update.focusChanged && !update.view.hasFocus) return { heldLine: null, render: true }
  if (update.selectionSet && heldCursorLine(update.state) !== heldLine) return { heldLine: null, render: true }
  return { heldLine, render: false }
}
