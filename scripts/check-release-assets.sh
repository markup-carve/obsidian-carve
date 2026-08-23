#!/usr/bin/env bash
# Verify the three files an Obsidian release has to carry as individual assets.
#
# Obsidian downloads main.js, manifest.json, and styles.css directly off the
# release. The auto-generated source zip is never used, so a release that
# carries only the zip looks complete on GitHub and installs nothing. main.js
# is a build artifact and is not in the repo tree, so an unbuilt or
# silently-empty bundle is the realistic failure here.
#
# Usage: scripts/check-release-assets.sh [repo-root]
set -euo pipefail

ROOT="${1:-.}"
missing=0

for asset in main.js manifest.json styles.css; do
  path="$ROOT/$asset"
  if [ ! -f "$path" ]; then
    echo "::error::Release asset $asset is missing. Obsidian installs the three assets directly; the source zip does not count." >&2
    missing=1
  elif [ ! -s "$path" ]; then
    echo "::error::Release asset $asset is empty." >&2
    missing=1
  else
    echo "$asset: $(wc -c < "$path") bytes"
  fi
done

exit "$missing"
