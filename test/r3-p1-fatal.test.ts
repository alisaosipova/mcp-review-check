// Review round 3, package P1 (1.0.1), A07-04 (hardening): an unexpected error whose message carries server text
// (ESC, a bidi override, a line starting "::" or "##[") reaches neither the fatal stack lines nor the fatal ::error
// annotation raw. The rule engine is mocked to throw such an error after a normal connect to the GOOD fixture.
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/rules/engine.js', async (orig) => ({
  ...(await orig<typeof import('../src/rules/engine.js')>()),
  runRules: () => { throw new Error('boom \x1b[31mred\u202Ebidi\n::error title=X::forged\n##[group]g'); },
}));

const { runCli, ciSafeLine } = await import('../src/cli.js');
const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));

describe('A07-04: the fatal path shows server text safely', () => {
  it('A07-04 fatal stack lines and the fatal ::error annotation carry no raw ESC, bidi or workflow command', async () => {
    const r = await runCli(['--no-config', '--stdio', '--', process.execPath, GOOD], { GITHUB_ACTIONS: 'true' }, false);
    expect(r.code).toBe(3);
    expect(r.stderr).not.toMatch(/[\x1b\u202E]/);
    expect(r.stderr.split('\n').filter((l) => /^\s*(::|##\[)/.test(l) && !l.startsWith('::error title=mcp-review-check::fatal: boom'))).toEqual([]);
    expect(r.stderr).toContain('\\u{3A}:error title=X::forged');
    expect(r.stderr).toMatch(/^::error title=mcp-review-check::fatal: boom \\u\{1B\}\[31mred\\u\{202E\}bidi$/m);
  });

  it('A07-04 ciSafeLine keeps ordinary text and neutralises only a leading command prefix', () => {
    expect(ciSafeLine('a :: b ##[x]')).toBe('a :: b ##[x]');
    expect(ciSafeLine('  ::warning::w')).toBe('  \\u{3A}:warning::w');
    expect(ciSafeLine('##[error]e')).toBe('\\u{23}#[error]e');
    expect(ciSafeLine('# heading')).toBe('# heading');
  });
});
