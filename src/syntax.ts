import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, type StreamParser } from '@codemirror/language'
import { tags } from '@lezer/highlight'

interface CarveState { frontmatter: boolean; fence: string | null }

const parser: StreamParser<CarveState> = {
  startState: () => ({ frontmatter: false, fence: null }),
  token(stream, state) {
    if (stream.sol()) {
      if (stream.match(/^---(?:yaml|toml|json)?\s*$/)) {
        state.frontmatter = !state.frontmatter
        return 'meta'
      }
      if (state.frontmatter) { stream.skipToEnd(); return 'propertyName' }
      const fence = stream.match(/^(`{3,}|~{3,})/)
      if (fence) { state.fence = state.fence ? null : stream.current()[0]; stream.skipToEnd(); return 'string' }
      if (state.fence) { stream.skipToEnd(); return 'string' }
      if (stream.match(/^#{1,6}(?=\s)/)) { stream.skipToEnd(); return 'heading' }
      if (stream.match(/^\s*(?:[-*]|\d+[.)])(?=\s)/)) return 'list'
      if (stream.match(/^\s*>/)) return 'quote'
      if (stream.match(/^:{3,}/)) { stream.skipToEnd(); return 'keyword' }
      if (stream.match(/^\|=?/)) return 'separator'
    }
    if (stream.match(/!\[\[[^\]]+\]\]/)) return 'link'
    if (stream.match(/\[\[[^\]]+\]\]/)) return 'link'
    if (stream.match(/!?\[[^\]]*\]\([^)]*\)/)) return 'link'
    if (stream.match(/`[^`]*`/)) return 'monospace'
    if (stream.match(/\*[^*\n]+\*/)) return 'strong'
    if (stream.match(/\/[^/\n]+\//)) return 'emphasis'
    if (stream.match(/_[^_\n]+_/)) return 'underline'
    if (stream.match(/~[^~\n]+~/)) return 'strikethrough'
    if (stream.match(/#[\p{L}\p{N}_/-]+/u)) return 'tagName'
    stream.next()
    return null
  },
  tokenTable: {
    heading: tags.heading,
    list: tags.list,
    quote: tags.quote,
    link: tags.link,
    underline: tags.special(tags.content),
    strikethrough: tags.strikethrough,
    tagName: tags.labelName,
  },
}

export const carveLanguage = StreamLanguage.define(parser)
export const carveHighlighting = syntaxHighlighting(defaultHighlightStyle, { fallback: true })
