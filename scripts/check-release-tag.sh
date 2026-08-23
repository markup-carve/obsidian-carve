#!/usr/bin/env bash
# Verify that a release tag agrees with everything Obsidian reads.
#
# Obsidian resolves a plugin release by matching the GitHub tag against the
# `version` field in manifest.json, and it reads minAppVersion out of
# versions.json. Neither lookup reports a mismatch: the release simply never
# appears in the plugin browser. So the mismatch has to be caught here, at tag
# time, where it is still a red workflow instead of a silent non-release.
#
# Usage: scripts/check-release-tag.sh <tag> [repo-root]
set -euo pipefail

TAG="${1:?usage: check-release-tag.sh <tag> [repo-root]}"
ROOT="${2:-.}"

fail() {
  # ::error:: is picked up by Actions; it is harmless noise on a local run.
  echo "::error::$1" >&2
  exit 1
}

# An Obsidian plugin tag carries NO `v` prefix. A `v0.1.0` tag builds and
# uploads perfectly and is invisible to every Obsidian client, which is the
# single most common way one of these releases ships broken. The workflow
# triggers on the v-prefixed shape as well precisely so this line can reject
# it out loud rather than letting the push do nothing at all.
case "$TAG" in
  v*) fail "Tag '$TAG' carries a 'v' prefix. Obsidian matches the tag against manifest.json verbatim, so a v-prefixed release is invisible. Tag '${TAG#v}' instead." ;;
esac

[[ "$TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "Tag '$TAG' is not a MAJOR.MINOR.PATCH version."

manifest_version="$(jq -r '.version' "$ROOT/manifest.json")"
[ "$manifest_version" = "$TAG" ] \
  || fail "manifest.json version is '$manifest_version' but the tag is '$TAG'. Obsidian would never resolve this release."

package_version="$(jq -r '.version' "$ROOT/package.json")"
[ "$package_version" = "$TAG" ] \
  || fail "package.json version is '$package_version' but the tag is '$TAG'."

# versions.json maps plugin version to the minimum Obsidian version. A release
# missing from that map installs on app versions it was never built for.
min_app="$(jq -r --arg t "$TAG" '.[$t] // empty' "$ROOT/versions.json")"
[ -n "$min_app" ] \
  || fail "versions.json has no entry for '$TAG'. Add \"$TAG\": \"<minAppVersion>\" before tagging."

manifest_min_app="$(jq -r '.minAppVersion' "$ROOT/manifest.json")"
[ "$min_app" = "$manifest_min_app" ] \
  || fail "versions.json maps '$TAG' to minAppVersion '$min_app' but manifest.json declares '$manifest_min_app'."

grep -qE "^## \[?${TAG//./\\.}\]?" "$ROOT/CHANGELOG.md" \
  || fail "CHANGELOG.md has no '## $TAG' section. Cut it before tagging."

echo "Tag $TAG agrees with manifest.json, package.json, versions.json (minAppVersion $min_app), and CHANGELOG.md."
