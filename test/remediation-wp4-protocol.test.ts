// Regression tests for the WP4-protocol remediation pass (review 2026-11-01): src/protocol/{trace,modern,legacy}.ts.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRedactor, redactDeep } from '../src/redact.js';
import { capBody, createRedactor, createTracer, parseSseMessages, scrub } from '../src/protocol/trace.js';
import { ModernClient } from '../src/protocol/modern.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
const servers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((c) => c())); });

/** A local HTTP server on 127.0.0.1; closed after each test (open SSE streams included). */
async function serve(handler: Handler): Promise<URL> {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  return new URL(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`);
}

const rpcBody = (method: string, id: number) => JSON.stringify({ jsonrpc: '2.0', id, method, params: {} });
const post = (body: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body });
/** Answer on an SSE stream that stays open, as some servers do. */
const sseOpen = (res: ServerResponse, events: string, sep = '\n\n') => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(events.split('\n\n').filter(Boolean).map((e) => e.replace(/\n/g, sep === '\r\r' ? '\r' : '\n') + sep).join(''));
};

describe('scrub: short secrets and the marker (F119)', () => {
  it('masks a short secret only as a whole token, never inside a word or identifier', () => {
    const r = buildRedactor({ headers: { 'X-Api-Key': 'test' } });
    expect(scrub('sk-test-abc, test account, attestation, latest, run_tests', r)).toBe('sk-test-abc, «redacted» account, attestation, latest, run_tests');
    expect(scrub('key=test&x=1 "test" Bearer test', r)).toBe('key=«redacted»&x=1 "«redacted»" Bearer «redacted»');
  });

  it('keeps server data intact with a short --header value', () => {
    const s = redactDeep({ tools: [{ name: 'run_tests', description: 'Runs latest test suite' }] }, buildRedactor({ headers: { 'X-Api-Key': 'test' } }));
    expect(s.tools[0]).toEqual({ name: 'run_tests', description: 'Runs latest «redacted» suite' });
  });

  it('a long secret is still masked inside other text', () => {
    const r = createRedactor([], ['ABCDEFGHIJKLMNOP1']);
    expect(scrub('xxABCDEFGHIJKLMNOP1yy', r)).toBe('xx«redacted»yy');
  });

  it('a secret that is part of the marker does not break a marker put in for another secret', () => {
    const r = createRedactor([], ['ABCDEFGHIJKLMNOP1', 'redact']);
    expect(scrub('token=ABCDEFGHIJKLMNOP1 redact', r)).toBe('token=«redacted» «redacted»');
  });
});

describe('SSE line ends and response ids (F028, F024, R010)', () => {
  it('parses events whose lines end in a lone CR', () => {
    expect(parseSseMessages('data: {"a":1}\r\rdata: {"b":2}\r\r')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(parseSseMessages('event: message\r\ndata: {"a":1}\r\n\r\n')).toEqual([{ a: 1 }]);
  });

  it('stops reading an open CR-only SSE stream once the response arrives', async () => {
    const url = await serve((_req, body, res) => sseOpen(res, `data: ${JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { ok: true } })}\n\n`, '\r\r'));
    const tracer = createTracer(createRedactor());
    const t0 = Date.now();
    const { exchange } = await tracer.request('t', url, { ...post(rpcBody('tools/list', 1)), timeoutMs: 4000, fullBody: true });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(exchange.json).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  it('a string id that equals the numeric request id ends the read at once instead of at the timeout', async () => {
    const url = await serve((_req, body, res) => sseOpen(res, `data: ${JSON.stringify({ jsonrpc: '2.0', id: String(JSON.parse(body).id), result: { tools: [{ name: 'a' }] } })}\n\n`));
    const modern = new ModernClient(url, createTracer(createRedactor()), {}, 4000);
    const t0 = Date.now();
    const r = await modern.listAll('tools/list', 'tools');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.items).toEqual([{ name: 'a' }]);
    expect(r.error).toBeUndefined();
  });

  it.each(['json', 'sse'])('a %s result with another request id is not taken as the answer', async (mode) => {
    const msg = JSON.stringify({ jsonrpc: '2.0', id: 999, result: { tools: [{ name: 'a' }] } });
    const url = await serve((_req, _body, res) => {
      if (mode === 'sse') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${msg}\n\n`); } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(msg); }
    });
    const modern = new ModernClient(url, createTracer(createRedactor()), {}, 4000);
    const r = await modern.listAll('tools/list', 'tools');
    expect(r.items).toEqual([]);
    expect(r.error).toBe('response id 999 does not match request id 1');
    expect(modern.results).toEqual([]);
  });

  it('an error with id null still answers the request', async () => {
    const url = await serve((_req, _body, res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })); });
    const r = await new ModernClient(url, createTracer(createRedactor()), {}, 4000).request('tools/list');
    expect(r.idMismatch).toBeUndefined();
    expect(r.error).toEqual({ code: -32700, message: 'Parse error' });
  });
});

describe('latency samples for SRV-010 (F021, R008)', () => {
  /** /slow answers on SSE after 600 ms (headers at once), /json after 300 ms, /err with a fast 400, /redirect with a 307, /rpcerr with a 200 JSON-RPC error. */
  const server = () => serve((req, body, res) => {
    const id = (() => { try { return JSON.parse(body).id; } catch { return undefined; } })();
    const result = JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [] } });
    if (req.url === '/slow') { sseOpen(res, ': ping\n\n'); setTimeout(() => res.write(`data: ${result}\n\n`), 600); return; }
    if (req.url === '/json') { setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(result); }, 300); return; }
    if (req.url === '/redirect') { res.writeHead(307, { location: '/json' }); res.end(); return; }
    if (req.url === '/rpcerr') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'bad' } })); return; }
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32600, message: 'no' } }));
  });

  it('counts the time until the SSE answer arrives, not until the headers', async () => {
    const base = await server();
    const tracer = createTracer(createRedactor());
    const res = await tracer.fetch(new URL('/slow', base), post(rpcBody('tools/list', 1)));
    expect(res.status).toBe(200);
    res.body?.cancel().catch(() => {}); // the SDK's own read is not needed here
    await tracer.flush();
    expect(tracer.exchanges[0].durationMs).toBeLessThan(300);
    expect(tracer.timings['tools/list']).toHaveLength(1);
    expect(tracer.timings['tools/list'][0]).toBeGreaterThanOrEqual(550);
    const probe = await tracer.request('modern tools/list', new URL('/slow', base), { ...post(rpcBody('tools/list', 2)), timeoutMs: 4000, fullBody: true });
    expect(probe.exchange.json).toMatchObject({ id: 2 });
    expect(tracer.timings['tools/list'][1]).toBeGreaterThanOrEqual(550);
  });

  it('leaves out probes answered with an error status, a JSON-RPC error or a redirect', async () => {
    const base = await server();
    const tracer = createTracer(createRedactor());
    await tracer.request('preflight', new URL('/err', base), { ...post(rpcBody('initialize', 1)), timeoutMs: 4000 });
    await tracer.request('origin evil', new URL('/err', base), { ...post(rpcBody('initialize', 2)), timeoutMs: 4000 });
    await tracer.request('badVersion', new URL('/rpcerr', base), { ...post(rpcBody('tools/list', 3)), timeoutMs: 4000 });
    await tracer.request('hop', new URL('/redirect', base), { ...post(rpcBody('tools/list', 4)), timeoutMs: 4000 });
    expect(tracer.timings).toEqual({});
    await tracer.request('discover', new URL('/json', base), { ...post(rpcBody('initialize', 5)), timeoutMs: 4000, fullBody: true });
    expect(tracer.timings.initialize).toHaveLength(1);
    expect(tracer.timings.initialize[0]).toBeGreaterThanOrEqual(250);
  });
});

describe('a size cap on the responses the SDK reads (F138)', () => {
  const stream = (parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });

  it('a JSON body past the cap fails the read instead of being buffered whole', async () => {
    const res = capBody(new Response(stream(['{"a":"', 'x'.repeat(600), '"}']), { headers: { 'content-type': 'application/json' } }), 256);
    await expect(res.json()).rejects.toThrow('response body exceeded 256 bytes');
  });

  it('a body under the cap passes unchanged, with the status, headers, url and redirect flag', async () => {
    const orig = new Response(stream(['{"ok":', 'true}']), { status: 202, headers: { 'content-type': 'application/json' } });
    Object.defineProperties(orig, { url: { value: 'http://127.0.0.1/x' }, redirected: { value: true } });
    const res = capBody(orig, 256);
    expect([res.status, res.headers.get('content-type'), res.url, res.redirected]).toEqual([202, 'application/json', 'http://127.0.0.1/x', true]);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('an SSE stream is capped per event, so a long-lived stream of small events goes on', async () => {
    const events = Array.from({ length: 20 }, (_, i) => `data: {"n":${i},"pad":"${'p'.repeat(40)}"}\n\n`);
    const ok = capBody(new Response(stream(events), { headers: { 'content-type': 'text/event-stream' } }), 128);
    expect(parseSseMessages(await ok.text())).toHaveLength(20);
    const big = capBody(new Response(stream(['data: {"pad":"', 'p'.repeat(300), '"}\n\n']), { headers: { 'content-type': 'text/event-stream' } }), 128);
    await expect(big.text()).rejects.toThrow('response body exceeded 128 bytes');
  });

  it('the SDK fetch hands out the capped response and still records the exchange', async () => {
    const url = await serve((_req, body, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { tools: [] } })); });
    const tracer = createTracer(createRedactor());
    const res = await tracer.fetch(url, post(rpcBody('tools/list', 7)));
    expect(await res.json()).toMatchObject({ id: 7, result: { tools: [] } });
    await tracer.flush();
    expect(tracer.exchanges[0].json).toMatchObject({ id: 7 });
  });
});
