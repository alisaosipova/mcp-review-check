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
    severity: 'info', match: /gets 403 \(assumed host Origin, not verified/,
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

  it('SRV-002 gives ChatGPT its own fix and docs (not the Claude plugin advice)', () => {
    const f = evaluate(byId('SRV-002'), snap());
    const claude = f.find((x) => x.platforms.includes('claude'))!;
    const chatgpt = f.find((x) => x.platforms.includes('chatgpt'))!;
    expect(claude.fix).toMatch(/Claude plugin/);
    expect(claude.docs[0]).toMatch(/claude\.com/);
    expect(chatgpt.fix).not.toMatch(/plugin/i);
    expect(chatgpt.fix).toMatch(/public HTTPS Streamable HTTP endpoint/);
    expect(chatgpt.docs[0]).toMatch(/developers\.openai\.com/);
  });

  it('SRV-008 strict Origin rejection is informational: real host Origin values are not captured', () => {
    const strict = snap({ url: URL_OK, set: (s) => {
      s.transport.probes.originNone = exchange({ status: 200 });
      s.transport.probes.originClaude = exchange({ status: 403 });
      s.transport.probes.originChatgpt = exchange({ status: 403 });
      s.transport.probes.originEvil = exchange({ status: 403 });
    } });
    const f = evaluate(byId('SRV-008'), strict);
    expect(f.map((x) => [x.platforms[0], x.severity]).sort()).toEqual([['chatgpt', 'info'], ['claude', 'info']]);
  });

  it('SRV-013 reports a problem shared by initialize and server/discover once; an empty version is a warning', () => {
    // Kiwi: serverInfo { name, version: "" } in both initialize and the server/discover _meta.
    const kiwi = snap({ set: (s) => {
      s.era = 'dual';
      s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'kiwicom-flight-search', version: '' } };
      s.discoverRaw = { supportedVersions: ['2026-07-28'], capabilities: {}, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'kiwicom-flight-search', version: '' } } };
    } });
    const f = evaluate(byId('SRV-013'), kiwi);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'warning', message: expect.stringMatching(/version is an empty string \(initialize and server\/discover\)/) });
    // a missing version or name stays an error
    const missing = evaluate(byId('SRV-013'), snap({ set: (s) => { s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'acme' } }; } }));
    expect(missing).toMatchObject([{ severity: 'error', message: expect.stringMatching(/version is missing/) }]);
    // different problems in the two places stay separate
    const mixed = evaluate(byId('SRV-013'), snap({ set: (s) => {
      s.era = 'dual';
      s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: '', version: '1' } };
      s.discoverRaw = { supportedVersions: ['2026-07-28'], capabilities: {}, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'acme', version: '' } } };
    } }));
    expect(mixed.map((x) => x.message).sort()).toEqual(['serverInfo.name is not a non-empty string (initialize)', 'serverInfo.version is an empty string (server/discover); set the server version']);
  });

  it('SRV-013: a serverInfo that is not an object reads "serverInfo is not an object"', () => {
    const f = evaluate(byId('SRV-013'), snap({ set: (s) => { s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: 'acme' }; } }));
    expect(f.map((x) => x.message)).toEqual(['serverInfo is not an object (initialize)']);
  });

  it('SRV-016 skips an HTML catch-all page (SPA), not a verification file', () => {
    const spa = snap({ url: URL_OK, set: (s) => { s.transport.probes.challenge = exchange({ method: 'GET', status: 200, contentType: 'text/html; charset=utf-8', bodySnippet: '<!doctype html>\n<html><head><title>GitMCP</title></head><body></body></html>' }); } });
    expect(evaluate(byId('SRV-016'), spa)).toEqual([]);
    const sniffed = snap({ url: URL_OK, set: (s) => { s.transport.probes.challenge = exchange({ method: 'GET', status: 200, bodySnippet: '<html lang="en">\n<body>app</body></html>' }); } });
    expect(evaluate(byId('SRV-016'), sniffed)).toEqual([]);
  });

  it('SRV-020 cites the versioning page', () => {
    expect(byId('SRV-020').sources).toEqual(['https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning']);
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

  it('SRV-003 fatal HTTP connect failure is a spec error with the diagnosis hint as fix (directories read INCOMPLETE)', () => {
    const f = evaluate(byId('SRV-003'), snap({ url: URL_OK, set: (s) => {
      s.fatal = 'could not complete a handshake: HTTP 404: https://mcp.acme.test/ is not an MCP endpoint; try https://mcp.acme.test/mcp';
      s.connectDiagnosis = { kind: 'not-mcp', status: 404, summary: 'HTTP 404: https://mcp.acme.test/ is not an MCP endpoint', hint: 'try https://mcp.acme.test/mcp' };
    } }));
    expect(f[0]).toMatchObject({ severity: 'error', platforms: ['spec'], fix: 'Try https://mcp.acme.test/mcp.' });
  });

  it('SRV-004: NXDOMAIN says "does not resolve", not IPv4-only; informational when the connect failed on it', () => {
    const nx = { host: 'nope.acme.test', a: [], aaaa: [], error: 'queryA ENOTFOUND nope.acme.test', code: 'ENOTFOUND' };
    const fatal = evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = nx; s.fatal = 'could not complete a handshake'; } }));
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatchObject({ severity: 'info', message: 'hostname nope.acme.test does not resolve (NXDOMAIN) (system resolver)' });
    expect(fatal[0].message).not.toMatch(/IPv4/);
    // an authorization server that does not resolve is a real blocker
    const as = evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = dns(['93.184.216.34']); s.authProbe = { trigger: 'preflight-401', prmAttempts: [], as: [], timings: {}, asDns: [{ ...nx, host: 'auth.acme.test' }] }; } }));
    expect(as[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/auth\.acme\.test does not resolve/) });
    const servfail = evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = { ...nx, error: 'queryA ESERVFAIL', code: 'ESERVFAIL' }; } }));
    expect(servfail[0]).toMatchObject({ severity: 'info', message: expect.stringMatching(/^inconclusive \(network\): DNS lookup/) });
  });

  it('SRV-004 tells "resolves only locally" (dns.lookup) from "no A record"', () => {
    const local = evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = { ...dns([]), lookup: ['127.0.0.1'] }; } }));
    expect(local.map((x) => [x.severity, x.message])).toEqual([['error', 'mcp.acme.test resolves only locally (127.0.0.1), not in public DNS']]);
    const noA = evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = { ...dns([], ['2606:2800:220:1::1']), lookup: ['2606:2800:220:1::1'] }; } }));
    expect(noA.map((x) => x.message)).toEqual(['mcp.acme.test has no A record; Connectors are IPv4-only (system resolver)', 'mcp.acme.test has no A record (system resolver)']);
    // a name only /etc/hosts or a container DNS knows: public DNS says NXDOMAIN, the system resolver answers
    const docker = { host: 'mcp.acme.test', a: [], aaaa: [], error: 'queryA ENOTFOUND mcp.acme.test', code: 'ENOTFOUND', lookup: ['172.18.0.2'] };
    expect(evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = docker; } })).map((x) => x.message)).toEqual(['mcp.acme.test resolves only locally (172.18.0.2), not in public DNS']);
    expect(evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = { ...docker, lookup: [] }; } }))[0].message).toMatch(/does not resolve \(NXDOMAIN\)/);
  });

  it('SRV-001: the MCP host certificate is checked without auth; timeouts are inconclusive', () => {
    const tls = (t: Record<string, unknown>) => snap({ url: URL_OK, set: (s) => { s.transport.tls = [{ host: 'mcp.acme.test', role: 'mcp', ok: false, ...t }]; } });
    const self = evaluate(byId('SRV-001'), tls({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }));
    expect(self[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/TLS handshake with mcp\.acme\.test failed: DEPTH_ZERO_SELF_SIGNED_CERT/) });
    const slow = evaluate(byId('SRV-001'), tls({ code: 'ETIMEDOUT', transient: true, attempts: ['ETIMEDOUT', 'ETIMEDOUT', 'ETIMEDOUT'] }));
    expect(slow[0].severity).toBe('info');
    expect(slow[0].message).toMatch(/^inconclusive \(network\)/);
    expect(evaluate(byId('SRV-001'), snap({ url: URL_OK, set: (s) => { s.transport.tls = [{ host: 'mcp.acme.test', role: 'mcp', ok: true }]; } }))).toEqual([]);
    // a host that does not resolve or refuses the connection says nothing about its certificate
    expect(evaluate(byId('SRV-001'), tls({ code: 'ENOTFOUND' }))).toEqual([]);
    expect(evaluate(byId('SRV-001'), tls({ code: 'ECONNREFUSED' }))).toEqual([]);
  });

  const tlsFail = (code: string) => evaluate(byId('SRV-001'), snap({ url: URL_OK, set: (s) => { s.transport.tls = [{ host: 'mcp.acme.test', role: 'mcp', ok: false, code }]; } }));

  it('a certificate for another name (ERR_TLS_*) is an error, like a self-signed one', () => {
    for (const code of ['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
      expect(tlsFail(code), code).toMatchObject([{ severity: 'error', message: `TLS handshake with mcp.acme.test failed: ${code}; hosts reject this certificate` }]);
    }
    expect(tlsFail('EHOSTUNREACH')).toEqual([]);
  });

  it('EPROTO is a TLS protocol failure, not a certificate verdict', () => {
    const proto = tlsFail('EPROTO');
    expect(proto).toMatchObject([{ severity: 'error', message: 'TLS handshake with mcp.acme.test failed: EPROTO (not a TLS endpoint?)' }]);
    expect(proto[0].message).not.toMatch(/certificate/);
  });
});

describe('SRV-001 and SRV-008 texts', () => {
  const byId = (id: string) => serverRules.find((r) => r.id === id)!;

  it('SRV-001 ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE is a version or cipher mismatch, not "not a TLS endpoint?"', () => {
    const f = evaluate(byId('SRV-001'), snap({ url: 'https://mcp.acme.test/mcp', set: (s) => { s.transport.tls = [{ host: 'mcp.acme.test', role: 'mcp', ok: false, code: 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE' }]; } }));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
    expect(f[0].message).not.toMatch(/not a TLS endpoint/);
    expect(f[0].message).toBe('TLS handshake with mcp.acme.test failed: ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE (TLS version or cipher mismatch; hosts need TLS 1.2+ with common ciphers)');
    for (const code of ['ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_PACKET_LENGTH_TOO_LONG']) {
      const g = evaluate(byId('SRV-001'), snap({ url: 'https://mcp.acme.test/mcp', set: (s) => { s.transport.tls = [{ host: 'mcp.acme.test', role: 'mcp', ok: false, code }]; } }));
      expect(g[0].message, code).toBe(`TLS handshake with mcp.acme.test failed: ${code} (not a TLS endpoint?)`);
    }
  });

  it('SRV-008 on 10.0.0.5 in local mode does not call the server loopback; severity stays error', () => {
    const f = evaluate(byId('SRV-008'), snap({ url: 'http://10.0.0.5:8080/mcp', set: (s) => { s.localMode = true; s.transport.probes.originEvil = exchange({ status: 200 }); } }));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
    expect(f[0].message).not.toMatch(/^loopback server/);
    expect(f[0].message).toBe('local server (loopback, private address or dotless name) accepts a foreign Origin (DNS rebinding risk)');
  });
});
