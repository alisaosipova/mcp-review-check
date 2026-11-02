// Regression tests for the W4C-connect remediation (review 2026-11-01, wave 4): a result that answers another request
// id reaches SPEC-016 (F024, R010).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, collectErrors } from '../src/connect.js';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { SPEC_016, SPEC_020 } from '../src/rules/spec.js';
import type { HttpExchange } from '../src/snapshot.js';
import { snap as snapOf, tool } from './helpers.js';

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
