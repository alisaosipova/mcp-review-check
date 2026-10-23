import { describe, expect, it } from 'vitest';
import { metaKeyProblem, specRules } from '../../src/rules/spec.js';
import type { JsonRpcObservation, Snapshot } from '../../src/snapshot.js';
import { checkCase, evaluate, exchange, snap, tool, type Case } from '../helpers.js';

const URL_OK = 'https://mcp.acme.test/mcp';
const rpc = (over: Partial<JsonRpcObservation>): JsonRpcObservation => ({ kind: 'jsonrpc', label: 'probe', durationMs: 1, ...over });
const modern = (set?: (s: Snapshot) => void) => snap({
  url: URL_OK,
  set: (s) => {
    s.era = 'modern';
    s.protocolVersion = '2026-07-28';
    s.discoverRaw = { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000, cacheScope: 'public' };
    s.transport.modernResults = [{ method: 'server/discover', result: s.discoverRaw }];
    set?.(s);
  },
});
const rpcErr = (status: number, code: number, data?: unknown) => exchange({ status, json: { jsonrpc: '2.0', id: 1, error: { code, message: 'x', data } }, requestJson: { jsonrpc: '2.0', id: 1, method: 'x' } });

const cases: Record<string, Case> = {
  'SPEC-001': { pos: snap({ set: (s) => { s.initializeRaw = { protocolVersion: 1, capabilities: {}, serverInfo: {} }; } }), neg: snap() },
  'SPEC-002': { pos: snap({ set: (s) => { s.capabilities = {}; } }), neg: snap(), severity: 'error' },
  'SPEC-003': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.exchanges = [exchange({ label: 'sdk tools/list', status: 200, contentType: 'text/html', requestJson: { jsonrpc: '2.0', id: 2, method: 'tools/list' } })]; } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.exchanges = [exchange({ label: 'sdk tools/list', status: 200, contentType: 'application/json; charset=utf-8', requestJson: { jsonrpc: '2.0', id: 2, method: 'tools/list' } })]; } }),
  },
  'SPEC-004': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.exchanges = [exchange({ status: 200, requestJson: { jsonrpc: '2.0', method: 'notifications/initialized' } })]; } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.exchanges = [exchange({ status: 202, bodySnippet: '', requestJson: { jsonrpc: '2.0', method: 'notifications/initialized' } })]; } }),
  },
  'SPEC-005': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.probes.get = exchange({ method: 'GET', status: 200, contentType: 'text/html' }); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.probes.get = exchange({ method: 'GET', status: 405 }); } }), severity: 'warning',
  },
  'SPEC-006': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.sessionId = 'bad id with spaces'; } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.sessionId = '6f1c2a0e-3b7d-4c55-9a51-0e2d8c1b7f42'; } }), severity: 'error',
  },
  'SPEC-007': {
    pos: modern((s) => { s.transport.probes.badVersionModern = rpcErr(400, -32000); }),
    neg: modern((s) => { s.transport.probes.badVersionModern = rpcErr(400, -32022, { supported: ['2026-07-28'] }); }), severity: 'error',
  },
  'SPEC-008': {
    pos: modern((s) => { s.transport.probes.unknownMethodModern = rpcErr(200, -32601); }),
    neg: modern((s) => { s.transport.probes.unknownMethodModern = rpcErr(404, -32601); }), severity: 'error',
  },
  'SPEC-009': {
    pos: snap({ set: (s) => { s.transport.probes.unknownTool = rpc({ result: { isError: true, content: [] } }); } }),
    neg: snap({ set: (s) => { s.transport.probes.unknownTool = rpc({ error: { code: -32602, message: 'Unknown tool' } }); } }),
  },
  'SPEC-010': {
    pos: snap({ resources: [], set: (s) => { s.transport.probes.resourceMissing = rpc({ result: { contents: [] } }); } }),
    neg: snap({ resources: [], set: (s) => { s.transport.probes.resourceMissing = rpc({ error: { code: -32002, message: 'not found' } }); } }), severity: 'error',
  },
  'SPEC-011': { pos: modern((s) => { s.discoverRaw = { supportedVersions: [], capabilities: {} }; }), neg: modern() },
  'SPEC-012': {
    pos: modern((s) => { s.transport.modernResults = [{ method: 'tools/list', result: { tools: [] } }]; }),
    neg: modern(), severity: 'error',
  },
  'SPEC-013': {
    pos: modern((s) => { s.transport.modernResults = [{ method: 'tools/list', result: { resultType: 'complete', cacheScope: 'public' } }]; }),
    neg: modern(), match: /ttlMs/,
  },
  'SPEC-014': {
    pos: modern((s) => { s.transport.probes.headerMismatchNone = rpcErr(200, -32601); }),
    neg: modern((s) => { s.transport.probes.headerMismatchNone = rpcErr(400, -32020); s.transport.probes.headerMismatchWrong = rpcErr(400, -32020); }),
  },
  'SPEC-015': {
    pos: modern((s) => { s.transport.probes.get = exchange({ method: 'GET', status: 200 }); }),
    neg: modern((s) => { s.transport.probes.get = exchange({ method: 'GET', status: 405 }); s.transport.probes.delete = exchange({ method: 'DELETE', status: 405 }); }),
  },
  'SPEC-016': {
    pos: snap({ set: (s) => { s.transport.observedErrors = [{ source: 'tools/list', requestId: 1, responseId: 1, code: -32050, modern: true }]; } }),
    neg: snap({ set: (s) => { s.transport.observedErrors = [{ source: 'tools/list', requestId: 1, responseId: 1, code: -32601 }]; } }), severity: 'error',
  },
  'SPEC-017': {
    pos: snap({ tools: [tool({ icons: [{ src: 'http://cdn.acme.test/i.png', mimeType: 'image/gif', sizes: ['big'] }] })] }),
    neg: snap({ tools: [tool({ icons: [{ src: 'https://cdn.acme.test/i.png', mimeType: 'image/png', sizes: ['48x48'], theme: 'dark' }] })] }),
  },
  'SPEC-018': {
    pos: snap({ tools: [tool({ _meta: { 'dev.mcp/secret': 1 } })] }),
    neg: snap({ tools: [tool({ _meta: { 'com.acme/trace': 1, ui: {}, 'openai/outputTemplate': 'ui://x', 'io.modelcontextprotocol/ui': {} } })] }),
  },
  'SPEC-020': {
    pos: snap({ set: (s) => { s.tools = []; s.listMeta.tools = { pages: 0, rawPages: [], error: 'MCP error -32603: Internal error' }; } }),
    neg: snap(), severity: 'error',
  },
  'SPEC-019': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.exchanges = [exchange({ status: 200, contentType: 'text/event-stream', headers: {} })]; } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.exchanges = [exchange({ status: 200, contentType: 'text/event-stream', headers: { 'x-accel-buffering': 'no' } })]; } }),
  },
};

describe('SPEC rules', () => {
  it('has a case for every rule', () => expect(Object.keys(cases).sort()).toEqual(specRules.map((r) => r.id).sort()));
  for (const rule of specRules) it(`${rule.id} ${rule.title}`, () => checkCase(rule, cases[rule.id]));

  const byId = (id: string) => specRules.find((r) => r.id === id)!;

  it('SPEC-008 legacy deviation (DeepWiki-style -32602) is info', () => {
    const f = evaluate(byId('SPEC-008'), snap({ set: (s) => { s.transport.probes.unknownMethod = rpc({ error: { code: -32602, message: 'x' } }); } }));
    expect(f[0].severity).toBe('info');
  });

  it('SPEC-007 legacy: non-400 for a bad version is a warning', () => {
    const f = evaluate(byId('SPEC-007'), snap({ url: URL_OK, set: (s) => { s.transport.probes.badVersion = exchange({ status: 200 }); } }));
    expect(f[0].severity).toBe('warning');
  });

  it('SPEC-016 mismatched response id is a warning', () => {
    const f = evaluate(byId('SPEC-016'), snap({ set: (s) => { s.transport.observedErrors = [{ source: 'x', requestId: 3, responseId: 'server-error', code: -32603 }]; } }));
    expect(f[0].severity).toBe('warning');
  });

  it('SPEC-016 legacy responses: -32042 and the -32020..-32099 range are allowed; modern-path -32042 is flagged', () => {
    const legacy = snap({ set: (s) => { s.transport.observedErrors = [{ source: 'tools/call', requestId: 1, responseId: 1, code: -32042 }, { source: 'x', requestId: 2, responseId: 2, code: -32050 }]; } });
    expect(evaluate(byId('SPEC-016'), legacy)).toEqual([]);
    const m = evaluate(byId('SPEC-016'), modern((s) => { s.transport.observedErrors = [{ source: 'tools/call', requestId: 1, responseId: 1, code: -32042, modern: true }]; }));
    expect(m[0].message).toMatch(/-32042.*removed/);
  });

  it('SPEC-010 a -32020 header rejection of the probe is inconclusive', () => {
    const s = modern((x) => { x.capabilities = { resources: {} }; x.listMeta.resources = { pages: 1, rawPages: [] }; x.transport.probes.resourceMissingModern = rpcErr(400, -32020); });
    expect(evaluate(byId('SPEC-010'), s)).toEqual([]);
  });

  it('SPEC-017 http: src and uncommon image types are info; non-image types warn', () => {
    const f = evaluate(byId('SPEC-017'), snap({ tools: [tool({ icons: [{ src: 'http://cdn.acme.test/i.gif', mimeType: 'image/gif' }, { src: 'https://cdn.acme.test/i', mimeType: 'text/html' }] })] }));
    expect(f.filter((x) => x.severity === 'info')).toHaveLength(2);
    expect(f.filter((x) => x.severity === 'warning').map((x) => x.message).join()).toMatch(/not an image type/);
  });

  it('SPEC-018 official io.modelcontextprotocol keys: known ones pass, unknown ones are info', () => {
    expect(evaluate(byId('SPEC-018'), snap({ tools: [tool({ _meta: { 'io.modelcontextprotocol/related-task': { taskId: 't' } } })] }))).toEqual([]);
    expect(evaluate(byId('SPEC-018'), snap({ tools: [tool({ _meta: { 'io.modelcontextprotocol/new-ext': 1 } })] }))).toMatchObject([{ severity: 'info' }]);
  });

  it('SPEC-020 only for declared capabilities', () => {
    const s = snap({ set: (x) => { x.capabilities = {}; x.listMeta.tools = { pages: 0, rawPages: [], error: 'Method not found' }; } });
    expect(evaluate(byId('SPEC-020'), s)).toEqual([]);
  });

  it('SPEC-013 cacheScope differing between pages is an error', () => {
    const f = evaluate(byId('SPEC-013'), modern((s) => {
      s.transport.modernResults = [
        { method: 'tools/list', result: { resultType: 'complete', ttlMs: 1, cacheScope: 'public' } },
        { method: 'tools/list', result: { resultType: 'complete', ttlMs: 1, cacheScope: 'private' } },
      ];
    }));
    expect(f.map((x) => x.message).join()).toMatch(/differs between pages/);
  });

  it('metaKeyProblem handles prefixes', () => {
    expect(metaKeyProblem('com.acme/key')).toBeUndefined();
    expect(metaKeyProblem('dev.mcp/thing')).toBe('reserved prefix');
    expect(metaKeyProblem('1bad.prefix/key')).toBe('invalid prefix label');
    expect(metaKeyProblem('-bad')).toBe('invalid name');
    expect(metaKeyProblem('mcp/www_authenticate')).toBeUndefined();
  });
});
