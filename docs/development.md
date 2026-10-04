# Development

## Install for development

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into
`.obsidian/plugins/carve/` in a test vault, then enable **Carve** under Community
plugins.

## Verification

`npm run test:all` runs renderer, metadata, wikilink, and security tests, checks
the plugin against the current Obsidian TypeScript API, and produces the
bundled `main.js` artifact. The example is also exercised interactively in a
disposable Obsidian vault before release.

## Upstream drift

`node scripts/check-upstream-drift.mjs` installs the ranges declared in
`package.json` into a throwaway directory with no lockfile, then compares what
npm picked against what `package-lock.json` pins. It exits non-zero on a
disagreement and prints the `npm update --package-lock-only` line that closes
it. Point it at another lockfile with `DRIFT_LOCK` to reproduce a past state.
With `DRIFT_REPORT` set to a file it appends the drift there and exits zero.

The `Upstream drift` workflow runs it daily, not on pull requests, so an
upstream release cannot block a merge here; pull requests are gated by the
locked `test (20)` and `test (22)` from `ci.yml`. When nothing drifted, the
scheduled run also runs `npm run test:all` against the freshly resolved tree.
Drift opens or updates a lock-refresh pull request from
`automation/revendor-lockfile` instead of failing the run. That needs the
`BUMP_TOKEN` repository secret, a fine-grained token, because a pull request
opened with the default token does not trigger CI.
