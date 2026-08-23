# Changelog

- Add source-native formatting toolbar and keyboard commands for strong, emphasis, strikethrough, inline code, links, paragraphs, and H1-H3. Commands edit only delimiter/line-prefix ranges and remain in CodeMirror undo history.
- Add source-native row-before/after and column-before/after commands for simple pipe tables; ambiguous escaped/ragged grids are conservatively refused.
- Add protected row/column deletion plus bullet, task, quote, fenced-code, and horizontal-rule source commands.
- Render actual lazy image previews for resolved local/remote image destinations and wiki embeds; unresolved destinations retain an accessible badge.
- Add all heading levels, highlight, numbered lists, table creation, callout insertion, visible command refusal, and lossless visual row/column movement.
- Sort visual table body rows ascending or descending by the active column while preserving headers and caret focus.

- Extend source Live Preview to list/task markers, links, simple table cells, fenced code blocks, and attached attribute badges.
- Keep typing responsive by mapping existing decorations through transactions and rebuilding semantic presentation after 120 ms idle; documents above 250,000 UTF-16 units retain normal source highlighting without a blocking full parse.
- Add source-authoritative presentations for images, footnote references and definitions, fenced containers, figure captions, and inline/block math.
- Present authored comments and CriticMarkup insertions, deletions, substitutions, and comments with semantic styling and cursor reveal.
- Present mapped tags, mentions, and raw-inline payloads without hiding their source while active.
- Present Obsidian-owned wikilinks and embeds from exact mapped text ranges, revealing their original syntax at the cursor.

- Add source-authoritative Live Preview for headings and inline emphasis, backed by carve-js editor snapshots. Syntax markers hide away from the cursor and reveal for editing.

## Unreleased

- Treat browser-generated empty visual rows as ordinary block spacing instead
  of writing semantic `\` hard-break lines; intentional breaks inside non-empty
  paragraphs remain intact.
- Keep newly inserted empty table cells tall, clickable, and caret-visible with
  editor-only placeholders that are stripped before saving Carve source.
- Expand visual formatting beyond default Markdown and add contextual table
  creation, row/column insertion and deletion, header toggles, captions,
  structural undo, Tab navigation, dimension bounds, and merged-cell guards.
- Add an experimental visual editor backed by Carve's safe HTML importer, with
  formatting controls, native undo, frontmatter preservation, conversion
  warnings, and a source-revert escape hatch.
- Compare position-free ASTs and lock visual editing when HTML import would
  change document semantics; never silently normalize advanced constructs.
- Keep index refreshes from destroying active editor selections and undo state.
- Replace the textarea with a highlighted CodeMirror 6 source editor.
- Add live split editing, toolbar actions, and command-palette mode switching.
- Add wikilinks, recursive embeds, YAML/TOML/JSON properties, tags, outline,
  backlinks, and indexed Carve search.
- Style reading, split, inspector, callout, and embed surfaces with Obsidian
  theme variables and responsive layouts.

## 0.1.0

- Initial `.crv` source and reading views for Obsidian.
