import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const guard = fileURLToPath(new URL('../scripts/no-git-dependencies.mjs', import.meta.url))
const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
const committed = JSON.parse(readFileSync(manifestPath, 'utf8'))
const isGitPin = (spec) => /^(github|git|git\+[a-z+]+):/.test(spec)
// The committed manifest may pin upstream commits; the rows below start from
// the same manifest with every pin swapped for a registry version.
const baseline = { ...committed, dependencies: Object.fromEntries(Object.entries(committed.dependencies).map(([name, spec]) => [name, isGitPin(spec) ? '0.1.15' : spec])) }
const scratch = mkdtempSync(join(tmpdir(), 'obsidian-carve-guard-'))

function runGuard(manifest) {
  const path = join(scratch, 'package.json')
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8')
  const run = spawnSync(process.execPath, [guard, path], { encoding: 'utf8' })
  assert.equal(run.error, undefined)
  assert.notEqual(run.status, null, 'the guard was killed by a signal')
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

const withDep = (spec) => ({ ...baseline, dependencies: { ...baseline.dependencies, '@markup-carve/carve': spec } })

const rows = [
  ['a github: pin', 'github:markup-carve/carve-js#99ad0d2a4e5ec192440c3e5a1b4b95f50ed3cfcf', 'reject'],
  ['a git+https:// pin', 'git+https://github.com/markup-carve/carve-js.git#99ad0d2', 'reject'],
  ['the bare owner/repo shorthand', 'markup-carve/carve-js#99ad0d2', 'reject'],
  ['an alias onto a git spec', 'npm:github:markup-carve/carve-js', 'reject'],
  ['an exact version', '0.1.15', 'accept'],
  ['a caret range', '^0.1.15', 'accept'],
  ['a registry alias', 'npm:@markup-carve/carve@0.1.15', 'accept'],
]

for (const [label, spec, verdict] of rows) {
  test(`publish guard ${verdict}s ${label}`, () => {
    const { status, out } = runGuard(withDep(spec))
    if (verdict === 'accept') {
      assert.equal(status, 0, out)
      return
    }
    assert.notEqual(status, 0, `the guard passed ${spec}`)
    assert.ok(out.includes(`dependencies.@markup-carve/carve -> ${spec}`), out)
  })
}

test('publish guard leaves devDependencies alone', () => {
  const { status, out } = runGuard({ ...baseline, devDependencies: { ...baseline.devDependencies, x: 'github:someone/x#abc' } })
  assert.equal(status, 0, out)
})

// main may carry a git pin of a merged upstream commit between releases; the
// guard then has to refuse it, which is what the release run would do.
test('publish guard verdict on the committed manifest matches its git pins', () => {
  const pinned = Object.values({ ...committed.dependencies, ...committed.optionalDependencies, ...committed.peerDependencies }).some(isGitPin)
  const run = spawnSync(process.execPath, [guard, manifestPath], { encoding: 'utf8' })
  assert.equal(run.status === 0, !pinned, `${run.stdout}${run.stderr}`)
})

test('the release gate runs the publish guard and CI does not', () => {
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  const guardJob = release.slice(release.indexOf('\n  guard:'), release.indexOf('\n  release:'))
  assert.ok(guardJob.includes('node scripts/no-git-dependencies.mjs'), 'the release guard job does not call the script')
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.ok(!ci.includes('no-git-dependencies'), 'ci.yml must accept a git pin of merged upstream')
})
