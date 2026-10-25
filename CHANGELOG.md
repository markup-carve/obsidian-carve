# Changelog

## 0.1.6

Progress and blocked tasks keep their state while editing, and source highlighting follows the current grammar scopes.

### Fixes

- Typed task markers, Live Preview, and visual editing preserve progress `[/]`, blocked `[!]`, and open alias `[_]` states (#91).

### Improvements

- Source highlighting distinguishes progress and blocked task markers and table roles (#93).

**Full Changelog**: https://github.com/markup-carve/obsidian-carve/compare/0.1.5...0.1.6

## 0.1.5

Visual list editing keeps semantic blocks intact, and source highlighting follows the current grammar scopes.

### Fixes

- Leaving a visual list preserves its semantic blocks instead of flattening their content (#86).

### Improvements

- Source highlighting follows carve-grammars 0.1.19 scopes (#81).
- Reading, Live Preview, and syntax highlighting follow Carve 0.1.14 and carve-grammars 0.1.20 (#88).

**Full Changelog**: https://github.com/markup-carve/obsidian-carve/compare/0.1.4...0.1.5

## 0.1.4

- Typing `+ ` in the visual editor no longer turns the line into a bullet:
  `+` is Carve's continuation marker, not a list marker (#77).
- One Carve engine, 0.1.13, serves the reading view, Live Preview and the
  editor helpers, with Carve 0.1.11 syntax: a lone `+` at a nested item's own
  marker column, `>+` read as text, code-block includes with `@region` and
  `@code`, and `{table}` above a `csv` or `tsv` include. Before, the preview
  ran 0.1.11 while the bundled carve-lsp and carve-grammars ran 0.1.12.
- Bundle carve-grammars 0.1.18 and carve-lsp 0.1.14 (#75, #76, #79, #80). The
  source editor colors a `+` as the continuation marker only where Carve 0.1.11
  attaches it, and Tab and Shift+Tab keep a continuation marker on the moved
  item's marker column.

## 0.1.3

- Enter and Tab in the source editor follow carve-lsp's on-type rules. Enter
  at the start of `- a` no longer writes `- - a`; Enter continues lists in
  quotes, after attributed markers, in footnotes and in description lists,
  continues plain quote lines, and writes code and colon fence closers. Tab
  nests a list item inside a quote. Enter on an empty item now leaves the
  caret on a new line below the cleared marker, as carve-lsp does, and a lone
  `- ` with no list to end is left alone (#73).
- Live Preview stays responsive on long notes: above 40,000 characters it
  parses a window around the viewport instead of the whole note, and a caret
  move redraws only the visible lines. Enter on a line nothing can continue
  no longer parses the note (#73).
- Highlight the source editor with carve-grammars' Prism grammar, the one the
  reading view already uses for `carve` fences, instead of a hand-written
  tokenizer. A thematic break mid-note no longer paints the rest of the note
  as front matter, a line of `[` or `[a](` no longer freezes the editor, and
  fences, quotes, list items, escapes, intraword delimiters, comments, mark,
  braced super- and subscript, definition lists, attribute lines and
  CriticMarkup highlight the way the engine reads them. Colors follow the
  theme, and only the visible part of a large note is tokenized (#71).
- Render a wikilink whose target holds spaces or parentheses as a link:
  `[[My Note]]` and `[[Note (draft)]]` rendered as literal text in the reading
  view. The destination is percent-encoded and decoded again on click (#69).
- Leave wiki syntax alone inside code spans, fences, comments, math and after
  a backslash escape: `` `[[Note]]` `` and `\[[Note]]` were turned into links.
  The same rule now decides which wikilinks and tags the vault index records,
  so a tag or wikilink in code, a comment or front matter no longer shows up
  in the inspector or in backlinks. Tags follow the engine's tag syntax (#69).
- A link destination with a malformed percent sequence such as `50%off` no
  longer throws on click or aborts the reading view while resolving an
  embed (#69).
- Tab and Shift+Tab nest list items at the parent's content column (#63).
- Split preview holds its last render while the cursor sits on an unfinished list marker (#65).
- Visual task checkboxes are clickable, Backspace removes task markers cleanly, and headings keep their size under the cursor (#67). Obsidian 1.14 uses one CodeMirror state, restoring arrow and Home/End behavior (#68).
- Live Preview styles continued table cells and keeps block marker line breaks intact. The browser engine moves to carve 0.1.11, preserving empty table rows, recognizing compact include selectors, and reporting include id renames under the current warning code (#70).
- Source highlighting moves to carve-grammars 0.1.15: escaped punctuation
  stays literal, and an unclosed code fence ends at its container's closer
  (#72, #74).

## 0.1.2

- Read a quote at document text contrast in the previews. A quote body used
  muted text and a faint border, and a quote caption sat outside the text
  inset; the body now takes normal text color with a stronger border, and a
  caption aligns with the quote body. Paragraph gaps inside a quote are kept
  and the trailing gap is trimmed (#56).
- Highlight code blocks in the reading view through Obsidian's own bundled
  Prism, so a fence takes the active theme's token colors. `carve` and `crv`
  fences use the Prism grammar from carve-grammars, and a `{.diff}` fence keeps
  its language tokens beside the added and removed markers (#41, #42).
- Highlight an include directive as one token in Live Preview, so a section
  selector is no longer painted as an Obsidian tag: `{{ frag.crv #Alpha }}`
  showed `#Alpha` in tag colors. Every spelling of the selector and option
  slots is covered, because the rule takes the whole `{{ ... }}` span rather
  than reaching inside it (#53).
- Requires `@markup-carve/carve` 0.1.10. Cross-references now compare case
  exactly: `</#plan>` against a heading `{#Plan}` rendered a working link to
  `#Plan` before and renders as literal text now, as does a collapsed
  `[plan][]` against a heading `Plan`. A note that relied on case-insensitive
  cross-references loses those links rather than following them to the
  differently-cased heading, so fix the case when upgrading (#53).

## 0.1.1

- Expand `{{ path }}` include directives in the reading view, on by default.
  The expanded document renders through the same extension pipeline as any
  other, and a relative link in an included file resolves against that file's
  folder (#20, #22, #30).
- Open the file an include directive names with ctrl/cmd-click or
  `Carve: Open the included file`, and open the file that expanded content came
  from with the same gesture in the reading view (#23).
- Export or copy a document with every include expanded, or export a bundle
  folder holding the document and every file it includes. Wikilinks from an
  included file are rebased where the rewrite is unambiguous (#27, #28, #32).
- Copying a single document also puts the author's own document on the
  clipboard as `web text/x-carve`, and pasting it back into a Carve editor
  inserts that version (#33).
- Show `{.diff}` language fences with added and removed lines in reading and
  split previews (#34).
- Split a substitution at the arrow the engine splits it at, instead of the
  last arrow anywhere in the pair. The plugin now runs on the released Carve
  engine 0.1.7, which drops an all-empty table row on import with a
  diagnostic (#36).

## 0.1.0

First release. The plugin registers `.crv` as its own Obsidian view with four
modes: Reading, Source, Live split, and an experimental Visual mode.

- Add `.crv` source and reading views for Obsidian.
- Replace the source textarea with a highlighted CodeMirror 6 editor, and add
  live split editing, toolbar actions, and command-palette mode switching (#1).
- Add vault integration: wikilinks, recursive embeds, YAML/TOML/JSON
  properties, tags, outline, backlinks, and indexed Carve search (#1).
- Style the reading, split, inspector, callout, and embed surfaces with
  Obsidian theme variables and responsive layouts (#1).
- Add an experimental Visual mode backed by Carve's safe HTML importer, with
  frontmatter preservation, conversion warnings, and a source-revert escape
  hatch (#2).
- Lock visual editing when an HTML import would change document semantics
  instead of silently normalizing advanced constructs (#2).
- Keep index refreshes from destroying active editor selections and undo
  state (#2).
- Expand visual formatting beyond default Markdown and add contextual table
  creation, row and column insertion and deletion, header toggles, captions,
  structural undo, Tab navigation, dimension bounds, and merged-cell
  guards (#3).
- Keep newly inserted empty table cells tall, clickable, and caret-visible,
  with editor-only placeholders stripped before the Carve source is saved (#4).
- Treat browser-generated empty visual rows as ordinary block spacing instead
  of semantic hard breaks; intentional breaks inside non-empty paragraphs
  remain intact (#5).
- Add source-authoritative Live Preview for headings and inline emphasis, so
  syntax markers hide away from the cursor and reveal where they can be
  edited (#6).
- Extend Live Preview to images, footnotes, inline and block math, fenced
  containers, figure captions, wikilinks, embeds, tags, mentions, raw inline,
  comments, CriticMarkup, list and task markers, links, simple table cells,
  code blocks, and attribute badges (#7).
- Keep typing responsive by mapping decorations through transactions;
  documents above 250,000 UTF-16 units keep ordinary source highlighting rather
  than blocking on a full parse (#7).
- Add source-native formatting commands and a toolbar for strong, emphasis,
  strikethrough, inline code, links, paragraphs, headings, highlight, lists,
  quotes, fenced code, and horizontal rules, editing only delimiter and
  line-prefix ranges so they stay in CodeMirror's undo history (#7).
- Add source-native table row and column commands, including protected
  deletion; ambiguous escaped or ragged grids are refused rather than
  mangled (#7).
- Render lazy image previews for resolved local, remote, and wiki-embed
  destinations; unresolved destinations keep an accessible badge (#7).
- Sort visual table body rows by the active column and align complete columns
  left, center, or right while preserving headers and caret focus (#7).
- Keep advanced Carve constructs as visible, byte-exact islands so surrounding
  content stays editable in Visual mode (#8).
- Make Visual mode the rich editing surface: Markdown-style block input rules,
  explicit Range and DOM formatting, editor-owned undo and redo, and in-place
  Obsidian math and Mermaid rendering (#9).
- Simplify Live split to conventional highlighted source beside its rendered
  preview; in-place semantic decoration stays exclusive to Source mode (#9).
- Make Tab, Shift+Tab, and Enter list-aware in Visual, Source, and Live split
  modes, covering nesting, outdenting, numbered and task continuation,
  multi-row indentation, and empty-item exit (#10).
- Harden Visual mode as a structured editor: sibling-preserving list
  conversion, caret-aware list splitting, joining, and outdenting, clickable
  tasks, selection-restoring undo and redo, collapsed-caret formatting, active
  toolbar state, sanitized rich paste, and IME-aware input (#11).
- Unify table changes with document history, add boundary feedback and
  Ctrl/Cmd+Arrow cell navigation, and replace double-click prompt chains for
  advanced constructs with a multiline editor and live preview (#11).
- Add no-syntax task creation and toggling, direct math, Mermaid, callout, and
  footnote insertion, horizontal-rule and code-block input rules, heading and
  list shortcuts, cell-adjacent table insertion controls, and Shift-click
  rectangular cell selection with batch clearing (#12).
- Preserve multi-block selections and nested-list children, add Source and
  Split task toggling, keep consecutive styled typing in one semantic run,
  validate link schemes while retaining vault-relative links, copy rectangular
  cells as TSV, open inserted constructs directly in their live editor, and
  strengthen focus, ARIA, and history states (#13).
