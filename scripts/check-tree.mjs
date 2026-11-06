#!/usr/bin/env node
// Checks that an installed mcp-review-check has the dependency tree of its npm-shrinkwrap.json (review round 4,
// I-A08-3): every package the shrinkwrap names is found where Node's resolution would find it, at the shrinkwrap's
// version, and the package's own node_modules holds nothing the shrinkwrap does not name. Run by the pack smoke
// (ci.yml), the Docker smoke (docker.yml) and test/r111-p9-pipeline.test.ts, so "npx, global, Action and Docker get
// the tree CI tested" is checked rather than assumed.
//
//   node scripts/check-tree.mjs <installed package dir>
//
// The directory holds package.json and npm-shrinkwrap.json (as the published tarball does). A dependency may be
// hoisted above it (an install with --prefix or as a project dependency): each entry is looked up from the folder of
// the package that requires it, walking up through the node_modules folders as Node does.
// Exit 0: the tree matches. Exit 1: a package is missing, has another version, or is extra. Exit 2: usage error.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const NM = 'node_modules/';

/** The package names along a shrinkwrap key: `node_modules/a/node_modules/@s/b` -> ['a', '@s/b']. */
function names(key) {
  return key.split(/(?:^|\/)node_modules\//).filter(Boolean);
}

/** The version in <dir>/package.json, or undefined when there is none. */
function versionAt(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

/** Where Node finds package `name` required from `from`: <ancestor>/node_modules/<name>, nearest first. */
function find(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    if (!dir.endsWith('/node_modules') && !dir.endsWith('\\node_modules')) {
      const at = join(dir, 'node_modules', name);
      if (existsSync(join(at, 'package.json'))) return at;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** Every package folder under <root>/node_modules, as shrinkwrap-style keys relative to root. */
function installed(root, prefix = '') {
  const out = [];
  const nm = join(root, 'node_modules');
  let entries;
  try {
    entries = readdirSync(nm, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const scoped = e.name.startsWith('@') ? readdirSync(join(nm, e.name), { withFileTypes: true }).filter((s) => s.isDirectory()).map((s) => `${e.name}/${s.name}`) : [e.name];
    for (const name of scoped) {
      const key = `${prefix}${NM}${name}`;
      if (existsSync(join(nm, name, 'package.json'))) out.push(key);
      out.push(...installed(join(nm, name), `${key}/`));
    }
  }
  return out;
}

/**
 * Compares the tree installed for the package at `pkgDir` with its npm-shrinkwrap.json. Returns the problems, one
 * line each (empty when the tree matches), and the number of packages checked.
 */
export function checkTree(pkgDir) {
  const root = resolve(pkgDir);
  const wrap = JSON.parse(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8'));
  const packages = wrap.packages ?? {};
  const keys = Object.keys(packages).filter((k) => k.startsWith(NM));
  const problems = [];
  const where = new Map([['', root]]);
  // Parents before children, so a nested entry is looked up from where its parent was found.
  for (const key of keys.sort((a, b) => names(a).length - names(b).length || a.localeCompare(b))) {
    const entry = packages[key];
    if (entry.link || entry.dev) continue;
    const parts = names(key);
    const parentKey = key.slice(0, key.length - NM.length - parts[parts.length - 1].length).replace(/\/$/, '');
    const from = where.get(parentKey) ?? root;
    const at = find(parts[parts.length - 1], from);
    if (!at) {
      // An optional dependency for another platform is not installed; that is not a mismatch.
      if (!entry.optional) problems.push(`missing ${key}: shrinkwrap ${entry.version}`);
      continue;
    }
    where.set(key, at);
    const v = versionAt(at);
    if (v !== entry.version) problems.push(`mismatch ${key}: installed ${v}, shrinkwrap ${entry.version}`);
  }
  const named = new Set(keys);
  for (const key of installed(root)) if (!named.has(key)) problems.push(`extra ${key}: installed ${versionAt(join(root, key))}, not in the shrinkwrap`);
  return { problems, checked: keys.length };
}

if (/check-tree\.mjs$/.test(process.argv[1] ?? '')) {
  const dir = process.argv[2];
  if (!dir || process.argv.length > 3) {
    console.error('usage: node scripts/check-tree.mjs <installed package dir>');
    process.exit(2);
  }
  if (!existsSync(join(dir, 'npm-shrinkwrap.json'))) {
    console.error(`check-tree: ${join(dir, 'npm-shrinkwrap.json')} does not exist`);
    process.exit(2);
  }
  const { problems, checked } = checkTree(dir);
  if (problems.length) {
    for (const p of problems) console.error(`check-tree: ${p}`);
    console.error(`check-tree: ${problems.length} of ${checked} packages differ from npm-shrinkwrap.json`);
    process.exit(1);
  }
  console.log(`check-tree: ${checked} packages match npm-shrinkwrap.json`);
}
