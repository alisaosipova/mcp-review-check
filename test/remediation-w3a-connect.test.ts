// Regression tests for the W3A-connect remediation (review 2026-11-01, wave 3): connect.ts, limits.ts,
// protocol/recording.ts, protocol/trace.ts and catalog.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
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

describe('server/discover, the auth trigger and the auth probe follow a same-host redirect (F019)', () => {
  /** /mcp answers 308 -> /mcp/, where the good server runs; `discover` adds a 2026-07-28 server/discover answer. */
  async function redirected(opts: { discover?: boolean; bearer?: string } = {}): Promise<Started> {
    const bridge = createBridgeHandler(createGoodServer, { path: '/mcp/', bearer: opts.bearer, challenge: 'Bearer realm="x"' });
    return serve(async (req, res) => {
      if (req.url === '/mcp') { res.writeHead(308, { location: '/mcp/' }); res.end(); return; }
      if (opts.discover && req.method === 'POST' && req.url === '/mcp/') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = Buffer.concat(chunks).toString('utf8');
        const msg = JSON.parse(body) as { id?: unknown; method?: string };
        if (msg.method === 'server/discover') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { supportedVersions: ['2026-07-28', '2025-11-25'], capabilities: { tools: {} } } }));
          return;
        }
        // The bridge reads the body itself: hand it a request whose body is still to be read.
        const replay = Object.assign(Readable.from([Buffer.from(body)]), { headers: req.headers, method: req.method, url: req.url }) as unknown as IncomingMessage;
        return bridge(replay, res);
      }
      return bridge(req, res);
    });
  }

  it('a dual-era server behind the redirect is detected as dual, not legacy', async () => {
    const s = await redirected({ discover: true });
    const snap = await build(s.url);
    const disc = snap.transport.probes.discover;
    expect(disc && 'status' in disc ? disc.status : undefined).toBe(200);
    expect(snap.era).toBe('dual');
    expect(snap.transport.preflight?.status).toBe(308); // SRV-006 still sees the redirect
  });

  it('a 401 behind the redirect starts the auth probe, which probes the redirect target', async () => {
    const s = await redirected({ bearer: 'good-token-1234567890' });
    const snap = await build(s.url, { bearer: 'good-token-1234567890' });
    expect(snap.coverage.toolLevel).toBe('ok');
    expect(snap.authProbe?.trigger).toBe('preflight-401');
    expect(snap.authProbe?.challenge?.status).toBe(401);
    expect(snap.authProbe?.invalidToken?.status).toBe(401);
    expect(snap.authProbe?.invalidToken?.url).toBe(`${s.url}/`);
  });
});
