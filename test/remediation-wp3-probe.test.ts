// Regression tests for the WP3-probe remediation (review 2026-11-01): wire probes, --active, network and auth probes.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModernClient } from '../src/protocol/modern.js';
import { createRedactor, createTracer } from '../src/protocol/trace.js';
import { runActive, wrongTypeValue } from '../src/probe/active.js';
import { sameHostRedirect } from '../src/probe/network.js';
import { runWireProbes, sdkSessionGet } from '../src/probe/wire.js';
import { RULES } from '../src/rules/index.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, exchange, snap, tool } from './helpers.js';

interface Seen { method: string; path: string; headers: IncomingMessage['headers'] }

let server: Server | undefined;
afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) { s.closeAllConnections(); await new Promise<void>((r) => s.close(() => r())); }
});

/** A loopback HTTP server; `handle` answers every request, `seen` records them. */
async function listen(handle: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const s = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers }); handle(req, res, body); });
  });
  server = s;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, seen };
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

function httpSnap(url: string, set?: (s: Snapshot) => void): Snapshot {
  return snap({ url, set: (s) => { s.localMode = true; set?.(s); } });
}

const byId = (id: string) => RULES.find((r) => r.id === id)!;
const ruleHits = (s: Snapshot, rules: string[]) => rules.flatMap((id) => evaluate(byId(id), s, true).map((f) => `${f.ruleId}:${f.severity}`));

describe('F019: raw probes follow a same-host redirect the SDK client followed', () => {
  it('sameHostRedirect follows /mcp -> /mcp/ and an upgrade to https, but not another host or a downgrade', () => {
    const u = new URL('http://127.0.0.1:9/mcp');
    const r = (status: number, location?: string) => exchange({ status, headers: location ? { location } : {} });
    expect(sameHostRedirect(u, r(308, '/mcp/'))?.href).toBe('http://127.0.0.1:9/mcp/');
    expect(sameHostRedirect(u, r(301, 'http://127.0.0.1:9/v2/mcp'))?.href).toBe('http://127.0.0.1:9/v2/mcp');
    expect(sameHostRedirect(u, r(308, 'http://evil.test/mcp'))).toBeUndefined();
    expect(sameHostRedirect(u, r(200))).toBeUndefined();
    expect(sameHostRedirect(u, r(308))).toBeUndefined();
    expect(sameHostRedirect(new URL('https://a.test/mcp'), r(308, 'http://a.test/mcp/'))).toBeUndefined();
  });

  it('GET, bad-version and Origin probes reach /mcp/, so SPEC-005/SPEC-007 stay quiet and SRV-008 sees the foreign Origin', async () => {
    const { base, seen } = await listen((req, res) => {
      if (req.url === '/mcp') { res.writeHead(308, { location: '/mcp/' }); res.end(); return; }
      if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
      if (req.headers['mcp-protocol-version'] === '1900-01-01') { json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'bad version' } }); return; }
      json(res, 200, { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'x', version: '1' } } });
    });
    const url = `${base}/mcp`;
    const s = httpSnap(url, (x) => { x.transport.preflight = exchange({ label: 'preflight', url, status: 308, headers: { location: '/mcp/' } }); });
    s.transport.probes = await runWireProbes({
      snap: s, timeoutMs: 5000, now: () => performance.now(), sleep: async () => {},
      http: { tracer: createTracer(createRedactor()), url: new URL(url), authHeaders: {} },
    });
    expect(seen.filter((r) => r.path !== '/.well-known/openai-apps-challenge').map((r) => r.path)).toEqual(Array(6).fill('/mcp/'));
    expect(ruleHits(s, ['SPEC-005', 'SPEC-007', 'SRV-008'])).toEqual(['SRV-008:error']);
    // SRV-006 still reports the redirect from the preflight
    expect(evaluate(byId('SRV-006'), s).map((f) => f.message)).toEqual([expect.stringMatching(/POST redirects \(308\) .*register the final URL/)]);
  });
});

describe('F018: the GET probe does not open a second stream in the SDK session', () => {
  it("reuses the SDK client's answered session GET instead of sending one the server rejects with 409", async () => {
    const { base, seen } = await listen((req, res) => {
      if (req.method === 'GET' && req.headers['mcp-session-id']) { json(res, 409, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Conflict: Only one SSE stream is allowed per session' } }); return; }
      json(res, 400, {});
    });
    const url = `${base}/mcp`;
    const tracer = createTracer(createRedactor());
    const sdkGet = exchange({ label: 'sdk GET', method: 'GET', url, requestHeaders: { 'mcp-session-id': 'sess-1234567890abcdef', accept: 'text/event-stream' }, status: 200, contentType: 'text/event-stream' });
    tracer.exchanges.push(sdkGet);
    const s = httpSnap(url, (x) => { x.transport.sessionId = 'sess-1234567890abcdef'; });
    s.transport.probes = await runWireProbes({
      snap: s, timeoutMs: 5000, now: () => performance.now(), sleep: async () => {},
      http: { tracer, url: new URL(url), authHeaders: {}, sessionId: 'sess-1234567890abcdef', protocolVersion: '2025-11-25' },
    });
    expect(s.transport.probes.get).toBe(sdkGet);
    expect(seen.filter((r) => r.method === 'GET' && r.path === '/mcp')).toEqual([]);
    expect(evaluate(byId('SPEC-005'), s)).toEqual([]);
  });

  it('does not reuse an SDK GET from another session or one that got no answer', () => {
    const a = exchange({ label: 'sdk GET', method: 'GET', requestHeaders: { 'mcp-session-id': 'other' }, status: 200 });
    const b = exchange({ label: 'sdk GET', method: 'GET', requestHeaders: { 'mcp-session-id': 'mine' } });
    expect(sdkSessionGet([a, b], 'mine')).toBeUndefined();
  });
});

describe('R009: Origin is probed on legacy HTTP+SSE servers too', () => {
  async function sseProbe(rejectForeign: boolean) {
    const { base, seen } = await listen((req, res) => {
      if (req.method !== 'GET' || req.url !== '/sse') { res.writeHead(404); res.end(); return; }
      if (rejectForeign && req.headers.origin && req.headers.origin !== 'https://claude.ai') { res.writeHead(403); res.end('forbidden origin'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: endpoint\ndata: /messages?sessionId=abc\n\n');
    });
    const url = `${base}/sse`;
    const s = httpSnap(url, (x) => { x.transport.kind = 'sse'; x.era = 'sse-legacy'; });
    s.transport.probes = await runWireProbes({
      snap: s, timeoutMs: 5000, now: () => performance.now(), sleep: async () => {},
      http: { tracer: createTracer(createRedactor()), url: new URL(url), authHeaders: {} },
    });
    return { s, seen };
  }

  it('opens the stream with foreign Origins and reports a local SSE server that accepts them (SRV-008 spec error)', async () => {
    const { s, seen } = await sseProbe(false);
    expect(seen.filter((r) => r.path === '/sse').map((r) => [r.method, r.headers.origin ?? '(none)'])).toEqual([
      ['GET', '(none)'], ['GET', 'https://claude.ai'], ['GET', 'https://chatgpt.com'], ['GET', 'https://evil.mcp-review-check.invalid'],
    ]);
    expect(seen.every((r) => r.method === 'GET')).toBe(true);
    expect(ruleHits(s, ['SRV-008'])).toEqual(['SRV-008:error']);
  });

  it('stays quiet when the SSE server answers a foreign Origin with 403', async () => {
    const { s } = await sseProbe(true);
    expect(s.transport.probes.originEvil).toMatchObject({ status: 403 });
    expect(evaluate(byId('SRV-008'), s).filter((f) => f.severity === 'error')).toEqual([]);
  });
});

/** A fake modern client that records tools/call params and answers with `answer`. */
function recordingModern(answer: (params: { name: string; arguments: unknown }) => unknown = () => ({ content: [{ type: 'text', text: 'ok' }] })) {
  const calls: Array<{ name: string; arguments: unknown }> = [];
  const modern = {
    request: async (_m: string, params: { name: string; arguments: unknown }) => {
      calls.push(params);
      return { result: answer(params), exchange: { status: 200 } };
    },
  } as unknown as ModernClient;
  return { modern, calls };
}

const activeSnap = (tools: Record<string, unknown>[]) => snap({ tools, active: true });

describe('F023: the wrong-type call uses a value the schema really rejects', () => {
  it('picks a type outside a union, and none for an untyped, anyOf-only or $ref-only property', () => {
    expect(wrongTypeValue({ type: 'string' })).toBe(12345);
    expect(wrongTypeValue({ type: 'number' })).toBe('mcp-review-check-wrong-type');
    expect(wrongTypeValue({ type: ['string', 'number'] })).toBe(true);
    expect(wrongTypeValue({ type: ['number', 'string'] })).toBe(true);
    expect(wrongTypeValue({ type: ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'] })).toBeUndefined();
    for (const s of [undefined, {}, { anyOf: [{ type: 'string' }, { type: 'number' }] }, { $ref: '#/$defs/x' }, { description: 'any' }]) {
      expect(wrongTypeValue(s), JSON.stringify(s)).toBeUndefined();
    }
  });

  it('runActive skips the invalid-type call when no certain wrong-type value exists, so RT-002 cannot fire on it', async () => {
    const { modern, calls } = recordingModern();
    const s = activeSnap([tool({ name: 'get_item', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, required: ['id'] } })]);
    s.active = await runActive({ snap: s, timeoutMs: 5000, now: () => 0, modern });
    expect(s.active.calls.map((c) => c.kind)).toEqual(['synthetic', 'invalid-missing']);
    expect(calls).toHaveLength(2);
    expect(evaluate(byId('RT-002'), s)).toEqual([]);
  });
});
