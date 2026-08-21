# Carve for Obsidian

An Obsidian community plugin for reading and editing `.crv` files with the
[Carve](https://markup-carve.github.io/carve/) markup language.

The plugin registers `.crv` as its own Obsidian view and provides three modes:

- **Reading** renders the document with `@markup-carve/carve`.
- **Source** uses a full CodeMirror 6 editor with Carve highlighting, line
  numbers, search, history, selections, and standard editing keys.
- **Live split** keeps the CodeMirror source and rendered document side by side
  and refreshes the preview as you type.

Use the book, pencil, and columns icons in the view header, or the matching
`Carve: Open … view` commands.

Live split is intentionally WYSIWYG-adjacent rather than a lossy
`contenteditable` façade: the source remains authoritative while every edit is
rendered immediately. True rich-text editing needs selection-preserving,
bidirectional Carve AST patches and is outside this plugin version.

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
