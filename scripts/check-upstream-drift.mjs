#!/usr/bin/env node
// Resolves every declared range fresh, with the lockfile out of the picture,
// and compares what npm picks against what the committed lockfile pins.
//
// The two numbers come from two different places on purpose. LOCKED is read
// from the committed package-lock.json; RESOLVED is read from each installed
// package's own package.json inside a throwaway tree that never saw a lock. A
// check that derived both from one file could never disagree with itself.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = process.env.DRIFT_LOCK || join(repoRoot, 'package-lock.json');

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

const declared = new Map();
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, range] of Object.entries(pkg[field] || {})) {
    declared.set(name, { range, field });
  }
}
if (pkg.overrides) {
  console.log(`note: package.json carries overrides: ${JSON.stringify(pkg.overrides)}`);
}

const work = mkdtempSync(join(tmpdir(), 'carve-drift-'));
copyFileSync(join(repoRoot, 'package.json'), join(work, 'package.json'));
console.log(`Resolving the declared ranges in ${work} with no lockfile.`);
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {
  cwd: work,
  stdio: 'inherit',
});

const registryVersion = (name) => {
  try {
    return execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const rows = [];
const drift = [];
const behindRegistry = [];
for (const [name, { range, field }] of declared) {
  const lockEntry = lock.packages?.[`node_modules/${name}`];
  const locked = lockEntry ? lockEntry.version : 'absent';
  // The installed tree, not a lockfile: a fresh publish serves metadata before
  // the tarball, so a version that resolves but does not install is a registry
  // hiccup rather than a statement about this repo.
  const installed = join(work, 'node_modules', name, 'package.json');
  const resolved = existsSync(installed)
    ? JSON.parse(readFileSync(installed, 'utf8')).version
    : 'not installed';
  const latest = registryVersion(name);
  rows.push({ name, field, range, locked, resolved, latest });
  if (resolved !== locked) drift.push({ name, range, locked, resolved });
  if (latest !== 'unknown' && latest !== resolved) behindRegistry.push({ name, range, resolved, latest });
}

const width = (key, head) => Math.max(head.length, ...rows.map((r) => String(r[key]).length));
const cols = [
  ['name', 'dependency'],
  ['field', 'field'],
  ['range', 'declared'],
  ['locked', 'locked'],
  ['resolved', 'resolved'],
  ['latest', 'registry'],
];
const line = (get) => cols.map(([k, h]) => String(get(k, h)).padEnd(width(k, h))).join('  ').trimEnd();
console.log('');
console.log(line((k, h) => h));
console.log(cols.map(([k, h]) => '-'.repeat(width(k, h))).join('  '));
for (const row of rows) console.log(line((k) => row[k]));
console.log('');

for (const item of behindRegistry) {
  console.log(
    `::warning::${item.name} resolves to ${item.resolved} but the registry serves ${item.latest}. ` +
      `The declared range ${item.range} does not admit it.`,
  );
}

if (drift.length === 0) {
  console.log('No drift: every declared range resolves to the version the lockfile pins.');
  process.exit(0);
}
for (const item of drift) {
  console.log(
    `::error::${item.name} ${item.range} resolves to ${item.resolved}, the lockfile pins ${item.locked}.`,
  );
}
console.log('');
console.log('Refresh the lockfile so the gates run against what a fresh install gets:');
console.log(`  npm install ${drift.map((d) => d.name).join(' ')}`);
process.exit(1);
