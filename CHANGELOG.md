# Changelog

## Unreleased

- Highlight code blocks in the reading view through Obsidian's own bundled
  Prism, so a fence takes the active theme's token colors. `carve` and `crv`
  fences use the Prism grammar from carve-grammars, and a `{.diff}` fence keeps
  its language tokens beside the added and removed markers (#41, #42).

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
