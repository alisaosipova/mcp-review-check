// Review round 3, package P1 follow-up (1.0.1): the scheme hint no longer echoes a token-shaped value (A01-09); a
// baseline saved with a non-secret --env value still matches when the run drops or changes it (A01-05); --output
// through a dangling symlink to the --save-baseline file is caught (A01-06); baseline matching stays linear when
// entries do not match (improvement).
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { knownFindings, type FindingKey } from '../src/baseline.js';

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const BAD = fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url));
const good = ['--stdio', '--', process.execPath, GOOD];
const bad = ['--stdio', '--', process.execPath, BAD];

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r3-p1f-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const at = (...p: string[]) => join(dir, ...p);
const run = (args: string[], env: Record<string, string> = {}) => runCli(args, env, false);

describe('A01-09: the scheme hint does not echo a token-shaped value', () => {
  // Assembled at runtime: a JWT-like value, a key with a dot, a key with a :<port> ending.
  const jwt = ['SYNTHeyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SYNTHsig0123456789abcdef'].join('.');
  const dotted = ['SYNTH', 'key.0123456789abcdefghij'].join('_');
  const ported = ['SYNTHkey0123456789abcdef', '8080'].join(':');

  it('A01-09 a value that lost its option is not shown in the scheme error', async () => {
    for (const v of [jwt, dotted, ported]) {
      const r = await run(['--no-config', '--header', 'Authorization:', v]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('error: the URL needs a scheme (http:// or https://); the value is not shown, as it looks like a token: is a value missing its option?');
      for (const piece of v.split(/[.:]/).filter((p) => p.length >= 16)) expect(r.stderr).not.toContain(piece);
    }
  });

  it('A01-09 a host without a scheme still gets the suggestion', async () => {
    expect((await run(['--no-config', 'mcp.example.com/mcp'])).stderr).toContain('did you mean https://mcp.example.com/mcp?');
    expect((await run(['--no-config', 'localhost:3000/mcp'])).stderr).toContain('did you mean http://localhost:3000/mcp?');
  });
});

describe('A01-05: a baseline saved with a non-secret --env value matches without it', () => {
  it('A01-05 dropping or changing the --env keeps the findings known (exit 0)', async () => {
    const b = at('b1.json');
    expect((await run(['--no-config', '--env', 'WORKSPACE=conversation_history', '--save-baseline', b, '--fail-on', 'never', ...bad])).code).toBe(0);
    expect(readFileSync(b, 'utf8')).not.toContain('conversation_history');
    for (const extra of [[], ['--env', 'WORKSPACE=other_value'], ['--env', 'WORKSPACE=conversation_history']]) {
      const r = await run(['--no-config', '--baseline', b, '--fail-on', 'warning', '--format', 'json', ...extra, ...bad]);
      expect(r.code, r.stderr).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.findings.filter((f: { baselined: boolean }) => !f.baselined)).toEqual([]);
    }
  }, 120000);

  it('A01-05 a redacted subject matches only inside the same field and after the exact entries', () => {
    const k = (path: string, message = 'm'): FindingKey => ({ ruleId: 'DATA-001', platforms: ['claude'], tool: 't', path, message });
    const base = [k('/properties/«redacted»')];
    expect(knownFindings([k('/properties/conversation_history')], base)).toEqual([true]);
    expect(knownFindings([k('/other/x')], base)).toEqual([false]);
    expect(knownFindings([{ ...k('/properties/x'), tool: 'u' }], base)).toEqual([false]);
    // An exact match takes the entry first; the wildcard does not take an entry twice.
    expect(knownFindings([k('/properties/a'), k('/properties/b')], base)).toEqual([true, false]);
    expect(knownFindings([k('/properties/a'), k('/properties/«redacted»')], base)).toEqual([false, true]);
  });
});

describe('A01-06: --output through a dangling symlink to the --save-baseline file', () => {
  it('A01-06 a link to a baseline that does not exist yet is caught, and nothing is written', async () => {
    symlinkSync(at('real.json'), at('link.txt'));
    const r = await run(['--no-config', '--output', at('link.txt'), '--save-baseline', at('real.json'), ...good]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--save-baseline and --output name the same file/);
    // A relative link, and a chain of two.
    symlinkSync('real2.json', at('rel.txt'));
    symlinkSync(at('rel.txt'), at('chain.txt'));
    const c = await run(['--no-config', '--output', at('chain.txt'), '--save-baseline', at('real2.json'), ...good]);
    expect(c.code).toBe(2);
  });
});

describe('improvement: baseline matching is linear when entries do not match', () => {
  const best = (f: () => void) => { f(); return Math.min(...[0, 1, 2, 3, 4].map(() => { const t = performance.now(); f(); return performance.now() - t; })); };
  const keys = (n: number, message: string, platforms: FindingKey['platforms']): FindingKey[] => Array.from({ length: n }, () => ({ ruleId: 'TOOL-001', platforms, tool: 'same', message }));

  it('another wording on every entry, or platforms the entries do not cover', () => {
    const reworded = (n: number) => () => knownFindings(keys(n, 'new words', ['claude']), keys(n, 'old words', ['claude']));
    const uncovered = (n: number) => () => knownFindings(keys(n, 'm', ['claude', 'chatgpt']), keys(n, 'm', ['claude']));
    expect(reworded(100)().every(Boolean)).toBe(true);
    expect(uncovered(100)().some(Boolean)).toBe(false);
    for (const f of [reworded, uncovered]) {
      // Quadratic would be about 16x from 10k to 40k (seconds); the floor keeps a fast small run from inflating the ratio.
      const ratio = best(f(40000)) / Math.max(5, best(f(10000)));
      expect(ratio).toBeLessThan(10);
    }
  }, 120000);
});
