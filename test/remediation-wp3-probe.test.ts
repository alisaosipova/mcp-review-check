// Regression tests for the WP3-probe remediation (review 2026-11-01): wire probes, --active, network and auth probes.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModernClient } from '../src/protocol/modern.js';
import { createRedactor, createTracer } from '../src/protocol/trace.js';
import { placeholder, runActive, synthesizeArgs, wrongTypeValue } from '../src/probe/active.js';
import { METADATA_RETRY_BUDGET, METADATA_TIMEOUT_MS, prmCandidates, runAuthProbe } from '../src/probe/auth.js';
import { closeProbeSession, defaultTlsCheck, originProbes, preflight, sameHostRedirect, TLS_TIMEOUT_MS, tlsCheckWithRetry, type Deps } from '../src/probe/network.js';
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

describe('F030: sessions minted by raw initialize probes are closed', () => {
  it('sends one DELETE per minted session after the preflight and the Origin probes, and none when no session is minted', async () => {
    let n = 0;
    const { base, seen } = await listen((req, res) => {
      if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
      if (req.method === 'POST' && req.headers.origin !== 'https://evil.mcp-review-check.invalid') {
        json(res, 200, { jsonrpc: '2.0', id: 0, result: {} }, { 'mcp-session-id': `probe-session-${++n}-0123456789` });
        return;
      }
      json(res, 403, { error: 'forbidden' });
    });
    const url = new URL(`${base}/mcp`);
    const tracer = createTracer(createRedactor());
    const pf = await preflight(tracer, url, 5000, async () => {});
    expect(pf.status).toBe(200);
    await originProbes(tracer, url, { authorization: 'Bearer t' }, 'initialize', 5000, async () => {});
    const deletes = seen.filter((r) => r.method === 'DELETE');
    // preflight + 3 accepted Origins; the 403 to the foreign Origin minted nothing
    expect(deletes.map((r) => r.headers['mcp-session-id'])).toEqual([1, 2, 3, 4].map((i) => `probe-session-${i}-0123456789`));
    expect(deletes.slice(1).every((r) => r.headers.authorization === 'Bearer t')).toBe(true);
    expect(tracer.exchanges.filter((e) => e.method === 'DELETE').map((e) => e.label)).toEqual(['preflight (close session)', 'origin (none) (close session)', 'origin claude.ai (close session)', 'origin chatgpt.com (close session)']);
  });

  it('does not send a redacted or malformed session id', async () => {
    const tracer = createTracer(createRedactor());
    await closeProbeSession(tracer, 'http://127.0.0.1:9/mcp', exchange({ status: 200, headers: { 'mcp-session-id': '«redacted»' } }), {}, 5000);
    await closeProbeSession(tracer, 'http://127.0.0.1:9/mcp', exchange({ status: 404, headers: { 'mcp-session-id': 'abc' } }), {}, 5000);
    expect(tracer.exchanges).toEqual([]);
  });
});

describe('F031: the TLS check follows --timeout and stops at the --max-duration deadline', () => {
  const baseDeps = (tlsCheck: Deps['tlsCheck']): Deps => ({
    resolve4: async () => [], resolve6: async () => [], tlsCheck, now: () => 0, sleep: async () => {},
  });

  it('passes the lower of --timeout and 10 s to each handshake', async () => {
    const seen: Array<number | undefined> = [];
    const deps = baseDeps(async (_h, _p, o) => { seen.push(o?.timeoutMs); return { ok: true }; });
    await tlsCheckWithRetry(deps, 'a.test', 443, { timeoutMs: 2000 });
    await tlsCheckWithRetry(deps, 'a.test', 443, { timeoutMs: 60000 });
    await tlsCheckWithRetry(deps, 'a.test', 443);
    expect(seen).toEqual([2000, TLS_TIMEOUT_MS, TLS_TIMEOUT_MS]);
  });

  it('does not retry after the deadline aborts and reports the result as inconclusive, not as a failed certificate', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    const deps = baseDeps(async () => { attempts++; ctrl.abort(); return { ok: false, code: 'ECONNRESET' }; });
    const r = await tlsCheckWithRetry(deps, 'a.test', 443, { signal: ctrl.signal });
    expect(attempts).toBe(1);
    expect(r).toMatchObject({ ok: false, transient: true });
  });

  it('defaultTlsCheck returns at once when the signal has already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await defaultTlsCheck('127.0.0.1', 9, 10000, ctrl.signal)).toEqual({ ok: false, code: 'ABORT_ERR' });
  });
});

describe('F037: the auth probe requests each metadata URL once and shares one retry budget', () => {
  it('does not list the well-known URL again when the header already names it', () => {
    const u = new URL('https://a.test/mcp');
    expect(prmCandidates(u, 'https://a.test/.well-known/oauth-protected-resource/mcp').map((c) => c.via)).toEqual(['header', 'well-known-root']);
    expect(prmCandidates(u, 'https://a.test/.well-known/oauth-protected-resource').map((c) => c.via)).toEqual(['header', 'well-known-path']);
    expect(prmCandidates(u, 'https://a.test/prm').map((c) => c.via)).toEqual(['header', 'well-known-path', 'well-known-root']);
  });

  it('stops retrying failing AS metadata URLs once the shared budget is spent, and caps each GET at 10 s', async () => {
    let base = '';
    const { base: b, seen } = await listen((req, res) => {
      if (req.url === '/.well-known/oauth-protected-resource/mcp') {
        json(res, 200, { resource: `${base}/mcp`, authorization_servers: [1, 2, 3].map((i) => `${base}/tenant${i}`) });
        return;
      }
      if (req.method === 'GET') { json(res, 503, { error: 'unavailable' }); return; }
      json(res, 401, {}, { 'www-authenticate': 'Bearer' });
    });
    base = b;
    const url = new URL(`${base}/mcp`);
    const tracer = createTracer(createRedactor());
    const timeouts: Array<number | undefined> = [];
    const labels: string[] = [];
    const request = tracer.request;
    tracer.request = (label, u, init) => { labels.push(label); timeouts.push(init?.timeoutMs); return request(label, u, init); };
    const challengeExchange = exchange({ status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` } });
    const deps: Deps = { resolve4: async () => [], resolve6: async () => [], tlsCheck: async () => ({ ok: true }), now: () => performance.now(), sleep: async () => {} };
    const { probe } = await runAuthProbe({ tracer, url, trigger: 'preflight-401', challengeExchange, deps, timeoutMs: 60000, activeAuth: false });
    expect(probe.prm?.via).toBe('header');
    // 3 issuers x 3 discovery URLs = 9 URLs; the budget of 6 retries covers the first three, the rest get one attempt
    expect(seen.filter((r) => r.path.includes('oauth-authorization-server') || r.path.includes('openid-configuration'))).toHaveLength(9 + METADATA_RETRY_BUDGET);
    expect(probe.as.map((a) => a.attempts.length)).toEqual([9, 3, 3]);
    expect(new Set(timeouts.filter((t, i) => labels[i].startsWith('auth prm') || labels[i].startsWith('auth as-metadata')))).toEqual(new Set([METADATA_TIMEOUT_MS]));
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

describe('F029: synthesized arguments follow formats, bounds, nested required properties and $ref', () => {
  it('keeps the documented order and plain placeholders', () => {
    expect(synthesizeArgs({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer', default: 5 }, c: { enum: ['x'] }, d: { type: 'boolean' }, e: { type: 'array' }, f: { type: 'object' }, g: { type: 'number' } }, required: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))
      .toEqual({ a: 'mcp-review-check', b: 5, c: 'x', d: false, e: [], f: {}, g: 1 });
  });

  it('fills string formats and lengths, numeric bounds, minItems and nested required properties', () => {
    const args = synthesizeArgs({
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        email: { type: 'string', format: 'email' },
        when: { type: 'string', format: 'date-time' },
        id: { type: 'string', format: 'uuid' },
        code: { type: 'string', minLength: 20 },
        short: { type: 'string', maxLength: 3 },
        page: { type: 'integer', minimum: 10 },
        above: { type: 'integer', exclusiveMinimum: 0, multipleOf: 5 },
        ratio: { type: 'number', maximum: 0.5 },
        tags: { type: 'array', minItems: 2, items: { type: 'string', enum: ['a', 'b'] } },
        filter: { type: 'object', properties: { field: { type: 'string' }, limit: { type: 'integer' } }, required: ['field'] },
        maybe: { type: ['null', 'integer'] },
      },
      required: ['url', 'email', 'when', 'id', 'code', 'short', 'page', 'above', 'ratio', 'tags', 'filter', 'maybe'],
    });
    expect(args).toEqual({
      url: 'https://example.com/', email: 'user@example.com', when: '2026-01-01T00:00:00Z', id: '00000000-0000-4000-8000-000000000000',
      code: 'mcp-review-checkxxxx', short: 'mcp', page: 10, above: 5, ratio: 0.5, tags: ['a', 'a'], filter: { field: 'mcp-review-check' }, maybe: 1,
    });
  });

  it('resolves local $ref and takes the first non-null anyOf/oneOf branch', () => {
    const schema = {
      type: 'object',
      $defs: { Range: { type: 'object', properties: { from: { type: 'string', format: 'date' } }, required: ['from'] } },
      properties: {
        range: { $ref: '#/$defs/Range' },
        q: { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 3 }] },
        loop: { $ref: '#/properties/loop' },
        missing: { $ref: '#/$defs/Nope' },
      },
      required: ['range', 'q', 'loop', 'missing'],
    };
    expect(synthesizeArgs(schema)).toEqual({ range: { from: '2026-01-01' }, q: 3, loop: 'mcp-review-check', missing: 'mcp-review-check' });
    expect(placeholder({ oneOf: [{ type: 'boolean' }, { type: 'string' }] })).toBe(false);
  });
});

describe('F144: --tool-args is looked up by own key only', () => {
  it('synthesizes arguments for tools named after Object.prototype members', async () => {
    const { modern, calls } = recordingModern();
    const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] };
    const names = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'get_x'];
    const s = activeSnap(names.map((name) => tool({ name, inputSchema: schema })));
    const r = await runActive({ snap: s, toolArgs: JSON.parse('{"get_x":{"q":"a"}}'), timeoutMs: 5000, now: () => 0, modern });
    const first = (n: string) => r.calls.find((c) => c.tool === n)!;
    for (const n of names.slice(0, 4)) expect(first(n), n).toMatchObject({ kind: 'synthetic', args: { q: 'mcp-review-check' } });
    expect(first('get_x')).toMatchObject({ kind: 'valid', args: { q: 'a' } });
    expect(calls.filter((c) => c.name === 'constructor')[0].arguments).toEqual({ q: 'mcp-review-check' });
  });
});

describe('C002: a duplicated tool name is called only when every entry with it is safe', () => {
  it('does not call a name whose other entry is destructive, and calls a safe duplicate once', async () => {
    const { modern, calls } = recordingModern();
    const ro = { readOnlyHint: true, destructiveHint: false };
    const noArgs = { type: 'object', properties: {} };
    const s = activeSnap([
      tool({ name: 'workspace_status', inputSchema: noArgs, annotations: ro }),
      tool({ name: 'workspace_status', inputSchema: noArgs, annotations: { readOnlyHint: false, destructiveHint: true } }),
      tool({ name: 'list_notes', inputSchema: noArgs, annotations: ro }),
      tool({ name: 'list_notes', inputSchema: noArgs, annotations: ro }),
    ]);
    await runActive({ snap: s, timeoutMs: 5000, now: () => 0, modern });
    expect(calls.map((c) => c.name)).toEqual(['list_notes']);
  });
});
