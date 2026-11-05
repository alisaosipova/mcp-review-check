#!/usr/bin/env node
// npm-shrinkwrap.json for the published CLI (review A08-03): the production part of package-lock.json, so `npx
// mcp-review-check`, a global install and the Docker image get the dependency tree CI tested and audited instead of
// whatever the ranges resolve to on the day. Written by prepack, removed by postpack: in the checkout a shrinkwrap
// would take precedence over package-lock.json, and without the dev dependencies `npm ci` would fail.
//
//   node scripts/shrinkwrap.mjs           write npm-shrinkwrap.json next to package.json
//   node scripts/shrinkwrap.mjs --remove  delete it again
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SHRINKWRAP = `${ROOT}npm-shrinkwrap.json`;

/**
 * The shrinkwrap document for `pkg` from its lockfile `lock` (lockfileVersion 2 or 3): the root entry without
 * devDependencies and every package that is not dev-only. Throws when the lockfile does not match package.json
 * (dependencies differ), as a stale lockfile would ship a tree CI never installed.
 */
export function shrinkwrap(lock, pkg) {
  if (!lock || typeof lock.packages !== 'object' || !lock.packages['']) throw new Error('package-lock.json has no "packages" (lockfileVersion 2 or later is needed)');
  const root = lock.packages[''];
  const want = JSON.stringify(Object.entries(pkg.dependencies ?? {}).sort());
  const have = JSON.stringify(Object.entries(root.dependencies ?? {}).sort());
  if (want !== have) throw new Error('package-lock.json is out of date: its dependencies differ from package.json (run npm install)');
  const packages = {};
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') {
      const { devDependencies: _dev, ...rest } = entry;
      packages[''] = { ...rest, name: pkg.name, version: pkg.version };
    } else if (!entry.dev) {
      packages[path] = entry;
    }
  }
  return { name: pkg.name, version: pkg.version, lockfileVersion: lock.lockfileVersion, requires: true, packages };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--remove')) {
    rmSync(SHRINKWRAP, { force: true });
  } else {
    const lock = JSON.parse(readFileSync(`${ROOT}package-lock.json`, 'utf8'));
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
    writeFileSync(SHRINKWRAP, `${JSON.stringify(shrinkwrap(lock, pkg), null, 2)}\n`);
  }
}
