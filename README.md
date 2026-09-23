# Carve for Obsidian

An Obsidian community plugin for reading and editing `.crv` files with the
[Carve](https://markup-carve.github.io/carve/) markup language.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/markup-carve/obsidian-carve/releases/latest)
into `<vault>/.obsidian/plugins/carve/`, then enable **Carve** under Obsidian's
Community plugins settings.

The plugin works on mobile and uses no Node or Electron APIs.

## Editing modes

The plugin registers `.crv` as its own view and provides four modes:

- **Reading** renders the document with `@markup-carve/carve`.
- **Source** uses CodeMirror 6 with highlighting, search, history, and semantic
  Live Preview.
- **Live split** keeps source and rendered output side by side.
- **Visual (experimental)** edits rendered prose and imports each change
  through Carve's safe HTML importer.

Visual mode directly edits prose, headings, emphasis, links, lists, quotes,
tables, and code blocks. It inserts math, diagrams, callouts, and footnotes,
then edits them through protected nodes that retain their source bytes.

Switch modes with the book, pencil, and columns icons or the matching
`Carve: Open ... view` commands.

See the [visual editing reference](docs/reference.md#features) for the complete
toolbar, keyboard, table, paste, undo, and protected-node behavior.

## Vault integration

- Wikilinks navigate between Carve notes, and embeds render with a depth limit.
- Frontmatter appears in the plugin's Properties inspector.
- Tags and headings feed the plugin's Tags and Outline inspectors.
- A Carve index supports its Backlinks panel and search.
- Source and visual views use Obsidian theme variables and responsive layouts.

Raw HTML stays disabled on the vault rendering path.

Obsidian's Graph, core Backlinks pane, and global search do not index `.crv`
metadata; the plugin supplies its own views.

## Includes and export

The reading view expands contained `{{ path }}` includes by default, relative
to the current note. Disable this under **Expand includes in the reading view**.
Traversal outside the vault and include cycles are refused.

Three commands prepare documents for use elsewhere:

- **Copy as a single document** copies flattened Carve.
- **Export as a self-contained Carve file** writes one flattened document.
- **Export a bundle with every included file** preserves include boundaries.

The [includes reference](docs/reference.md#includes) documents path rewriting,
frontmatter handling, warnings, flattening, bundling, and copy/paste behavior.

## Security

The renderer applies Carve's URL and attribute hardening. Includes stay within
the vault, embedded notes have a depth limit, and visual paste passes through
a semantic allowlist. Review the [security and scope notes](docs/reference.md#security-and-scope)
before enabling the plugin for untrusted vault content.

## Development

Contributor setup and tests are in the
[development guide](docs/development.md).
