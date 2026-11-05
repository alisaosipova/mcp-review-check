// 1.1.0 Q3, A08-03: the published package ships npm-shrinkwrap.json, the production part of package-lock.json, so npx,
// a global install and the Docker image install the tree CI tested. prepack writes it, postpack removes it (in the
// checkout it would take precedence over package-lock.json and `npm ci` would miss the dev dependencies).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shrinkwrap } from '../scripts/shrinkwrap.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCK = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('A08-03 npm-shrinkwrap.json from package-lock.json', () => {
  it('holds every production package of the lockfile and no dev-only one', () => {
    const sw = shrinkwrap(LOCK, PKG);
    const prod = Object.keys(LOCK.packages).filter((p) => p && !LOCK.packages[p].dev).sort();
    expect(Object.keys(sw.packages).filter(Boolean).sort()).toEqual(prod);
    expect(prod.length).toBeGreaterThan(50);
    expect(Object.values(sw.packages).some((e: any) => e.dev)).toBe(false);
    for (const dev of Object.keys(PKG.devDependencies)) expect(sw.packages[`node_modules/${dev}`], dev).toBeUndefined();
    for (const dep of Object.keys(PKG.dependencies)) expect(sw.packages[`node_modules/${dep}`]?.integrity, dep).toMatch(/^sha512-/);
  });

  it('the root entry is the package at its version, without devDependencies', () => {
    const sw = shrinkwrap(LOCK, PKG);
    expect(sw).toMatchObject({ name: PKG.name, version: PKG.version, lockfileVersion: LOCK.lockfileVersion });
    expect(sw.packages['']).toMatchObject({ name: PKG.name, version: PKG.version, dependencies: PKG.dependencies });
    expect(sw.packages[''].devDependencies).toBeUndefined();
  });

  it('a lockfile whose dependencies differ from package.json is refused', () => {
    const stale = { ...LOCK, packages: { ...LOCK.packages, '': { ...LOCK.packages[''], dependencies: { ...PKG.dependencies, undici: '^6.0.0' } } } };
    expect(() => shrinkwrap(stale, PKG)).toThrow(/out of date/);
    expect(() => shrinkwrap({ lockfileVersion: 1, dependencies: {} }, PKG)).toThrow(/lockfileVersion 2/);
  });

  it('package.json ships it: listed in files, written by prepack, removed by postpack', () => {
    expect(PKG.files).toContain('npm-shrinkwrap.json');
    expect(PKG.scripts.prepack).toMatch(/npm run build && node scripts\/shrinkwrap\.mjs$/);
    expect(PKG.scripts.postpack).toBe('node scripts/shrinkwrap.mjs --remove');
    expect(existsSync(join(ROOT, 'npm-shrinkwrap.json'))).toBe(false); // never left in the checkout
  });

  it('is ignored in the checkout, so an interrupted pack cannot leave it to be committed (review Q3-110 ignore)', () => {
    const lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('/npm-shrinkwrap.json');
  });
});

// Needs git (the tracked file list), as pack.test.ts does.
describe.skipIf(!existsSync(join(ROOT, '.git')))('A08-03 npm pack', () => {
  it('the tarball of a clean copy lists npm-shrinkwrap.json, and the copy has none afterwards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mrc-q3-pack-'));
    try {
      for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0')) {
        if (!f || f.startsWith('dist/') || !existsSync(join(ROOT, f))) continue;
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        copyFileSync(join(ROOT, f), join(dir, f));
      }
      symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
      const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      const [packed] = JSON.parse(out.slice(out.indexOf('[')));
      const names: string[] = packed.files.map((f: { path: string }) => f.path.replace(/\\/g, '/'));
      expect(names).toContain('npm-shrinkwrap.json');
      expect(names).not.toContain('package-lock.json');
      expect(existsSync(join(dir, 'npm-shrinkwrap.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
