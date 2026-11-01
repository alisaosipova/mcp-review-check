// Regression tests for the W3C-cli-tests remediation (review 2026-11-01): the --verbose trace on stderr and the
// "Exit codes:" block of --help. Unit tests for modules only the spawned e2e tests reached (F156) are in unit-*.test.ts.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const NOISY = `node ${fileURLToPath(new URL('./fixtures/w3c-noisy-stderr.mjs', import.meta.url))}`;

describe('--verbose prints server text with control characters visible (F135)', () => {
  it('the [stdio stderr] tail shows ESC, CR and bidi overrides as \\u{..}, one line per server line', async () => {
    const r = await runCli(['--stdio', NOISY, '--verbose', '--format', 'json'], { NO_COLOR: '1' }, false);
    expect(r.code, r.stderr).toBe(0);
    const tail = r.stderr.slice(r.stderr.indexOf('[stdio stderr]\n'));
    expect(tail).toContain('noisy: \\u{1B}[31mred\\u{1B}[0m\\u{D}OVERWRITTEN \\u{202E}evil\nsecond line\n');
    expect(r.stderr).not.toMatch(/[\x1b\r\u202e]/);
  });

  it('the [http] trace lines carry no raw control characters', async () => {
    const r = await runCli(['http://127.0.0.1:1/mcp', '--verbose', '--timeout', '2000'], { NO_COLOR: '1' }, false);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('[http] ');
    expect(r.stderr).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f\u202e]/);
  });
});

describe('--help lists every exit code the README table has (R006, R019)', () => {
  it('0-3, 3 for an internal error, and 128+N for a signal with the common values', async () => {
    const help = (await runCli(['--help'], {}, false)).stdout;
    const block = help.match(/^Exit codes:\n([\s\S]*?)\n\n/m)?.[1] ?? '';
    const codes = [...block.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]);
    expect(codes).toEqual(['0', '1', '2', '3', '128+N']);
    expect(block).toMatch(/internal error[\s\S]*fatal:[\s\S]*stack trace/);
    for (const n of ['130', '143', '131', '129']) expect(block).toContain(n);
    for (const line of block.split('\n')) expect(line.length, line).toBeLessThanOrEqual(120);
  });
});
