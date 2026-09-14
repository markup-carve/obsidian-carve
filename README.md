# Carve for Obsidian

An Obsidian community plugin for reading and editing `.crv` files with the
[Carve](https://markup-carve.github.io/carve/) markup language.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/markup-carve/obsidian-carve/releases/latest)
into `<vault>/.obsidian/plugins/carve/`, then enable **Carve** under Obsidian's
Community plugins settings.

## Features

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

## Includes

The reading view expands `{{ path }}` include directives (PART 9 section 19),
replacing each one with the file it names.

- **On by default.** Turn it off under Settings, Community plugins, Carve,
  *Expand includes in the reading view*; the directive then renders as the text
  it is.
- **The vault is the containment root.** A path is resolved relative to the
  including document, `/path` is vault-root-relative, and a path that climbs
  out of the vault is refused and reported. Targets are read through the vault,
  so the process working directory is unreachable rather than merely rejected.
- **The path is used as written.** No extension is guessed, so a document
  previewed here and one rendered by `carve render` agree.
- **A change to an included file re-renders the preview.** Targets that failed
  to resolve are watched too, so creating a missing file lands immediately.
- **Warnings are shown, not swallowed.** An unresolved target, a cycle, a
  containment refusal, an exceeded depth or size budget appears above the
  document instead of leaving a real error looking like ordinary prose.
- Included content is rendered under the same rules as the document itself:
  raw HTML stays disabled.
- **A link resolves against the file that wrote it.** A child saying
  `[rel](foo.crv)` or `[[Sibling]]` opens the note beside the child, not beside
  the root document it was inlined into, and a link inside an embedded note
  resolves against that note. A destination that names its target without a
  folder - an absolute URL, `/vault-root`, a bare `#fragment` - is untouched.
- **Go to the file a directive names.** Ctrl/cmd-click an include directive in
  the source or split view, or run `Carve: Open the included file`, and the
  target opens. A target outside the vault or one that is not there says so in
  the same words the diagnostics above the document use, rather than doing
  nothing. A directive inside a code span or a fence is text, and the gesture
  agrees with the preview about that.
- **Go back to the file inlined content came from.** In the reading view,
  ctrl/cmd-click inside expanded content - or click it and run the same
  command - to open the file that wrote it. This covers a directive that
  stands as its own block, which is the usual way to write one; a directive
  expanded mid-sentence leaves no trace of its origin in the rendered
  document, so there is nothing there to jump from.

### Flatten: export and copy one self-contained document

Two commands write the open document back out as Carve with every include
inlined, which is what `carve flatten` does at the command line.

- `Carve: Copy as a single document` puts the flattened text on the clipboard.
- `Carve: Export as a self-contained Carve file` writes it into the vault
  beside the original, as `name.flat.crv`, stepping to `name.flat-2.crv` rather
  than overwriting a file already there.

Both read their targets through the vault and derive the destination from the
open file's own vault path, so the export is contained by construction.

Two consequences are reported when the command finishes, because neither is
visible in the result:

- **The output is canonical Carve.** Parent and children both go through the
  writer, so formatting is normalized rather than preserved. What the author
  wrote is left alone in one respect that matters here: wiki syntax is not
  rewritten, so a flattened document can be edited on in Obsidian.
- **Colliding ids are renamed.** An explicit heading id or footnote label a
  child shares with the parent is suffixed (`intro-2`, spec I5) so the
  flattened file renders exactly like the expanded original. The count is
  reported rather than left to be found in a published page.

Exporting a plain `.crv` from the file menu does **not** expand: writing a
document back as Carve has to return the author's document (spec I15), which is
why flattening is a separate, named action.

Not covered yet, each with a follow-up issue: exporting a bundle (the document
plus every file it pulls in), and carrying the author's document on the
clipboard alongside the flattened text under a Carve-specific type.

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

## Development

Contributor setup, testing, and maintenance notes are in the [development guide](docs/development.md).
