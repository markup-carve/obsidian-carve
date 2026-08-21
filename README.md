# Carve for Obsidian

An Obsidian community plugin for reading and editing `.crv` files with the
[Carve](https://markup-carve.github.io/carve/) markup language.

The plugin registers `.crv` as its own Obsidian view. Reading view renders the
document with `@markup-carve/carve`; Source view provides a plain-text editor
and saves through Obsidian's `TextFileView` lifecycle. Use the book and pencil
icons in the view header to switch modes.

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

This first release deliberately provides a reliable source editor and reading
view. It does not claim Live Preview syntax decorations, Obsidian wikilink
resolution, backlinks, embeds, or Properties integration: Obsidian's metadata
cache parses Markdown, not Carve, and pretending those surfaces work would
produce incomplete vault indexes.

## Verification

`npm run test:all` runs renderer/security tests, checks the plugin against the
current Obsidian TypeScript API, and produces the bundled `main.js` artifact.
Interactive host testing still requires loading the bundle in Obsidian.

## License

MIT
