// Regression tests for the W6D-core remediation (review 2026-11-01, wave 6): exchanges keep a snippet, size, digest
// and JSON-RPC summary instead of the whole parsed body (F036), and one byte budget per snapshot stops reading once it
// is spent (F146).
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, collectErrors, stdoutTap } from '../src/connect.js';
import { charge, createBudget, limitsNotice, SNAPSHOT_BUDGET } from '../src/limits.js';
import { paginate } from '../src/protocol/legacy.js';
import { BUDGET_ERROR, capBody, createRedactor, createTracer, scrub, summarizeJsonRpc } from '../src/protocol/trace.js';
import { emptySnapshot, type HttpExchange } from '../src/snapshot.js';
import { startModernServer } from './fixtures/modern-server.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });

async function serve(handler: Handler): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  const srv = createServer((req, res) => {
    hits++;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`, hits: () => hits };
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('exchanges keep a snippet, size, digest and JSON-RPC summary, not the parsed body (F036)', () => {
  it('a tracer with keepJson false returns the parsed body once and keeps only the summary on the exchange', async () => {
    const answer = { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a' }] } };
    const s = await serve((_req, _body, res) => json(res, 200, answer));
    const tracer = createTracer(createRedactor(), undefined, undefined, { keepJson: false });
    const r = await tracer.request('modern tools/list', s.url, { ...post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), fullBody: true });
    expect(r.json).toEqual(answer);
    expect(r.exchange.json).toBeUndefined();
    const text = JSON.stringify(answer);
    expect(r.exchange.bodyBytes).toBe(Buffer.byteLength(text));
    expect(r.exchange.bodySha256).toBe(sha(text));
    expect(r.exchange.jsonRpc).toEqual([{ id: 1, result: true }]);
    expect(r.exchange.bodySnippet).toBe(text);
  });

  it('keepJson on one request keeps that body (a wire probe the rules read); the default tracer keeps every body', async () => {
    const s = await serve((_req, _body, res) => json(res, 400, { jsonrpc: '2.0', id: 2, error: { code: -32020, message: 'header mismatch' } }));
    const tracer = createTracer(createRedactor(), undefined, undefined, { keepJson: false });
    const kept = await tracer.request('headerMismatch (none)', s.url, { ...post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), keepJson: true });
    expect(kept.exchange.json).toMatchObject({ error: { code: -32020 } });
    expect(kept.exchange.jsonRpc).toEqual([{ id: 2, error: { code: -32020, message: 'header mismatch' } }]);
    const legacyDefault = await createTracer(createRedactor()).request('t', s.url, post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    expect(legacyDefault.exchange.json).toMatchObject({ id: 2 });
  });

  it('the SDK traffic keeps no parsed body, only its summary', async () => {
    const s = await serve((_req, body, res) => json(res, 200, { jsonrpc: '2.0', id: JSON.parse(body).id, result: { tools: [] } }));
    const tracer = createTracer(createRedactor(), undefined, undefined, { keepJson: false });
    const res = await tracer.fetch(s.url, post({ jsonrpc: '2.0', id: 7, method: 'tools/list' }));
    expect(await res.json()).toMatchObject({ id: 7 });
    await tracer.flush();
    expect(tracer.exchanges[0].json).toBeUndefined();
    expect(tracer.exchanges[0].jsonRpc).toEqual([{ id: 7, result: true }]);
  });

  it('the digest of a body that holds a known secret is taken over the masked text', async () => {
    const SECRET = ['sk', 'live', 'SYNTHSYNTH0123456789abcde'].join('_'); // assembled at runtime so no key-shaped literal is committed
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: `bad key ${SECRET}` } });
    const s = await serve((_req, _b, res) => json(res, 400, body));
    const r = createRedactor([], [SECRET]);
    const { exchange } = await createTracer(r, undefined, undefined, { keepJson: false }).request('t', s.url, post({ jsonrpc: '2.0', id: 1, method: 'x' }));
    expect(exchange.bodySha256).toBe(sha(scrub(body, r)));
    expect(exchange.bodySha256).not.toBe(sha(body));
    expect(exchange.bodySnippet).not.toContain(SECRET);
  });

  it('summarizeJsonRpc keeps ids, errors and the result and method flags of each response, not the results', () => {
    expect(summarizeJsonRpc([{ jsonrpc: '2.0', id: 1, result: { big: 'x'.repeat(1000) } }, { id: 2, error: { code: -1, message: 'm', data: { d: 1 } } }, { method: 'notifications/x' }, 3]))
      .toEqual([{ id: 1, result: true }, { id: 2, error: { code: -1, message: 'm' } }]);
    expect(summarizeJsonRpc({ id: 5, method: 'sampling/createMessage', result: {} })).toEqual([{ id: 5, result: true, method: true }]);
    expect(summarizeJsonRpc(undefined)).toBeUndefined();
  });

  it('collectErrors reads the summary of an exchange without a parsed body', () => {
    const ex: HttpExchange = {
      label: 'modern tools/list', method: 'POST', url: 'http://x/mcp', requestHeaders: { 'mcp-protocol-version': '2026-07-28' },
      requestJson: { jsonrpc: '2.0', id: 4, method: 'tools/list' }, durationMs: 1,
      jsonRpc: [{ id: 999, result: true }, { id: 4, error: { code: -32602, message: 'bad cursor' } }],
    };
    expect(collectErrors({ exchanges: [ex] }, undefined)).toEqual([
      { source: 'modern tools/list', requestId: 4, responseId: 999, modern: true, result: true, method: 'tools/list' },
      { source: 'modern tools/list', requestId: 4, responseId: 4, code: -32602, message: 'bad cursor', modern: true },
    ]);
  });

  it('a 2026-07-28 run keeps the parsed body only on the probes; listings and results live in their snapshot fields', async () => {
    const s = await startModernServer();
    closers.push(() => s.close());
    const { snap } = await buildSnapshot({ target: { kind: 'http', url: s.url }, timeoutMs: 10000 });
    expect(snap.era).toBe('modern');
    expect(snap.tools.map((t) => t.name)).toEqual(['search_docs', 'get_page']);
    const probes = new Set(Object.values(snap.transport.probes));
    const others = snap.transport.exchanges.filter((e) => !probes.has(e));
    expect(others.some((e) => e.label === 'modern tools/list')).toBe(true);
    for (const e of others) expect(e.json, e.label).toBeUndefined();
    const listing = others.find((e) => e.label === 'modern tools/list')!;
    expect(listing.jsonRpc).toEqual([{ id: expect.any(Number), result: true }]);
    expect(listing.bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(listing.bodyBytes).toBeGreaterThan(0);
    // The probes the SPEC rules read through rpcView keep theirs.
    expect(snap.transport.probes.discover && 'json' in snap.transport.probes.discover && snap.transport.probes.discover.json).toBeTruthy();
    expect((snap.transport.probes.unknownMethodModern as HttpExchange).json).toMatchObject({ error: { code: -32601 } });
    expect(snap.transport.modernResults?.some((r) => r.method === 'tools/list')).toBe(true);
    expect(snap.transport.observedErrors?.some((e) => e.source === 'unknownMethod (modern)')).toBe(true);
  });
});

describe('one byte budget per snapshot (F146)', () => {
  it('charge: the charge that does not fit spends the budget, records the excess and calls onExhausted once', () => {
    const b = createBudget(10);
    let calls = 0;
    b.onExhausted = () => { calls++; };
    expect(charge(b, 6)).toBe(true);
    expect(charge(b, 6)).toBe(false);
    expect(b.exhausted).toEqual({ overBytes: 2 });
    expect(b.used).toBe(10);
    expect(charge(b, 1)).toBe(false);
    expect(calls).toBe(1);
    expect(charge(undefined, 1e12)).toBe(true);
    expect(SNAPSHOT_BUDGET).toBe(64 * 1024 * 1024);
  });

  it('a raw read stops at the budget and the tracer sends nothing more', async () => {
    const s = await serve((_req, _body, res) => json(res, 200, { jsonrpc: '2.0', id: 1, result: { pad: 'p'.repeat(2000) } }));
    const budget = createBudget(500);
    const tracer = createTracer(createRedactor(), undefined, undefined, { keepJson: false, budget });
    const first = await tracer.request('modern tools/list', s.url, { ...post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), fullBody: true });
    expect(first.exchange.error).toEqual({ name: 'SnapshotBudget', message: `${BUDGET_ERROR}: response body cut after 500 bytes` });
    expect(first.json).toBeUndefined();
    expect(budget.exhausted?.overBytes).toBeGreaterThan(0);
    const second = await tracer.request('modern tools/list', s.url, post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    expect(second.exchange.error?.message).toBe(`${BUDGET_ERROR}: request not sent`);
    expect(s.hits()).toBe(1);
    await expect(tracer.fetch(s.url, post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }))).rejects.toThrow(BUDGET_ERROR);
    expect(s.hits()).toBe(1);
  });

  it('the SDK response fails once the budget is spent', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(`{"a":"${'x'.repeat(600)}"}`)); c.close(); } });
    const res = capBody(new Response(stream, { headers: { 'content-type': 'application/json' } }), 1 << 20, createBudget(100));
    await expect(res.text()).rejects.toThrow(BUDGET_ERROR);
  });

  it('a listing asks for no page once the budget is spent', async () => {
    const b = createBudget(1);
    charge(b, 2);
    let asked = 0;
    const r = await paginate(async () => { asked++; return { result: { tools: [] }, bytes: 0 }; }, 'tools/list', 'tools', 100, b);
    expect(r).toEqual({ items: [], pages: [], error: BUDGET_ERROR });
    expect(asked).toBe(0);
  });

  it('the stdio reader counts JSON-RPC message lines only', () => {
    const sizes: number[] = [];
    const tap = stdoutTap(createRedactor(), (n) => sizes.push(n));
    tap.push(Buffer.from('starting up\n{"jsonrpc":"2.0","id":1,"result":{}}\n{"level":30,"msg":"log"}\n'));
    expect(sizes).toEqual([Buffer.byteLength('{"jsonrpc":"2.0","id":1,"result":{}}')]);
    expect(tap.out.total).toBe(2);
  });

  it('a stdio run whose listing spends the budget stops there, records the cut and still returns a snapshot', async () => {
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: [join(FIXTURES, 'many-tools-server.mjs')] }, timeoutMs: 15000, snapshotBudget: 20000 });
    expect(snap.era).toBe('legacy');
    expect(snap.limits?.budgetExhausted).toMatchObject({ bytes: 20000, phase: 'listing', completed: ['connect'], unfinished: expect.arrayContaining(['listing', 'wire probes']) });
    expect(snap.limits?.budgetExhausted?.overBytes).toBeGreaterThan(0);
    const cut = snap.limits!.truncated.find((t) => t.unit === 'bytes')!;
    expect(cut.where).toBe(`snapshot budget (${snap.limits!.budgetExhausted!.overBytes} bytes over)`);
    expect(cut.cap).toBe(20000);
    expect(snap.limits?.stopped).toBeUndefined();
    expect(snap.coverage).toEqual({ toolLevel: 'stopped', reason: `${BUDGET_ERROR} (20000 bytes) during listing` });
    expect(snap.tools).toEqual([]);
    expect(limitsNotice(snap)).toMatch(/snapshot budget of 20 KB exhausted during listing \(\d+ bytes over\); later reads were skipped/);
  });

  it('the same server under the default budget is not cut', async () => {
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: [join(FIXTURES, 'many-tools-server.mjs')] }, timeoutMs: 15000 });
    expect(snap.tools).toHaveLength(400);
    expect(snap.limits?.budgetExhausted).toBeUndefined();
    expect(snap.coverage.toolLevel).toBe('ok');
  });

  it('a 2026-07-28 listing over the budget stops the HTTP run at that read', async () => {
    const s = await startModernServer({ extraTools: 200 });
    closers.push(() => s.close());
    const { snap } = await buildSnapshot({ target: { kind: 'http', url: s.url }, timeoutMs: 10000, snapshotBudget: 100000 });
    expect(snap.era).toBe('modern');
    expect(snap.limits?.budgetExhausted).toMatchObject({ bytes: 100000, phase: 'listing' });
    const listing = snap.transport.exchanges.find((e) => e.label === 'modern tools/list');
    expect(listing?.error?.name).toBe('SnapshotBudget');
    // Nothing after the cut was sent: no wire probe, no re-list.
    expect(Object.keys(snap.transport.probes)).not.toContain('unknownMethodModern');
    expect(snap.transport.exchanges.filter((e) => e.label === 'modern tools/list')).toHaveLength(1);
    expect(snap.coverage.toolLevel).toBe('stopped');
  });

  it('a stop with no handshake yet is a fatal error that names the budget', async () => {
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: [join(FIXTURES, 'many-tools-server.mjs')] }, timeoutMs: 15000, snapshotBudget: 10 });
    expect(snap.fatal).toBe('no handshake within the snapshot budget (10 bytes)');
    expect(snap.coverage.toolLevel).toBe('connect-failed');
    expect(snap.limits?.budgetExhausted?.phase).toBe('connect');
  });

  it('limitsNotice formats a bytes record', () => {
    const snap = emptySnapshot({ kind: 'stdio', command: 'x', args: [] }, { target: 'all', active: false, activeAuth: false });
    snap.limits = { truncated: [{ where: 'snapshot budget (5 bytes over)', length: 105, cap: 100, unit: 'bytes' }] };
    expect(limitsNotice(snap)).toBe('1 oversized input truncated before pattern checks: snapshot budget (5 bytes over) (105 bytes, cap 100 bytes).');
  });
});
