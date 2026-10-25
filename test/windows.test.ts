// Windows details of a stdio check. No Windows machine here, so the win32 cases run runCli in
// process with process.platform set to 'win32' after the modules have loaded; the SDK
// stdio transport is mocked to record its parameters and fail to start, so nothing is spawned. The --tool-args
// encodings need no emulation: the built CLI reads the files on any OS.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildRedactor } from '../src/redact.js';
import { cli, GOOD } from './cli-runner.js';

const seen = vi.hoisted(() => [] as { env?: Record<string, string> }[]);
/** `spawn.real` lets one test start a real server; `built` records every redactor a run builds. */
const spawn = vi.hoisted(() => ({ real: false }));
const built = vi.hoisted(() => [] as { strongOnly: boolean; values: Set<string> }[]);

vi.mock('../src/redact.js', async (orig) => {
  const actual = await orig<typeof import('../src/redact.js')>();
  const buildRedactor: typeof actual.buildRedactor = (input, strongOnly = false) => {
    const r = actual.buildRedactor(input, strongOnly);
    built.push({ strongOnly, values: r.values });
    return r;
  };
  return { ...actual, buildRedactor };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', async (orig) => {
  const actual = await orig<typeof import('@modelcontextprotocol/sdk/client/stdio.js')>();
  class RecordingTransport extends actual.StdioClientTransport {
    constructor(params: ConstructorParameters<typeof actual.StdioClientTransport>[0]) {
      super(params);
      seen.push(params);
    }
    async start(): Promise<void> {
      if (spawn.real) return super.start();
      throw new Error('emulated win32: not started');
    }
  }
  return { ...actual, StdioClientTransport: RecordingTransport };
});

async function asWin32(argv: string[]) {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    return await runCli(argv, {}, false);
  } finally {
    Object.defineProperty(process, 'platform', { value: platform });
  }
}

const dir = mkdtempSync(join(tmpdir(), 'mrc-win-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Windows (process.platform emulated)', () => {
  it('--env Path=X replaces the inherited PATH on win32', async () => {
    seen.length = 0;
    await asWin32(['--stdio', 'node s.js', '--env', 'Path=X', '--format', 'json', '--timeout', '3000']);
    expect(seen.length, 'the stdio transport was created').toBeGreaterThan(0);
    const env = seen[0].env ?? {};
    const paths = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
    expect(paths, JSON.stringify(Object.keys(env))).toHaveLength(1);
    expect(env[paths[0]]).toBe('X');
  });

  it('the markdown rerun line on win32 uses double quotes', async () => {
    const r = await asWin32(['--format', 'markdown', '--timeout', '3000', '--stdio', 'node C:\\srv\\s.js']);
    const rerun = /rerun: (npx mcp-review-check .*?) ?`+$/m.exec(r.stdout)?.[1];
    expect(rerun, r.stdout.slice(0, 400)).toBeDefined();
    expect(rerun).not.toContain("'");
    expect(rerun).toContain('--stdio "node C:\\srv\\s.js"');
  });
});

describe('--tool-args saved by Windows editors', () => {
  const json = '{"search_notes":{"keywords":"x"}}';
  it.each([
    ['UTF-8 with BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, 'utf8')])],
    ['UTF-16LE', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')])],
  ])('--tool-args in %s is read', async (name, bytes) => {
    const file = join(dir, `${name.replace(/\W+/g, '-')}.json`);
    writeFileSync(file, bytes);
    const r = await cli(['--stdio', GOOD, '--active', '--tool-args', file, '--format', 'json']);
    expect(r.stderr).not.toContain('not valid JSON');
    expect(r.code, r.stderr).not.toBe(2);
    expect(r.json?.coverage?.toolLevel, r.stderr).toBe('ok');
  });
});

describe('the strength of an --env value follows its name as typed', () => {
  const KEY = 'SynthSigningKey-abcdefghij-ABCDEFGHIJ'; // no digits: not token-like, strong only by its name
  /** Writes the value past column 183 on stderr and exits: the 200-character start-up error line cuts through it. */
  const CUT = "console.error('Error: authentication failed for key '.padEnd(183, '.') + (process.env.SIGNINGKEY ?? process.env.signingKey) + ' rest'); process.exit(1)";

  it.each(['text', 'json', 'markdown', 'sarif'])('SEC-win-env-case-tier: %s: --env signingKey=… is strong on win32, and an echo cut at 200 characters leaves no prefix', async (format) => {
    // The test discriminates only while the value is strong by its typed name alone, not as the upper-cased one.
    expect(buildRedactor({ env: { SIGNINGKEY: KEY } }, true).values.has(KEY), 'SIGNINGKEY alone is not strong').toBe(false);
    built.length = 0;
    spawn.real = true;
    try {
      const r = await asWin32(['--env', `signingKey=${KEY}`, '--format', format, '--timeout', '5000', '--stdio', '--', process.execPath, '-e', CUT]);
      expect(r.code, r.stderr).toBe(3);
      const all = r.stdout + r.stderr;
      expect(all, 'the cut line reached the report').toContain('authentication failed for key');
      expect(all).not.toContain(KEY.slice(0, 10));
      const strong = built.filter((b) => b.strongOnly);
      expect(strong.length, 'a strong redactor was built').toBeGreaterThan(0);
      for (const b of strong) expect(b.values.has(KEY), 'in the strong tier').toBe(true);
    } finally {
      spawn.real = false;
    }
  });
});
