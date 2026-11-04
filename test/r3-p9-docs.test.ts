// 1.0.1 docs facts (review round 3, package P9): the request list in privacy-and-requests.md names every request a
// default run sends to a 2026-07-28 server, and the config and Docker docs say what the code does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startModernServer, type ModernOptions } from './fixtures/modern-server.js';
import type { Started } from './fixtures/http-bridge.js';
import { cli, ROOT } from './cli-runner.js';

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
  [/^get$/, ['a GET on the endpoint']],
  [/^badVersion$/, ['an unsupported protocol version']],
  [/^sdk mcp-review-check\/nonexistent$/, ['an unknown method']],
  [/^sdk tools\/call$/, ['`mcp_review_check_nonexistent_tool`']],
  [/^sdk resources\/read$/, ['`mcp-review-check://does-not-exist`']],
  [/^origin /, ['three `Origin` values']],
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

async function trace(opts: ModernOptions): Promise<string[]> {
  const s = await startModernServer(opts);
  servers.push(s);
  const r = await cli([s.url, '--verbose', '--format', 'json']);
  return r.stderr.split('\n').flatMap((l) => {
    const m = /^\[http\] (.+?): [A-Z]+ /.exec(l);
    return m ? [m[1]] : [];
  });
}

describe('A03-04: the request list names every default request to a 2026-07-28 server', () => {
  for (const [name, opts] of [
    ['modern-only (tasks, listen)', { tasks: 'ok', listen: 'sse' }],
    ['dual era', { dual: true }],
  ] as [string, ModernOptions][]) {
    it(`${name}: each traced request is named in privacy-and-requests.md, and the count is within "20 to 30"`, async () => {
      const labels = await trace(opts);
      const text = sends();
      const unnamed = labels.filter((l) => !NAMED.some(([re]) => re.test(l)));
      expect(unnamed, 'a request the doc table in this test does not know: name it in the doc and here').toEqual([]);
      const missing = [...new Set(labels.flatMap((l) => NAMED.find(([re]) => re.test(l))![1]))].filter((w) => !text.includes(w));
      expect(missing).toEqual([]);
      expect(text).toContain('20 to 30 requests');
      expect(labels.length).toBeGreaterThanOrEqual(20);
      expect(labels.length).toBeLessThanOrEqual(30);
    }, 60000);
  }

  it('modern-only: the DELETE probe is in the trace and the doc names it', async () => {
    const labels = await trace({});
    expect(labels).toContain('delete');
    expect(sends()).toContain('without a session id');
  }, 60000);
});
