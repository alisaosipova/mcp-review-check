import { describe, expect, it } from 'vitest';
import { canonicalUrl, serverRules } from '../../src/rules/server.js';
import type { Rule } from '../../src/rules/types.js';
import { checkCase, evaluate, exchange, snap, tool, type Case } from '../helpers.js';

const URL_OK = 'https://mcp.acme.test/mcp';
const dns = (a: string[], aaaa: string[] = []) => ({ host: 'mcp.acme.test', a, aaaa });

const cases: Record<string, Case> = {
  'SRV-001': { pos: snap({ url: 'http://mcp.acme.test/mcp' }), neg: snap({ url: URL_OK }), severity: 'error' },
  'SRV-002': { pos: snap(), neg: snap({ url: URL_OK }), severity: 'info' },
  'SRV-003': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.kind = 'sse'; } }),
    neg: snap({ url: URL_OK }), severity: 'warning', match: /legacy HTTP\+SSE/,
  },
  'SRV-004': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.dns = dns(['10.0.0.5']); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.dns = dns(['93.184.216.34'], ['2606:2800:220:1::1']); } }),
    severity: 'error', match: /non-public/,
  },
  'SRV-005': { pos: snap({ url: 'https://abc.ngrok-free.app/mcp' }), neg: snap({ url: URL_OK }), severity: 'error' },
  'SRV-006': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 307, headers: { location: 'https://other.test/mcp' } }); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 200 }); } }),
    severity: 'error', match: /another host/,
  },
  'SRV-007': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 403, bodySnippet: 'Invalid Host header' }); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 403, bodySnippet: 'Forbidden' }); } }),
  },
  'SRV-008': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.probes.originNone = exchange({ status: 200 }); s.transport.probes.originClaude = exchange({ status: 403 }); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.probes.originNone = exchange({ status: 200 }); s.transport.probes.originClaude = exchange({ status: 200 }); s.transport.probes.originEvil = exchange({ status: 403 }); } }),
    severity: 'warning', match: /overly strict/,
  },
  'SRV-009': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 403, headers: { 'cf-mitigated': 'challenge' } }); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 200, contentType: 'application/json' }); } }),
  },
  'SRV-010': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.timings = { initialize: [700], 'tools/list': [900] }; } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.timings = { initialize: [80], 'tools/list': [120] }; } }),
    severity: 'info',
  },
  'SRV-011': {
    pos: snap({ set: (s) => { s.serverInfo = { name: 'acme', title: 'Acme MCP Server', version: '1' }; } }),
    neg: snap(), severity: 'warning',
  },
  'SRV-012': { pos: snap({ set: (s) => { s.serverInfo = { name: 'weather', version: '1' }; } }), neg: snap() },
  'SRV-013': {
    pos: snap({ set: (s) => { s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: '', version: '1' } }; } }),
    neg: snap(), match: /name/,
  },
  'SRV-014': {
    pos: snap({ set: (s) => { s.instructions = 'x'.repeat(600); } }),
    neg: snap({ set: (s) => { s.instructions = 'Search before creating notes.'; } }), severity: 'info',
  },
  'SRV-015': { pos: snap({ set: (s) => { s.capabilities = { tools: {}, resources: { subscribe: true } }; } }), neg: snap() },
  'SRV-016': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.probes.challenge = exchange({ method: 'GET', status: 200, contentType: 'application/json', bodySnippet: '{"token":"abc"}' }); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.probes.challenge = exchange({ method: 'GET', status: 200, contentType: 'text/plain', bodySnippet: 'abc123' }); } }),
  },
  'SRV-017': { pos: snap({ url: 'https://MCP.acme.test:443/mcp/' }), neg: snap({ url: URL_OK }), severity: 'warning' },
  'SRV-018': {
    pos: snap({ set: (s) => { s.transport.stdio = { nonJsonStdout: ['Server starting...'], stderrTail: '' }; } }),
    neg: snap({ set: (s) => { s.transport.stdio = { nonJsonStdout: [], stderrTail: 'log line' }; } }), severity: 'error',
  },
  'SRV-019': {
    pos: snap({ set: (s) => { s.toolsRelist = ['search_notes']; s.toolsFreshConnection = ['search_notes', 'secret_tool']; } }),
    neg: snap({ set: (s) => { s.toolsRelist = ['search_notes']; s.toolsFreshConnection = ['search_notes']; } }), severity: 'warning',
  },
  'SRV-020': { pos: snap({ url: URL_OK }), neg: snap({ url: URL_OK, set: (s) => { s.era = 'unknown'; } }), severity: 'info' },
};

describe('SRV rules', () => {
  it('has a case for every rule', () => expect(Object.keys(cases).sort()).toEqual(serverRules.map((r) => r.id).sort()));
  for (const rule of serverRules as Rule[]) it(`${rule.id} ${rule.title}`, () => checkCase(rule, cases[rule.id]));

  const byId = (id: string) => serverRules.find((r) => r.id === id)!;

  it('SRV-001/004/005 are info with a deploy-time prefix in local mode', () => {
    const s = snap({ url: 'http://127.0.0.1:3000/mcp', set: (x) => { x.localMode = true; x.transport.dns = { host: '127.0.0.1', a: ['127.0.0.1'], aaaa: [] }; } });
    for (const id of ['SRV-001', 'SRV-004']) {
      const f = evaluate(byId(id), s);
      expect(f.length).toBeGreaterThan(0);
      expect(f.every((x) => x.severity === 'info' && x.message.startsWith('Deploy-time check:'))).toBe(true);
    }
  });

  it('SRV-004 flags a missing A record as claude error and chatgpt info', () => {
    const f = evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = dns([], ['2606:2800:220:1::1']); } }));
    expect(f.find((x) => x.platforms.includes('claude'))?.severity).toBe('error');
    expect(f.find((x) => x.platforms.includes('chatgpt'))?.severity).toBe('info');
  });

  it('SRV-005 treats shared hosting as claude info only', () => {
    const f = evaluate(byId('SRV-005'), snap({ url: 'https://acme.vercel.app/mcp' }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'info', platforms: ['claude'] });
  });

  it('SRV-006 same-host redirect is a warning', () => {
    const f = evaluate(byId('SRV-006'), snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 308, headers: { location: '/mcp/' } }); } }));
    expect(f[0].severity).toBe('warning');
  });

  it('SRV-008 foreign Origin accepted: loopback → spec error, public → spec info', () => {
    const evil = (s: ReturnType<typeof snap>) => { s.transport.probes.originEvil = exchange({ status: 200 }); };
    expect(evaluate(byId('SRV-008'), snap({ url: 'http://127.0.0.1:1/mcp', set: (s) => { s.localMode = true; evil(s); } }))[0].severity).toBe('error');
    expect(evaluate(byId('SRV-008'), snap({ url: URL_OK, set: evil }))[0].severity).toBe('info');
  });

  it('SRV-010 single call over 5 s is a warning', () => {
    const f = evaluate(byId('SRV-010'), snap({ url: URL_OK, set: (s) => { s.transport.timings = { initialize: [100], 'tools/list': [6000, 100] }; } }));
    expect(f.map((x) => x.severity)).toContain('warning');
  });

  it('SRV-011 package-style serverInfo.name only is info; tool names are not checked', () => {
    const f = evaluate(byId('SRV-011'), snap({ tools: [tool({ name: 'mcp_plugin' })], set: (s) => { s.serverInfo = { name: 'acme-mcp', version: '1' }; } }));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('info');
  });

  it('SRV-013 modern: missing serverInfo meta is a warning', () => {
    const f = evaluate(byId('SRV-013'), snap({ set: (s) => { s.era = 'modern'; s.initializeRaw = undefined; s.discoverRaw = { supportedVersions: ['2026-07-28'], capabilities: {} }; } }));
    expect(f[0].severity).toBe('warning');
  });

  it('SRV-014 duplicated tool descriptions: chatgpt warning + spec info', () => {
    const d = (n: number) => `This is a long tool description number ${n} that is clearly over forty characters.`;
    const tools = [1, 2, 3].map((n) => tool({ name: `get_thing_${n}`, description: d(n) }));
    const f = evaluate(byId('SRV-014'), snap({ tools, set: (s) => { s.instructions = tools.map((t) => t.description).join('\n'); } }));
    expect(f.find((x) => x.platforms.includes('chatgpt'))?.severity).toBe('warning');
    expect(f.find((x) => x.platforms.includes('spec'))?.severity).toBe('info');
  });

  it('SRV-017 fragment is a spec error; canonical difference is claude info', () => {
    const f = evaluate(byId('SRV-017'), snap({ url: 'https://mcp.acme.test/mcp#x' }));
    expect(f.some((x) => x.severity === 'error' && x.platforms.includes('spec'))).toBe(true);
    expect(f.some((x) => x.platforms.includes('claude') && x.severity === 'info')).toBe(true);
  });

  it('SRV-017 a bare origin with or without the root slash is canonical enough', () => {
    expect(evaluate(byId('SRV-017'), snap({ url: 'https://mcp.vercel.test' }))).toEqual([]);
    expect(evaluate(byId('SRV-017'), snap({ url: 'https://mcp.vercel.test/' }))).toEqual([]);
    expect(canonicalUrl('https://mcp.vercel.test/')).toBe('https://mcp.vercel.test');
  });

  it('SRV-019 same set in a different order is info', () => {
    const f = evaluate(byId('SRV-019'), snap({ tools: [tool({ name: 'a_get' }), tool({ name: 'b_get' })], set: (s) => { s.toolsRelist = ['b_get', 'a_get']; } }));
    expect(f[0].severity).toBe('info');
  });

  it('SRV-003 fatal transport failure is an error', () => {
    const f = evaluate(byId('SRV-003'), snap({ url: URL_OK, set: (s) => { s.fatal = 'connection refused'; } }));
    expect(f[0].severity).toBe('error');
  });
});
