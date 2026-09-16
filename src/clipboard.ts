/**
 * Two representations of one document on the clipboard (issue 25).
 *
 * `text/plain` carries the flattened document, which means the same thing
 * wherever it lands. The author's document rides alongside under the type
 * ruled in markup-carve/carve#2050, with its directives respelled from the
 * vault root so a paste into another folder still names the same files.
 */
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { directiveSites } from './include-navigation.js'
import { resolveVaultPath } from './includes.js'

/** Chromium only carries a custom type as a web custom format, prefix included. */
export const CARVE_CLIPBOARD_TYPE = 'web text/x-carve'

/** A directive's path token, in each spelling spec I1 allows. */
const PATH_TOKEN = /^(\{\{\s+)(?:"(?:\\.|[^"\\])*"|\u201c[^\u201d]*\u201d|[^#@}\s"\u201c]+)/
const BARE_PATH = /^[^#@}\s"\u201c]+$/

function spellPath(path: string): string {
  return BARE_PATH.test(path) ? path : `"${path.replace(/[\\"]/g, '\\$&')}"`
}

/**
 * Respell every live directive in `source` from the vault root.
 *
 * A directive already spelled from the root, or climbing out of the vault, is
 * left as written.
 */
export function rebaseDirectives(source: string, sourcePath: string): { text: string; rebased: number } {
  let text = ''
  let at = 0
  let rebased = 0
  for (const site of directiveSites(source)) {
    const target = resolveVaultPath(site.path, sourcePath)
    if (target === null) continue
    const raw = source.slice(site.from, site.to)
    const respelled = raw.replace(PATH_TOKEN, (_all, open: string) => `${open}${spellPath(`/${target}`)}`)
    if (respelled === raw) continue
    text += source.slice(at, site.from) + respelled
    at = site.to
    rebased++
  }
  return { text: text + source.slice(at), rebased }
}

export interface CarveClipboardPayload {
  /** The flattened document. */
  plain: string
  /** The author's document, directives respelled from the vault root. */
  carve: string
}

/** What a copy has to put on the clipboard for `sourcePath`. */
export function carveClipboardPayload(source: string, sourcePath: string, flattened: string): CarveClipboardPayload {
  return { plain: flattened, carve: rebaseDirectives(source, sourcePath).text }
}

/** The async clipboard, narrowed to what copy and paste use. */
export interface ClipboardLike {
  write(items: ClipboardItem[]): Promise<void>
  writeText(text: string): Promise<void>
  read?(): Promise<ClipboardItems>
}

export type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem

/**
 * Put both representations on the clipboard, or only the flattened one where
 * the Carve type cannot be carried.
 *
 * Chromium constructs an item with a type it refuses and only rejects at
 * `write`, so the write is awaited before anything counts as copied. A
 * rejection there falls back to the plain text; a rejection of that is thrown.
 */
export async function writeCarveClipboard(
  clipboard: ClipboardLike,
  payload: CarveClipboardPayload,
  options: { rich: boolean; ClipboardItem?: ClipboardItemConstructor },
): Promise<'carve' | 'plain'> {
  const Item = options.ClipboardItem
  if (options.rich && Item) {
    try {
      await clipboard.write([new Item({
        'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
        [CARVE_CLIPBOARD_TYPE]: new Blob([payload.carve], { type: CARVE_CLIPBOARD_TYPE }),
      })])
      return 'carve'
    } catch {
      // Fall through to the plain text, which is what every platform carries.
    }
  }
  await clipboard.writeText(payload.plain)
  return 'plain'
}

const normalizeBreaks = (text: string): string => text.replace(/\r\n?/g, '\n')

/**
 * The text a paste should insert: the Carve flavor when the clipboard carries
 * one whose plain half is the text being pasted, otherwise that text.
 *
 * Matching the plain half is what keeps a stale or foreign Carve flavor from
 * replacing what the user actually copied.
 */
export async function pickPasteText(items: ClipboardItems, plain: string): Promise<string> {
  for (const item of items) {
    if (!item.types.includes(CARVE_CLIPBOARD_TYPE) || !item.types.includes('text/plain')) continue
    const itemPlain = await (await item.getType('text/plain')).text()
    if (normalizeBreaks(itemPlain) !== normalizeBreaks(plain)) continue
    return (await item.getType(CARVE_CLIPBOARD_TYPE)).text()
  }
  return plain
}

/**
 * Paste the Carve flavor into a source editor when the clipboard has one.
 *
 * A paste event's `clipboardData` does not expose web custom formats, so the
 * clipboard is read asynchronously and the chosen text is pasted again as a
 * plain paste. That second event goes through CodeMirror's own handler, so
 * linewise and per-cursor pasting behave as they do for any other text.
 */
export function carveClipboardPaste(clipboard: () => ClipboardLike | undefined): Extension {
  const redispatched = new WeakSet<Event>()
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (redispatched.has(event)) return false
      const board = clipboard()
      const data = event.clipboardData
      // An empty flattened document is still a Carve copy, so presence counts, not length.
      if (!board?.read || !data || ![...data.types].includes('text/plain')) return false
      const plain = data.getData('text/plain')
      event.preventDefault()
      const win = view.contentDOM.ownerDocument.defaultView ?? window
      void board.read().then((items: ClipboardItems) => pickPasteText(items, plain)).catch(() => plain).then((text: string) => {
        const chosen = new win.DataTransfer()
        chosen.setData('text/plain', text)
        const replay = new win.ClipboardEvent('paste', { clipboardData: chosen, bubbles: true, cancelable: true })
        redispatched.add(replay)
        view.contentDOM.dispatchEvent(replay)
      })
      return true
    },
  })
}
