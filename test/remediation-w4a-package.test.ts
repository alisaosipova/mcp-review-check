// Regression tests for the W4A-cli remediation (review 2026-11-01): the package is CLI-only (F150): no "main",
// "exports" exposes only ./package.json, the bin stays; the README no longer says the package is unpublished (F148).
// Resolution is checked through the package's self-reference (Node resolves its own name by "exports" inside it).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from './cli-runner.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('CLI-only package (F150)', () => {
  it('no main; exports only ./package.json; the bin is unchanged', () => {
    expect(pkg.main).toBeUndefined();
    expect(pkg.exports).toEqual({ './package.json': './package.json' });
    expect(pkg.bin).toEqual({ 'mcp-review-check': 'dist/cli.js' });
  });

  it('the bare name and deep dist/ imports do not resolve; package.json does', () => {
    const script = `
      const out = {};
      for (const s of ['mcp-review-check', 'mcp-review-check/dist/cli.js', 'mcp-review-check/dist/report/index.js']) {
        try { import.meta.resolve(s); out[s] = 'resolved'; } catch (e) { out[s] = e.code; }
      }
      out.pkg = import.meta.resolve('mcp-review-check/package.json').endsWith('/package.json');
      console.log(JSON.stringify(out));`;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8' }));
    expect(out).toEqual({
      'mcp-review-check': 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      'mcp-review-check/dist/cli.js': 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      'mcp-review-check/dist/report/index.js': 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      pkg: true,
    });
  });
});

describe('README install note (F148)', () => {
  it('names only the offline case, not an unpublished package', () => {
    expect(README).not.toMatch(/before its first npm release/);
    expect(README).toMatch(/without access to the npm registry, where `npx` cannot fetch the package, run it from a checkout/);
  });
});
