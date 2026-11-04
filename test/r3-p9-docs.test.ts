// 1.0.1 docs facts (review round 3, package P9): the request list in privacy-and-requests.md names every request a
// default run sends to a 2026-07-28 server, and the config and Docker docs say what the code does.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startModernServer, type ModernOptions } from './fixtures/modern-server.js';
import { startBridge, type Started } from './fixtures/http-bridge.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
// @ts-expect-error untyped .mjs fixture
import { createBadServer } from './fixtures/bad-server.mjs';
import { CLI, GOOD, cli, ROOT } from './cli-runner.js';

const doc = (name: string) => readFileSync(join(ROOT, 'docs', 'guide', name), 'utf8');
/** The "What the tool sends" section, flattened to one line. */
const sends = () => {
  const text = doc('privacy-and-requests.md');
  const start = text.indexOf('## What the tool sends');
  return text.slice(start, text.indexOf('\n## ', start + 1)).replace(/\s+/g, ' ');
};

// Each `--verbose` trace label (src/probe/*.ts) and the words in the doc that name that request.
const NAMED: [RegExp, string[]][] = [
  [/^preflight$/, ['an unauthenticated `initialize`']],
  [/^discover$/, ['`server/discover`']],
  [/^(sdk|modern) (initialize|notifications\/initialized|tools\/list|resources\/list|resources\/templates\/list|GET)$/, ['the SDK handshake and list calls']],
  [/^sdk DELETE$/, ['Each Streamable HTTP session the check opens', 'is ended with one `DELETE`']],
  [/^(preflight|origin .+) \(close session\)$/, ['each one a stateful server mints for a raw `initialize` probe (the unauthenticated one and the `Origin` ones)', 'is ended with one `DELETE`']],
  [/^get$/, ['a GET on the endpoint']],
  [/^badVersion$/, ['an unsupported protocol version']],
  [/^sdk mcp-review-check\/nonexistent$/, ['an unknown method']],
  [/^sdk tools\/call$/, ['`mcp_review_check_nonexistent_tool`']],
  [/^sdk resources\/read$/, ['`mcp-review-check://does-not-exist`']],
  [/^origin (?!.*\(close session\)$)/, ['`initialize` without an `Origin` and with three `Origin` values']],
  [/^challenge$/, ['`GET /.well-known/openai-apps-challenge`']],
  [/^(badVersion|unknownMethod|resourceMissing) \(modern\)$/, ['unsupported-version, unknown-method and missing-resource probes in their 2026-07-28 form']],
  [/^headerMismatch \((none|wrong)\)$/, ['two `tools/list` requests whose `Mcp-Method` header is missing or does not match']],
  [/^unknownTool \(modern\)$/, ['a `tools/call` for `mcp_review_check_nonexistent_tool` in the 2026-07-28 form']],
  [/^delete$/, ['one `DELETE` on the endpoint without a session id']],
  [/^tasks\/get \(nonexistent\)$/, ['`tasks/get` with a random task id']],
  [/^subscriptions\/listen$/, ['`subscriptions/listen`']],
];

let servers: Started[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });

async function trace(opts: ModernOptions | (() => unknown)): Promise<string[]> {
  const s = typeof opts === 'function' ? await startBridge(opts as Parameters<typeof startBridge>[0]) : await startModernServer(opts);
  servers.push(s);
  const r = await cli([s.url, '--verbose', '--format', 'json']);
  return r.stderr.split('\n').flatMap((l) => {
    const m = /^\[http\] (.+?): [A-Z]+ /.exec(l);
    return m ? [m[1]] : [];
  });
}

describe('A03-04: the request list names every default request, and the count covers every era', () => {
  for (const [name, opts] of [
    ['modern-only', {}],
    ['modern-only (tasks, listen)', { tasks: 'ok', listen: 'sse' }],
    ['dual era', { dual: true }],
    ['stateful 2025-11-25 SDK server (good)', createGoodServer],
    ['stateful 2025-11-25 SDK server (bad)', createBadServer],
  ] as [string, ModernOptions | (() => unknown)][]) {
    it(`${name}: each traced request is named in privacy-and-requests.md, and the count is within "20 to 40"`, async () => {
      const labels = await trace(opts);
      const text = sends();
      const unnamed = labels.filter((l) => !NAMED.some(([re]) => re.test(l)));
      expect(unnamed, 'a request the doc table in this test does not know: name it in the doc and here').toEqual([]);
      const missing = [...new Set(labels.flatMap((l) => NAMED.find(([re]) => re.test(l))![1]))].filter((w) => !text.includes(w));
      expect(missing).toEqual([]);
      expect(text).toContain('By default 20 to 40 requests');
      expect(labels.length).toBeGreaterThanOrEqual(20);
      expect(labels.length).toBeLessThanOrEqual(40);
      // The per-era figures the doc gives ("about 35" stateful, "about 25" stateless) stay within 3 of the trace.
      const about = typeof opts === 'function' ? 35 : 25;
      expect(text).toContain(`about ${about} to a ${typeof opts === 'function' ? 'stateful 2025-11-25' : 'stateless 2026-07-28'}`);
      expect(Math.abs(labels.length - about)).toBeLessThanOrEqual(3);
    }, 60000);
  }

  it('modern-only: the DELETE probe is in the trace and the doc names it', async () => {
    const labels = await trace({});
    expect(labels).toContain('delete');
    expect(sends()).toContain('without a session id');
  }, 60000);
});

describe('P9 improvement: config discovery with --cwd is worded as the code behaves', () => {
  const run = (cwd: string, args: string[]) => new Promise<number>((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' }, timeout: 60000 }, (err) => {
      resolve(err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0);
    });
  });

  it('with --cwd, a config file in the working directory is not read (no fallback)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'mrc-p9-work-'));
    const other = mkdtempSync(join(tmpdir(), 'mrc-p9-cwd-'));
    try {
      // An invalid failOn makes a config that is read a usage error (exit 2).
      writeFileSync(join(work, '.mcp-review-check.json'), '{"failOn": "nope"}');
      expect(await run(work, ['--stdio', GOOD, '--format', 'json'])).toBe(2);
      expect(await run(work, ['--stdio', GOOD, '--cwd', other, '--format', 'json'])).not.toBe(2);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  }, 120000);

  it('options-and-config.md says one directory only, not "or else in the working directory"', () => {
    const text = doc('options-and-config.md').replace(/\s+/g, ' ');
    expect(text).not.toContain('in the `--cwd` directory, or else in the working directory');
    expect(text).not.toContain('in the `--cwd` directory (or the working directory)');
    expect(text).toContain('so with `--cwd` a file in the working directory is not read');
  });
});

describe('A01-01: options-and-config.md documents the trust model of a discovered config file', () => {
  const KNOWN_FORBIDDEN = ['url', 'stdio', 'args', 'output', 'jsonOutput', 'saveBaseline', 'cwd', 'env', 'header', 'bearer', 'activeAuth', 'active'];
  it('a discovered file sets options only; an explicit --config can set the server, output paths and credentials', async () => {
    const text = doc('options-and-config.md').replace(/\s+/g, ' ');
    const row = text.split('| `--config <file>`')[1]?.split(' | ')[2] ?? '';
    expect(row).toContain('A discovered file sets options only, not the server, output paths, credentials');
    const trust = /- \*\*Trust\*\*: (.*?)(?= - \*\*|$)/.exec(text)?.[1] ?? '';
    // The keys P1 (src/config.ts DISCOVERED_FORBIDDEN) ignores in a discovered file; the export, once merged, is checked too.
    const config = (await import('../src/config.js')) as { DISCOVERED_FORBIDDEN?: readonly string[] };
    const keys = new Set([...KNOWN_FORBIDDEN, ...(config.DISCOVERED_FORBIDDEN ?? [])]);
    for (const key of keys) expect(trust, key).toContain(`\`${key}\``);
    for (const key of ['cwd', 'env', 'active']) expect(row, key).toContain(`\`${key}\``);
    expect(trust).toContain('`$MCP_REVIEW_CHECK_TOKEN`');
    expect(trust).toContain('A file you name with `--config` is trusted and can set all of these keys');
  });
});

describe('A08-04: the Docker recipe writes a report as a user that can write the mounted folder', () => {
  const ci = doc('ci.md');
  const start = ci.indexOf('\n## Docker\n');
  const section = ci.slice(start, ci.indexOf('\n## ', start + 1));
  it('every docker run with --output into a mount also passes --user "$(id -u):$(id -g)"', () => {
    const runs = section.split('\n').filter((l) => /^docker run .*-v .*--output /.test(l));
    expect(runs.length).toBeGreaterThan(0);
    for (const l of runs) expect(l, l).toContain('--user "$(id -u):$(id -g)"');
    expect(section).toMatch(/^mkdir -p out$/m);
  });
  it('the uid the recipe names is the image user of the Dockerfile', () => {
    const uid = /adduser -D -u (\d+) /.exec(readFileSync(join(ROOT, 'Dockerfile'), 'utf8'))?.[1];
    expect(uid).toBeDefined();
    expect(section).toContain(`(uid ${uid})`);
    expect(section).toContain('EACCES');
  });
});
