# Carve for Obsidian

An Obsidian community plugin for reading and editing `.crv` files with the
[Carve](https://markup-carve.github.io/carve/) markup language.

The plugin registers `.crv` as its own Obsidian view and provides four modes:

- **Reading** renders the document with `@markup-carve/carve`.
- **Source** uses a full CodeMirror 6 editor with Carve highlighting, line
  numbers, search, history, selections, standard editing keys, and semantic
  Live Preview. Authored markers hide away from the cursor and reappear exactly
  where they can be edited.
- **Live split** keeps the CodeMirror source and rendered document side by side
  and refreshes the preview as you type. Its source pane deliberately remains a
  conventional highlighted editor because the adjacent pane supplies the
  visual feedback.
- **Visual (experimental)** edits rendered prose directly and imports each
  change through Carve's safe HTML importer.

Use the book, pencil, and columns icons in the view header, or the matching
`Carve: Open … view` commands.

Visual mode tests WYSIWYG behavior in detail: headings, paragraphs, emphasis,
links, quotes, lists, paste, selection, and undo work directly in the rendered
surface. Typing `### `, a list marker, or `> ` at the start of a paragraph
immediately creates the corresponding rendered block. Frontmatter bytes remain outside the editable DOM, conversion
warnings are visible, and **Revert source** discards the whole visual session.
Advanced constructs remain lossless through protected rendered nodes.

### Visual-mode boundary

| Behavior | Current result |
| --- | --- |
| Plain text, headings, emphasis, quotes, lists, and ordinary links | Editable and saved as Carve |
| Selection, typing, paste, formatting, and undo | Use explicit Range/DOM operations and editor-owned history; no deprecated browser editing commands |
| YAML, TOML, or JSON frontmatter | Kept byte-for-byte outside the editable surface |
| Tables | Editable, then written in Carve's canonical table spelling |
| Code blocks | Editable and round-tripped losslessly, including their trailing lines |
| Wikilinks, embeds, tags, admonitions, footnotes, comments, CriticMarkup, raw inline, abbreviations, and custom attributes | Rendered in place and preserved byte-for-byte while surrounding content remains editable; double-click or press Enter for structured/exact editing |
| Math and Mermaid | Rendered in the visual surface by Obsidian while their Carve source remains byte-exact |
| Raw HTML | Remains disabled on the vault rendering path |

The visual toolbar goes beyond default Markdown prose controls with underline,
strikethrough, highlight, superscript, subscript, all six heading levels,
inline and block code, link removal, horizontal rules, and formatting reset.
Tables have their own contextual toolbar: insert a chosen `rows × columns`
size, add a row or column before/after the selected cell, delete either axis,
toggle individual, row, or column headers, edit the caption, use document undo for structural operations, or press Tab
in the last cell to append a row. Rows and columns can also be moved in either
direction without copying cell contents, body rows can be sorted by the active
column in either direction, and whole columns can be aligned left, center, or
right. Ambiguous column edits are disabled for
merged-cell tables rather than guessing at span geometry. Empty rows and cells
retain a visible editing height and caret target before any content is entered;
their editor-only placeholders never enter the `.crv` file.

Visual mode is designed to require less syntax knowledge than a core Markdown
editor. A task can be created or toggled with the **Task** button or
Ctrl/Cmd+Enter; headings use Ctrl/Cmd+Alt+1–6; numbered and bulleted lists use
Ctrl/Cmd+Shift+7/8; and typing `--- ` or `` ``` `` followed by a space creates
the rendered horizontal rule or code block immediately. Math, Mermaid diagrams,
callouts, and footnotes have direct insertion buttons and open as rendered,
lossless constructs rather than exposed delimiter text.
Ctrl/Cmd+Enter provides the same task creation/toggle workflow in Source and
Live split modes, so switching to a lossless source surface does not sacrifice
the high-frequency keyboard action.

When a table cell is active, four compact insertion controls appear beside it
for rows and columns in either direction. Shift-click selects a rectangular cell
range, **Clear cells** applies to the complete selection, Ctrl/Cmd+Arrow moves
between cells, **Copy cells** exports the selection as spreadsheet-ready TSV,
Tab appends from the final cell, and structural actions remain in
the same selection-restoring document history. These operations do not require
editing pipe syntax or maintaining column delimiters manually.

Visual formatting is implemented with Selection, Range, and explicit DOM
transformations rather than deprecated `execCommand` behavior. The editor owns
its undo/redo snapshots, including toolbar actions and Markdown-style input
rules, and restores the authored selection with each snapshot. Inline formats
show their active state and can be enabled at a collapsed caret before typing.
HTML paste passes through a conservative semantic allowlist instead of letting
the browser inject arbitrary presentation markup.

List keyboard behavior is consistent across modes. In Visual mode, Tab and
Shift+Tab nest or unnest the active item, Enter creates the next item (including
an unchecked task box), Enter in the middle splits at the caret, Backspace at
the boundary joins or outdents, and Enter on an empty item exits or outdents the
list. Task boxes are directly clickable and save their checked state.
Source and Live split apply the equivalent operations to authored indentation
and continue bullet, numbered, and task markers; selected source rows indent as
a group.

Source mode exposes the same common writing operations without leaving the
lossless editor: all six heading levels; strong, emphasis, strike, highlight,
inline and fenced code; links; bullet, numbered, and task lists; quotes;
callouts; horizontal rules; table creation; and row/column insertion or deletion
on either side of the cursor. Invalid table operations give visible feedback.
Resolved local and remote images render lazily in place while their exact source
syntax remains available at the cursor.

The plugin uses positioned editor ranges to isolate constructs that HTML cannot
round-trip. Those constructs remain visible as atomic protected islands while
surrounding content stays editable, and their exact authored bytes are restored
before saving. Double-clicking one opens a multiline exact-source editor with a
live rendered preview; Enter retains the concise construct-aware field editor.
It then compares position-free ASTs before enabling the editor.
When the remaining round-trip changes semantics, the surface stays read-only unless the user
explicitly chooses **Enable lossy editing**; **Revert source** remains available
for that session. A fully lossless WYSIWYG editor would patch positioned Carve
AST nodes back into their original source ranges instead of round-tripping the
whole body through HTML.

## Vault features

- `[[Note]]` and `[[Note|label]]` become navigable vault links.
- `![[Note]]` embeds and renders another Carve note, with a depth limit for
  cyclic documents.
- YAML, TOML, and JSON frontmatter appears in a Properties inspector.
- Carve tags and headings feed the Tags and Outline inspectors.
- A public-API-only Carve index updates on create, edit, rename, and delete;
  linked Carve notes appear under Backlinks.
- `Carve: Search files, headings, and tags` searches that index.
- Admonitions, embedded notes, tables, and the inspector use Obsidian theme
  variables and remain responsive on narrow/mobile layouts.

## Install for development

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into
`.obsidian/plugins/carve/` in a test vault, then enable **Carve** under Community
plugins.

## Security and scope

Raw HTML is disabled when rendering vault documents. Standard Carve URL
hardening remains active. The plugin is mobile-compatible and does not use
Node or Electron APIs at runtime.

Obsidian's public API does not let a plugin inject custom `.crv` records into
its Markdown metadata cache. Consequently Carve links do not appear in the
native Graph, core Backlinks pane, or every core global-search/refactoring
surface. The plugin supplies honest Carve-owned outline, backlinks, properties,
and search features instead of mutating private APIs or generating shadow
Markdown files.

## Verification

`npm run test:all` runs renderer, metadata, wikilink, and security tests, checks
the plugin against the current Obsidian TypeScript API, and produces the
bundled `main.js` artifact. The example is also exercised interactively in a
disposable Obsidian vault before release.

## License

MIT
