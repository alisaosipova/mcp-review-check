// Regression tests for the W5C-connect remediation (review 2026-11-01, wave 5): the input caps cover the active calls'
// arguments and errors and the observed JSON-RPC errors (F146), the Origin probes a --max-duration stop interrupts keep
// the ones already made (R003), and a stop during the clientInfo variants leaves them out (R003, kept as is).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/connect.js';
import { capSnapshot, capValue, TEXT_CAP } from '../src/limits.js';
import { STOPPED_REASON, runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { RT_001, RT_005 } from '../src/rules/runtime.js';
import { SRV_008 } from '../src/rules/server.js';
import { SPEC_016 } from '../src/rules/spec.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';
import { tool } from './helpers.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
const servers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((c) => c())); });

/** A local HTTP server on 127.0.0.1; closed after each test (requests left unanswered included). */
async function serve(handler: Handler): Promise<string> {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
type Msg = { id?: unknown; method?: string; params?: Record<string, any> };
const parse = (body: string): Msg => { try { return JSON.parse(body); } catch { return {}; } };

interface Legacy {
  /** Called first for every request; returning true means it was handled (or is left unanswered). */
  hook?: (req: IncomingMessage, m: Msg, res: ServerResponse) => boolean;
  tools?: unknown[];
  call?: (m: Msg, res: ServerResponse) => void;
}

/** A 2025-11-25 Streamable HTTP server (JSON responses, no session); `tools/call` per `call`, the rest -32601. */
function legacyServer(o: Legacy = {}): Handler {
  const tools = o.tools ?? [tool({ name: 'search_notes' })];
  return (req, body, res) => {
    const m = parse(body);
    if (o.hook?.(req, m, res)) return;
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    if (m.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    if (m.method === 'initialize') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'w5c', version: '1.0.0' } } });
    if (m.method === 'tools/list') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { tools } });
    if (m.method === 'tools/call' && o.call) return o.call(m, res);
    return json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
  };
}

const stdioSnap = (): Snapshot => emptySnapshot({ kind: 'stdio', command: 'node', args: [] }, { target: 'all', active: true, activeAuth: false });

describe('input caps on the active calls and the observed errors (F146)', () => {
  it('cuts long strings in args, jsonRpcError, transportError and observed errors to TEXT_CAP, keeps the structure and records each cut', () => {
    const big = 'x'.repeat(TEXT_CAP + 100);
    const s = stdioSnap();
    s.active = { calls: [
      { tool: 'a', kind: 'valid', args: { query: big, nested: { list: [big, 'short'] }, limit: 5 }, result: { content: [] }, durationMs: 1 },
      { tool: 'b', kind: 'invalid-missing', args: {}, jsonRpcError: { code: -32602, message: big, data: { detail: big } }, durationMs: 1 },
      { tool: 'c', kind: 'synthetic', args: {}, transportError: `TypeError: ${big}`, durationMs: 1 },
      { tool: 'd', kind: 'synthetic', args: { q: 'fine' }, jsonRpcError: { code: -32602, message: 'month required' }, durationMs: 1 },
    ] };
    s.transport.observedErrors = [
      { source: 'sdk tools/call', requestId: 3, responseId: 3, code: -32602, message: big },
      { source: 'unknownMethod', requestId: 4, responseId: 4, code: big, message: 'nope' },
    ];
    const cut = capSnapshot(s);
    expect(cut).toEqual([
      { where: 'tools/call a args', length: big.length, cap: TEXT_CAP },
      { where: 'tools/call b JSON-RPC error', length: big.length, cap: TEXT_CAP },
      { where: 'tools/call c transport error', length: big.length + 'TypeError: '.length, cap: TEXT_CAP },
      { where: 'observed JSON-RPC errors', length: big.length, cap: TEXT_CAP },
    ]);
    expect(s.limits?.truncated).toEqual(cut);
    const [a, b, c, d] = s.active.calls;
    expect(a.args).toEqual({ query: big.slice(0, TEXT_CAP), nested: { list: [big.slice(0, TEXT_CAP), 'short'] }, limit: 5 });
    expect(b.jsonRpcError).toEqual({ code: -32602, message: big.slice(0, TEXT_CAP), data: { detail: big.slice(0, TEXT_CAP) } });
    expect(c.transportError).toBe(`TypeError: ${big}`.slice(0, TEXT_CAP));
    expect(d).toEqual({ tool: 'd', kind: 'synthetic', args: { q: 'fine' }, jsonRpcError: { code: -32602, message: 'month required' }, durationMs: 1 });
    expect(s.transport.observedErrors.map((e) => [String(e.code).length, String(e.message).length])).toEqual([[6, TEXT_CAP], [TEXT_CAP, 4]]);
  });

  it('a snapshot without anything oversized records nothing; a string or primitive argument is handled too', () => {
    const s = stdioSnap();
    s.active = { calls: [{ tool: 'a', kind: 'valid', args: 'plain', jsonRpcError: 'odd', durationMs: 1 }] };
    s.transport.observedErrors = [{ source: 'x', code: -32601, message: 'Method not found' }];
    expect(capSnapshot(s)).toEqual([]);
    expect(s.limits).toBeUndefined();
    const out: NonNullable<Snapshot['limits']>['truncated'] = [];
    expect(capValue('y'.repeat(TEXT_CAP + 1), TEXT_CAP, 'w', out)).toHaveLength(TEXT_CAP);
    expect(capValue(42, TEXT_CAP, 'w', out)).toBe(42);
    expect(capValue(null, TEXT_CAP, 'w', out)).toBeNull();
    expect(out).toEqual([{ where: 'w', length: TEXT_CAP + 1, cap: TEXT_CAP }]);
  });

  it('the rules reading the capped text still match on it: RT-001 on the head of the error, RT-005 and SPEC-016 quote a prefix', () => {
    const tail = 'z'.repeat(TEXT_CAP * 2);
    const s = stdioSnap();
    s.active = { calls: [
      { tool: 'a', kind: 'invalid-missing', args: {}, jsonRpcError: { code: -32603, message: `TypeError: bad\n    at run (/srv/app.js:10:5)\n${tail}` }, durationMs: 1 },
      { tool: 'b', kind: 'synthetic', args: {}, transportError: `McpError: timed out ${tail}`, durationMs: 1000 },
    ] };
    s.transport.observedErrors = [{ source: 'unknownMethod', requestId: 4, responseId: 4, code: `E${tail}` }];
    capSnapshot(s);
    expect(RT_001.check(s).map((f) => f.message)).toEqual(['error for invalid-missing input leaks a stack trace']);
    const rt5 = RT_005.check(s).map((f) => f.message);
    expect(rt5).toHaveLength(1);
    expect(rt5[0]).toMatch(/^synthetic call got no answer after 1000 ms: McpError: timed out z+ \(raise --timeout/);
    expect(rt5[0].length).toBeLessThan(TEXT_CAP + 200);
    const spec16 = SPEC_016.check(s).map((f) => f.message);
    expect(spec16).toHaveLength(1);
    expect(spec16[0]).toMatch(/^unknownMethod: error code "Ez+" is not an integer$/);
    expect(spec16[0].length).toBeLessThan(TEXT_CAP + 100);
  });

  it('an --active run against a server with a 40 KB error message keeps the capped error and records it', async () => {
    const huge = 'e'.repeat(40 * 1024);
    const url = await serve(legacyServer({ call: (m, res) => json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: huge } }) }));
    const longArg = 'k'.repeat(TEXT_CAP + 10);
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 10000, active: true, toolArgs: { search_notes: { keywords: longArg } } });
    const calls = snap.active?.calls ?? [];
    expect(calls.map((c) => c.kind)).toEqual(['valid', 'invalid-missing', 'invalid-type']);
    for (const c of calls) expect(((c.jsonRpcError as { message: string }).message).length).toBe(TEXT_CAP);
    expect(calls[0].args).toEqual({ keywords: longArg.slice(0, TEXT_CAP) });
    const where = (snap.limits?.truncated ?? []).map((t) => t.where);
    expect(where).toEqual(expect.arrayContaining(['tools/call search_notes args', 'tools/call search_notes JSON-RPC error']));
    for (const e of snap.transport.observedErrors ?? []) if (typeof e.message === 'string') expect(e.message.length).toBeLessThanOrEqual(TEXT_CAP);
    // RT-003 still sees the JSON-RPC errors of the invalid calls.
    expect(runRules(snap, RULES).findings.filter((f) => f.ruleId === 'RT-003')).toHaveLength(2);
  }, 30000);
});

/**
 * A legacy server that never answers the Origin probe sending `hang` ('none': the probe without an Origin, which is
 * the first Origin-less initialize after the listing) and answers 403 to the Origins in `forbid`.
 */
function originServer(hang: string, forbid: string[] = []): Handler {
  let listed = false;
  return legacyServer({
    hook: (req, m, res) => {
      if (m.method === 'tools/list') listed = true;
      if (m.method !== 'initialize' || !listed) return false;
      const origin = req.headers.origin;
      if ((origin ?? 'none') === hang) return true; // left unanswered
      if (origin && forbid.includes(origin)) { json(res, 403, { error: 'forbidden origin' }); return true; }
      return false;
    },
  });
}

describe('a stop during the Origin probes keeps the ones already made (R003)', () => {
  const run = async (handler: Handler) => {
    const url = await serve(handler);
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, maxDurationMs: 2500 });
    return snap;
  };
  const origins = (s: Snapshot) => (['originNone', 'originClaude', 'originChatgpt', 'originEvil'] as const).filter((k) => s.transport.probes[k]);

  it('the probes before the hung one are in the snapshot, the phase is unfinished, and SRV-008 reports what it saw', async () => {
    const snap = await run(originServer('https://chatgpt.com', ['https://claude.ai']));
    expect(snap.limits?.stopped).toMatchObject({ phase: 'wire probes' });
    expect(snap.limits?.stopped?.unfinished?.[0]).toBe('wire probes');
    expect(snap.coverage.toolLevel).toBe('stopped');
    expect(origins(snap)).toEqual(['originNone', 'originClaude']);
    expect(snap.transport.probes.originClaude).toMatchObject({ status: 403 });
    const r = runRules(snap, [SRV_008]);
    expect(r.findings.map((f) => f.message)).toEqual(['Origin https://claude.ai gets 403 (assumed host Origin, not verified; a server that rejects foreign Origins follows the spec)']);
    expect(r.skipped).toEqual([]);
  }, 30000);

  it('nothing wrong in the probes made so far is no pass: SRV-008 is skipped as stopped', async () => {
    const snap = await run(originServer('https://evil.mcp-review-check.invalid'));
    expect(origins(snap)).toEqual(['originNone', 'originClaude', 'originChatgpt']);
    expect(runRules(snap, [SRV_008]).skipped).toEqual([{ ruleId: 'SRV-008', reason: STOPPED_REASON }]);
  }, 30000);

  it('a stop on the first Origin probe keeps none, and SRV-008 is skipped as stopped', async () => {
    const snap = await run(originServer('none'));
    expect(snap.limits?.stopped?.phase).toBe('wire probes');
    expect(origins(snap)).toEqual([]);
    expect(snap.transport.probes.get ?? snap.transport.probes.badVersion).toBeDefined();
    expect(runRules(snap, [SRV_008]).skipped).toEqual([{ ruleId: 'SRV-008', reason: STOPPED_REASON }]);
  }, 30000);
});

describe('a stop during the clientInfo variants leaves them out (R003, kept as is)', () => {
  it('the calls are kept, clientInfoVariants is absent and RT-012 is skipped as stopped', async () => {
    // The fresh connection named claude-ai never gets its initialize answered.
    const url = await serve(legacyServer({
      hook: (_req, m) => m.method === 'initialize' && (m.params?.clientInfo as { name?: string } | undefined)?.name === 'claude-ai',
      call: (m, res) => json(res, 200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ok' }], isError: true } }),
    }));
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, active: true, maxDurationMs: 3000 });
    expect(snap.limits?.stopped).toMatchObject({ phase: 'active tool calls', unfinished: ['active tool calls'] });
    expect(snap.active?.calls.map((c) => c.kind)).toEqual(['synthetic', 'invalid-missing', 'invalid-type']);
    expect(snap.active?.clientInfoVariants).toBeUndefined();
    expect(runRules(snap, RULES).skipped).toContainEqual({ ruleId: 'RT-012', reason: STOPPED_REASON });
  }, 30000);
});
