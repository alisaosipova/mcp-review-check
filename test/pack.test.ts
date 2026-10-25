// A tarball packed from a clean clone (no dist/) ships a built, runnable bin.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const win = process.platform === 'win32';

/** Copy of the tracked files without dist/, as `git clone` would give (node_modules linked, not installed). */
function cleanCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mrc-pack-'));
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0');
  for (const f of files) {
    if (!f || f.startsWith('dist/') || !existsSync(join(ROOT, f))) continue;
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(dir, f));
  }
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
  return dir;
}

describe('npm pack', () => {
  it('npm pack from a clean copy ships dist/cli.js with a shebang (prepack)', () => {
    const dir = cleanCopy();
    try {
      expect(existsSync(join(dir, 'dist'))).toBe(false);
      const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: dir, encoding: 'utf8', shell: win, stdio: ['ignore', 'pipe', 'pipe'],
      });
      // lifecycle scripts may print before the JSON document
      const [packed] = JSON.parse(out.slice(out.indexOf('[')));
      const names: string[] = packed.files.map((f: { path: string }) => f.path.replace(/\\/g, '/'));
      expect(names).toContain('dist/cli.js');
      expect(names).toContain('package.json');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.prepack).toMatch(/build/);
      expect(pkg.bin).toEqual({ 'mcp-review-check': 'dist/cli.js' });
      expect(readFileSync(join(dir, 'dist/cli.js'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
      const version = execFileSync(process.execPath, [join(dir, 'dist/cli.js'), '--version'], { encoding: 'utf8' }).trim();
      expect(version).toBe(pkg.version);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
