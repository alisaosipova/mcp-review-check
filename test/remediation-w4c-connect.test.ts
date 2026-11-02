// Regression tests for the W4C-connect remediation (review 2026-11-01, wave 4): a result that answers another request
// id reaches SPEC-016 (F024, R010), a run stopped by --max-duration keeps its finished wire probes and active calls and
// does not let rules pass on unfinished phases (R003), the input caps cover what a stopped run keeps (F146), and the
// snippet scrub stays on a prefix of the body (F036).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSnapshot, collectErrors } from '../src/connect.js';
import { capSnapshot, TEXT_CAP } from '../src/limits.js';
import { STOPPED_REASON, runRules, unfinishedPhases } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { SPEC_009, SPEC_016, SPEC_020 } from '../src/rules/spec.js';
import { RT_002 } from '../src/rules/runtime.js';
import { createRedactor, scrub, snippetOf } from '../src/protocol/trace.js';
import { emptySnapshot, PHASES, type HttpExchange, type Snapshot } from '../src/snapshot.js';
import { snap as snapOf, tool } from './helpers.js';

const WP2 = fileURLToPath(new URL('./fixtures/wp2-stdio-server.mjs', import.meta.url));

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
type Msg = { id?: unknown; method?: string; params?: Record<string, unknown> };
const parse = (body: string): Msg => { try { return JSON.parse(body); } catch { return {}; } };

/**
 * A 2026-07-28-only server (initialize gets -32022) that answers server/discover and tools/list with the request id,
 * and every other request with a result under id 999. `wrongList`: tools/list too.
 */
function wrongIdServer(wrongList = false): Handler {
  return (req, body, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
    const m = parse(body);
    if (m.method === 'initialize') return json(res, 400, { jsonrpc: '2.0', id: m.id ?? null, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'] } } });
    if (m.method === 'server/discover') {
      return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'wrong-id', version: '1.0.0' } } } });
    }
    if (m.method === 'tools/list' && !wrongList) return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { tools: [tool({ name: 'search_notes' })], ttlMs: 60000 } });
    return json(res, 200, { jsonrpc: '2.0', id: 999, result: {} });
  };
}

const exchange = (over: Partial<HttpExchange>): HttpExchange => ({ label: 'probe', method: 'POST', url: 'http://x/mcp', requestHeaders: {}, durationMs: 1, ...over });

describe('a result that answers another request id reaches SPEC-016 (F024, R010)', () => {
  it('collectErrors records a successful response with another id, without a code; a matching one, a server request and an error stay as before', () => {
    const req = (id: unknown, method = 'tools/call') => ({ jsonrpc: '2.0', id, method, params: {} });
    const modernHeaders = { 'mcp-protocol-version': '2026-07-28' };
    const errors = collectErrors({
      exchanges: [
        exchange({ label: 'unknownMethod (modern)', requestJson: req(4, 'x/y'), requestHeaders: modernHeaders, json: { jsonrpc: '2.0', id: 999, result: {} } }),
        exchange({ label: 'same id', requestJson: req(5), json: { jsonrpc: '2.0', id: 5, result: {} } }),
        exchange({ label: 'string id', requestJson: req(6), json: { jsonrpc: '2.0', id: '6', result: {} } }),
        exchange({ label: 'server request', requestJson: req(7), json: { jsonrpc: '2.0', id: 1, method: 'sampling/createMessage', params: {} } }),
        exchange({ label: 'error', requestJson: req(8), json: { jsonrpc: '2.0', id: 8, error: { code: -32601, message: 'nope' } } }),
        exchange({ label: 'sdk tools/call', requestJson: req(9), json: { jsonrpc: '2.0', id: 999, result: {} } }),
      ],
    }, undefined);
    expect(errors).toEqual([
      { source: 'unknownMethod (modern)', requestId: 4, responseId: 999, modern: true, result: true, method: 'x/y' },
      { source: 'string id', requestId: 6, responseId: '6', modern: false, result: true, method: 'tools/call' },
      { source: 'error', requestId: 8, responseId: 8, code: -32601, message: 'nope', modern: false },
    ]);
  });

  it('SPEC-016 reports the mismatch as a warning and skips the code check for the record', () => {
    const s = snapOf({ set: (x) => { x.transport.observedErrors = [{ source: 'unknownMethod (modern)', requestId: 4, responseId: 999, result: true, method: 'x/y' }]; } });
    const found = SPEC_016.check(s);
    expect(found).toEqual([{ severity: 'warning', message: 'unknownMethod (modern): result answers another request id (response id 999, request id 4)' }]);
    expect(found.some((f) => /is not an integer/.test(f.message))).toBe(false);
  });

  it('a modern server: the probes answered under another id are SPEC-016 findings, the listing is clean', async () => {
    const url = await serve(wrongIdServer());
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 3000 });
    expect(snap.era).toBe('modern');
    expect(snap.listMeta.tools?.error).toBeUndefined();
    const { findings } = runRules(snap, RULES);
    const spec016 = findings.filter((f) => f.ruleId === 'SPEC-016').map((f) => f.message);
    expect(spec016.some((m) => /^unknownMethod \(modern\): result answers another request id \(response id 999, request id \d+\)$/.test(m))).toBe(true);
    expect(spec016.some((m) => /is not an integer/.test(m))).toBe(false);
    expect(findings.filter((f) => f.ruleId === 'SPEC-020')).toEqual([]);
  });

  it('a failed listing is reported once: by SPEC-020, not again by SPEC-016 for the tools/list requests', async () => {
    const url = await serve(wrongIdServer(true));
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 3000 });
    expect(snap.listMeta.tools?.error).toMatch(/^response id 999 does not match request id \d+$/);
    expect(snap.transport.observedErrors?.some((e) => e.result && e.method === 'tools/list')).toBe(true);
    const { findings } = runRules(snap, RULES);
    expect(findings.filter((f) => f.ruleId === 'SPEC-020').map((f) => f.message)).toEqual([expect.stringMatching(/^tools\/list failed: response id 999 does not match request id \d+$/)]);
    const spec016 = findings.filter((f) => f.ruleId === 'SPEC-016').map((f) => f.message);
    expect(spec016.length).toBeGreaterThan(0); // the other probes
    expect(spec016.some((m) => /^(modern tools\/list|headerMismatch)/.test(m))).toBe(false);
  });

  it('SPEC-020 alone decides which listing it reports: an undeclared capability leaves the mismatch to SPEC-016', () => {
    const s = snapOf({ set: (x) => {
      x.era = 'modern';
      x.capabilities = { tools: {} };
      x.listMeta.prompts = { pages: 0, rawPages: [], error: 'response id 999 does not match request id 3' };
      x.transport.observedErrors = [{ source: 'modern prompts/list', requestId: 3, responseId: 999, result: true, method: 'prompts/list' }];
    } });
    expect(SPEC_020.check(s)).toEqual([]);
    expect(SPEC_016.check(s).map((f) => f.message)).toEqual(['modern prompts/list: result answers another request id (response id 999, request id 3)']);
  });
});

/**
 * A 2025-11-25 Streamable HTTP server (JSON responses, no session) with two read-only tools: `fast_lookup` answers at
 * once (with a 20 KB text, over TEXT_CAP), accepting even calls without its required argument; `slow_lookup` never answers.
 */
function slowActiveServer(): Handler {
  const tools = [
    tool({ name: 'fast_lookup' }),
    tool({ name: 'slow_lookup', inputSchema: { type: 'object', properties: {} } }),
  ];
  return (req, body, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
    const m = parse(body);
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    if (m.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    if (m.method === 'initialize') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'slow', version: '1.0.0' } } });
    if (m.method === 'tools/list') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { tools } });
    if (m.method === 'tools/call' && m.params?.name === 'fast_lookup') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'n'.repeat(20 * 1024) }] } });
    if (m.method === 'tools/call' && m.params?.name === 'slow_lookup') return; // never answered
    return json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
  };
}

describe('a run stopped by --max-duration keeps what it collected (R003)', () => {
  it('during active tool calls: the finished calls are kept (capped), their findings reported, the other RT rules skipped', async () => {
    const url = await serve(slowActiveServer());
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, active: true, maxDurationMs: 4000 });
    expect(snap.limits?.stopped).toMatchObject({ maxDurationMs: 4000, phase: 'active tool calls', unfinished: ['active tool calls'] });
    expect(snap.limits?.stopped?.completed).toEqual(expect.arrayContaining(['connect', 'listing', 'UI resource reads', 'wire probes', 'tools re-list', 'text-only tools/list']));
    expect(snap.coverage.toolLevel).toBe('stopped');
    // fast_lookup: synthetic, invalid-missing and invalid-type; slow_lookup's call was in flight.
    expect(snap.active?.calls.map((c) => `${c.tool} ${c.kind}`)).toEqual(['fast_lookup synthetic', 'fast_lookup invalid-missing', 'fast_lookup invalid-type']);
    expect(snap.transport.probes.unknownTool).toBeDefined();
    // F146: the kept call results go through the input caps.
    expect(snap.limits?.truncated).toContainEqual({ where: 'tools/call fast_lookup result', length: 20 * 1024, cap: TEXT_CAP });
    const r = runRules(snap, RULES);
    expect(r.findings.filter((f) => f.ruleId === 'RT-002').map((f) => f.message).sort()).toEqual([
      'call without the required arguments returned a success result', 'wrong-type argument returned a success result',
    ]);
    expect(r.skipped).toContainEqual({ ruleId: 'RT-005', reason: STOPPED_REASON });
    expect(r.skipped.some((s) => s.ruleId === 'RT-002')).toBe(false);
  }, 30000);

  it('during wire probes: the finished probes are kept, and the rules reading the unfinished ones are skipped, not passed', async () => {
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: [WP2, 'callhang'] }, timeoutMs: 20000, maxDurationMs: 2000 });
    expect(snap.limits?.stopped).toMatchObject({ phase: 'wire probes', completed: ['connect', 'listing', 'UI resource reads'] });
    expect(snap.limits?.stopped?.unfinished).toEqual(PHASES.slice(PHASES.indexOf('wire probes')));
    expect(snap.transport.probes.unknownMethod).toBeDefined();
    expect(snap.transport.probes.unknownTool).toBeUndefined();
    const r = runRules(snap, RULES);
    expect(r.skipped).toContainEqual({ ruleId: 'SPEC-009', reason: STOPPED_REASON });
    // The observed errors are partial too: SPEC-016 finds nothing wrong in them, which is no pass.
    expect(r.skipped).toContainEqual({ ruleId: 'SPEC-016', reason: STOPPED_REASON });
    // Rules over the finished listing still run.
    expect(r.skipped.some((s) => s.ruleId === 'TOOL-001')).toBe(false);
  }, 30000);
});

describe('the engine on a stopped snapshot (R003)', () => {
  const stopped = (phase: string, unfinished?: string[], set?: (s: Snapshot) => void) => snapOf({
    tools: [tool()],
    set: (s) => {
      s.listMeta.tools = { pages: 1, rawPages: [] };
      s.coverage = { toolLevel: 'stopped', reason: `stopped by --max-duration (1000 ms) during ${phase}` };
      s.limits = { truncated: [], stopped: { maxDurationMs: 1000, phase, ...(unfinished ? { unfinished } : {}) } };
      set?.(s);
    },
  });

  it('a rule reading a probe that never ran is skipped; one that found something in a finished probe reports it', () => {
    expect(runRules(stopped('wire probes'), [SPEC_009]).skipped).toEqual([{ ruleId: 'SPEC-009', reason: STOPPED_REASON }]);
    const found = runRules(stopped('wire probes', undefined, (s) => {
      s.transport.probes.unknownTool = { kind: 'jsonrpc', label: 'unknownTool', result: { content: [] }, durationMs: 1 };
    }), [SPEC_009]);
    expect(found.skipped).toEqual([]);
    expect(found.rulesRun).toBe(1);
    expect(found.findings.map((f) => f.ruleId)).toEqual(['SPEC-009']);
  });

  it('a probe phase that finished before the stop is judged as usual', () => {
    const r = runRules(stopped('active tool calls'), [SPEC_009]);
    expect(r.skipped).toEqual([]);
    expect(r.rulesRun).toBe(1);
  });

  it('an older snapshot without `unfinished` gets the stop phase and every later one', () => {
    expect([...(unfinishedPhases(stopped('tools re-list')) ?? [])]).toEqual(['tools re-list', 'text-only tools/list', 'active tool calls', 'whole run']);
    expect(unfinishedPhases(snapOf())).toBeUndefined();
  });

  it('partial active calls: the RT rules run on them instead of all being skipped for the stopped coverage', () => {
    const s = stopped('active tool calls', ['active tool calls'], (x) => {
      x.options.active = true;
      x.active = { calls: [{ tool: 'search_notes', kind: 'invalid-missing', args: {}, result: { content: [{ type: 'text', text: 'ok' }] }, durationMs: 5 }] };
    });
    const r = runRules(s, [RT_002]);
    expect(r.findings.map((f) => f.message)).toEqual(['call without the required arguments returned a success result']);
    s.active!.calls = [];
    expect(runRules(s, [RT_002]).skipped).toEqual([{ ruleId: 'RT-002', reason: STOPPED_REASON }]);
  });

  it('a run that was not stopped is unchanged: the rule passes and counts as run', () => {
    const r = runRules(snapOf({ tools: [tool()], set: (s) => { s.listMeta.tools = { pages: 1, rawPages: [] }; } }), [SPEC_009, SPEC_016]);
    expect(r.skipped).toEqual([]);
    expect(r.rulesRun).toBe(2);
  });
});

describe('input caps on what the rules read besides the listings (F146 lite)', () => {
  it('tool call results, 2026-07-28 results and raw list pages are cut to TEXT_CAP and each cut is recorded', () => {
    const big = 'x'.repeat(TEXT_CAP + 100);
    const s = emptySnapshot({ kind: 'stdio', command: 'node', args: [] }, { target: 'all', active: true, activeAuth: false });
    s.active = { calls: [{ tool: 't', kind: 'synthetic', args: {}, result: { content: [{ type: 'text', text: big }] }, durationMs: 1 }, { tool: 's', kind: 'synthetic', args: {}, result: big, durationMs: 1 }] };
    s.transport.modernResults = [{ method: 'tools/list', result: { note: big } }];
    s.listMeta.tools = { pages: 1, rawPages: [{ tools: [{ name: 't', description: big }] }] };
    const cut = capSnapshot(s);
    expect(cut.map((c) => c.where).sort()).toEqual(['2026-07-28 results', 'tools list pages', 'tools/call s result', 'tools/call t result']);
    expect(s.limits?.truncated).toHaveLength(4);
    expect(((s.active.calls[0].result as any).content[0].text as string).length).toBe(TEXT_CAP);
    expect((s.active.calls[1].result as string).length).toBe(TEXT_CAP);
  });
});

describe('the snippet scrub covers a prefix of the body only (F036 lite)', () => {
  it('a secret at the snippet edge is masked, and one far past it is not searched for', () => {
    const r = createRedactor([], ['sk-live-0123456789abcdef']);
    const edge = `${'a'.repeat(4090)}sk-live-0123456789abcdef${'b'.repeat(100)}`;
    expect(snippetOf(edge, r)).toBe(scrub(edge, r).slice(0, 4096));
    expect(snippetOf(edge, r)).not.toContain('sk-li');
    // An 8 MB body: only a prefix is scrubbed (the replace never sees the whole text), the snippet is the same.
    const huge = `${'c'.repeat(8 * 1024 * 1024)}sk-live-0123456789abcdef`;
    const replace = vi.spyOn(String.prototype, 'replace');
    try {
      expect(snippetOf(huge, r)).toBe('c'.repeat(4096));
      const scanned = replace.mock.contexts.map((c) => String(c).length);
      expect(scanned.length).toBeGreaterThan(0);
      expect(Math.max(...scanned)).toBeLessThan(64 * 1024);
    } finally {
      replace.mockRestore();
    }
  });
});
