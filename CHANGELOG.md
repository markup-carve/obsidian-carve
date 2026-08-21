# Changelog

## Unreleased

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
