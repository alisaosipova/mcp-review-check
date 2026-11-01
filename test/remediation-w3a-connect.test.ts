// Regression tests for the W3A-connect remediation (review 2026-11-01, wave 3): connect.ts, limits.ts,
// protocol/recording.ts, protocol/trace.ts and catalog.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, urlBasicAuth, type BuildOptions } from '../src/connect.js';
import { createBridgeHandler, listen, type Started } from './fixtures/http-bridge.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';

let servers: Started[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });
type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;
async function serve(handler: Handler, path = '/mcp'): Promise<Started> {
  const s = await listen(handler, path);
  servers.push(s);
  return s;
}
const build = (url: string, over: Partial<BuildOptions> = {}) => buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 3000, ...over }).then((r) => r.snap);

describe('user:pass@ in the URL is sent as Authorization: Basic (F003)', () => {
  const PASS = 'S3cr3t-pa$s-9f8e7d';
  const expected = `Basic ${Buffer.from(`alice:${PASS}`).toString('base64')}`;

  it('urlBasicAuth decodes the percent-encoded userinfo and gives nothing without one', () => {
    expect(urlBasicAuth(`http://alice:${encodeURIComponent(PASS)}@h/mcp`)).toBe(expected);
    expect(urlBasicAuth('http://h/mcp')).toBeUndefined();
    expect(urlBasicAuth('not a url')).toBeUndefined();
  });

  it('connects to a Basic-auth server, keeps urlAsEntered and redacts the credential', async () => {
    const seen: (string | undefined)[] = [];
    const bridge = createBridgeHandler(createGoodServer);
    const s = await serve((req, res) => {
      seen.push(req.headers.authorization);
      if (req.headers.authorization !== expected) { res.writeHead(401, { 'www-authenticate': 'Basic realm="x"' }); res.end(); return; }
      return bridge(req, res);
    });
    const url = `http://alice:${encodeURIComponent(PASS)}@127.0.0.1:${s.port}/mcp`;
    const snap = await build(url);
    expect(snap.coverage.toolLevel).toBe('ok');
    expect(snap.tools.length).toBeGreaterThan(0);
    // The preflight is unauthenticated by design; every credentialed request carries the Basic header.
    expect(seen.filter((a) => a === expected).length).toBeGreaterThan(2);
    expect(seen.filter((a) => a?.startsWith('Basic ')).every((a) => a === expected)).toBe(true);
    expect(snap.target.kind === 'http' && snap.target.urlAsEntered).toBe(url);
    expect(snap.options.authenticated).toBe(true);
    const text = JSON.stringify({ ...snap, target: undefined });
    expect(text).not.toContain(PASS);
    expect(text).not.toContain(expected.slice(6));
  });

  it('a rejected Basic credential is token-rejected, and --bearer wins over the URL credentials', async () => {
    const seen: (string | undefined)[] = [];
    const s = await serve((req, res) => { seen.push(req.headers.authorization); res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); });
    const snap = await build(`http://alice:${encodeURIComponent(PASS)}@127.0.0.1:${s.port}/mcp`);
    expect(snap.coverage.toolLevel).toBe('token-rejected');
    expect(seen).toContain(expected);
    seen.length = 0;
    await build(`http://alice:x@127.0.0.1:${s.port}/mcp`, { bearer: 'tok-123456789' });
    expect(seen).toContain('Bearer tok-123456789');
    expect(seen.some((a) => a?.startsWith('Basic '))).toBe(false);
  });
});
