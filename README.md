# Carve for Obsidian

An Obsidian community plugin for reading and editing `.crv` files with the
[Carve](https://markup-carve.github.io/carve/) markup language.

The plugin registers `.crv` as its own Obsidian view and provides four modes:

- **Reading** renders the document with `@markup-carve/carve`.
- **Source** uses a full CodeMirror 6 editor with Carve highlighting, line
  numbers, search, history, selections, and standard editing keys.
- **Live split** keeps the CodeMirror source and rendered document side by side
  and refreshes the preview as you type.
- **Visual (experimental)** edits rendered prose directly and imports each
  change through Carve's safe HTML importer.

Use the book, pencil, and columns icons in the view header, or the matching
`Carve: Open … view` commands.

Visual mode tests WYSIWYG behavior in detail: headings, paragraphs, emphasis,
links, quotes, lists, paste, native selection, and undo work directly in the
rendered surface. Frontmatter bytes remain outside the editable DOM, conversion
warnings are visible, and **Revert source** discards the whole visual session.
Because HTML import canonicalizes some advanced Carve-only constructs, Source
and Live split remain the lossless modes.

### Visual-mode boundary

| Behavior | Current result |
| --- | --- |
| Plain text, headings, emphasis, quotes, lists, and ordinary links | Editable and saved as Carve |
| Browser selection, typing, paste, and undo | Remain native while the visual surface is open |
| YAML, TOML, or JSON frontmatter | Kept byte-for-byte outside the editable surface |
| Tables | Editable, then written in Carve's canonical table spelling |
| Code blocks | Protected with the current Carve importer; an upstream newline round-trip fix is pending |
| Wikilinks, embeds, tags, admonitions, footnotes, and custom attributes | Visual editing is locked because rendered HTML cannot preserve every semantic |
| Raw HTML | Remains disabled on the vault rendering path |

The visual toolbar goes beyond default Markdown prose controls with underline,
strikethrough, highlight, superscript, subscript, all six heading levels,
inline and block code, link removal, horizontal rules, and formatting reset.
Tables have their own contextual toolbar: insert a chosen `rows × columns`
size, add a row or column before/after the selected cell, delete either axis,
toggle header cells, edit the caption, undo structural operations, or press Tab
in the last cell to append a row. Ambiguous column edits are disabled for
merged-cell tables rather than guessing at span geometry. Empty rows and cells
retain a visible editing height and caret target before any content is entered;
their editor-only placeholders never enter the `.crv` file.

The plugin compares position-free ASTs before enabling the editor. When the
round-trip changes semantics, the surface stays read-only unless the user
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
