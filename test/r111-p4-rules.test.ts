// 1.2.0 block P4 (protocol, server and auth rules; review round 4). One describe per finding id. Every server is
// local, on 127.0.0.1; the DNS cases inject resolver stubs into lookupHost.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/connect.js';
import { lookupHost, type Deps } from '../src/probe/network.js';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { TRANSPORTS_2024 } from '../src/rules/spec.js';
import type { Rule } from '../src/rules/types.js';
import type { Snapshot } from '../src/snapshot.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
import { startBridge } from './fixtures/http-bridge.js';
import { evaluate, snap } from './helpers.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });
const byId = (id: string): Rule => RULES.find((r) => r.id === id)!;

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string, origin: string) => void): Promise<string> {
  let origin = '';
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, res, body, origin));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  origin = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return `${origin}/mcp`;
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

interface OAuthOpts {
  /** The /authorize answer: always 400 with this JSON body. */
  authorize?: unknown;
  /** Offer a DCR registration endpoint (client-1). */
  dcr?: boolean;
  /** WWW-Authenticate of the unauthenticated 401 and of the invalid-token 401 (origin is substituted for {o}). */
  challenge: string;
  invalidChallenge?: string;
  /** Serve the PRM at /.well-known/oauth-protected-resource/mcp. */
  wellKnownPrm?: boolean;
}

/** A 2025-11-25 server that answers every MCP request with 401, plus PRM, RFC 8414 metadata and /authorize. */
function oauthServer(o: OAuthOpts): Promise<string> {
  return serve((req, res, _body, origin) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/prm' || (o.wellKnownPrm && path === '/.well-known/oauth-protected-resource/mcp')) {
      return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    }
    if (path === '/.well-known/oauth-authorization-server') {
      return json(res, 200, {
        issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
        ...(o.dcr ? { registration_endpoint: `${origin}/register` } : { client_id_metadata_document_supported: true }),
        response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
      });
    }
    if (path === '/register') return json(res, 201, { client_id: 'client-1' });
    if (path === '/authorize') return json(res, 400, o.authorize ?? {});
    if (path === '/token') return json(res, 400, { error: 'invalid_grant' });
    if (path !== '/mcp') { res.writeHead(404); res.end(); return; }
    const invalid = req.headers.authorization === 'Bearer mcp-review-check-invalid-token';
    const ch = (invalid ? o.invalidChallenge ?? o.challenge : o.challenge).replace('{o}', origin);
    return json(res, 401, { error: 'unauthorized' }, { 'www-authenticate': ch });
  });
}

describe('A04-01 AUTH-020: a 400 that does not name the redirect is inconclusive', () => {
  const run = async (o: Partial<OAuthOpts>) => {
    const url = await oauthServer({ challenge: 'Bearer resource_metadata="{o}/prm"', ...o });
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url }, activeAuth: true, timeoutMs: 5000 });
    return runRules(s, RULES).findings.filter((f) => f.ruleId === 'AUTH-020');
  };

  it('invalid_client with no DCR client: info naming the refused client_id, no error', async () => {
    const f = await run({ authorize: { error: 'invalid_client' } });
    expect(f).toHaveLength(3);
    for (const x of f) {
      expect(x.severity).toBe('info');
      expect(x.message).toMatch(/^inconclusive \(network\): \/authorize refused the probe's client_id \(400 invalid_client\); redirect_uri \S+ not verified$/);
    }
  }, 30000);

  it('a DCR client and a 400 invalid_scope: info, the redirect was not named', async () => {
    const f = await run({ dcr: true, authorize: { error: 'invalid_scope' } });
    expect(f.map((x) => x.severity)).toEqual(['info', 'info', 'info']);
    expect(f[0].message).toMatch(/answered 400 invalid_scope without naming the redirect/);
  }, 30000);

  it('a body that names the redirect is still a Claude error', async () => {
    const f = await run({ dcr: true, authorize: { error: 'invalid_request', error_description: 'redirect_uri is not registered' } });
    expect(f.map((x) => x.severity)).toEqual(['error', 'error', 'error']);
    expect(f[0].message).toMatch(/^\/authorize rejected redirect_uri /);
  }, 30000);
});

describe('A04-05 AUTH-016 leaves a missing resource_metadata to AUTH-002', () => {
  const run = async (o: OAuthOpts) => {
    const url = await oauthServer(o);
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 5000 });
    return runRules(s, RULES).findings;
  };

  it('a well-known PRM and no resource_metadata: AUTH-002 warns for Claude, AUTH-016 says nothing', async () => {
    const f = await run({ challenge: 'Bearer scope="notes.read"', wellKnownPrm: true });
    expect(f.find((x) => x.ruleId === 'AUTH-002')?.message).toMatch(/a well-known PRM still resolves/);
    expect(f.filter((x) => x.ruleId === 'AUTH-016')).toEqual([]);
  }, 30000);

  it('a pointer the unauthenticated 401 carries and the invalid-token 401 drops is still reported', async () => {
    const f = await run({ challenge: 'Bearer resource_metadata="{o}/prm"', invalidChallenge: 'Bearer error="invalid_token"' });
    expect(f.filter((x) => x.ruleId === 'AUTH-016').map((x) => [x.severity, x.message])).toEqual([
      ['warning', '401 for an invalid token lacks the WWW-Authenticate resource_metadata that the unauthenticated 401 carries'],
    ]);
  }, 30000);
});

/** Resolver stubs: resolve4/resolve6 reject with `code`, the system lookup answers `lookup`. */
const stubDeps = (code: string | undefined, lookup: string[]): Deps => {
  const fail = () => Promise.reject(Object.assign(new Error(`queryA ${code} mcp.example.com`), { code }));
  return {
    resolve4: code ? fail : async () => [], resolve6: code ? fail : async () => [],
    lookup: async () => lookup, getServers: () => ['10.9.8.7'],
    tlsCheck: async () => ({ ok: true }), now: () => 0,
  };
};
const srv004 = async (code: string | undefined, lookup: string[]) => {
  const d = await lookupHost('mcp.example.com', stubDeps(code, lookup));
  return evaluate(byId('SRV-004'), snap({ url: 'https://mcp.example.com/mcp', set: (s) => { s.transport.dns = d; } }));
};

describe('A04-02 SRV-004: a failed resolver is inconclusive, not "resolves only locally"', () => {
  it.each(['ESERVFAIL', 'ECONNREFUSED', 'ETIMEOUT'])('%s with a working system lookup gives info with the lookup addresses', async (code) => {
    const f = await srv004(code, ['93.184.215.14']);
    expect(f.map((x) => [x.severity, x.message])).toEqual([
      ['info', `inconclusive (network): DNS lookup for mcp.example.com failed (${code}) (configured resolver 10.9.8.7); the system lookup gives 93.184.215.14`],
    ]);
  });

  it('NXDOMAIN with a system-lookup answer still resolves only locally (error)', async () => {
    const f = await srv004('ENOTFOUND', ['172.18.0.2']);
    expect(f.map((x) => [x.severity, x.message])).toEqual([['error', 'mcp.example.com resolves only locally (172.18.0.2), not via the configured resolver 10.9.8.7']]);
  });

  it('an empty answer with a system-lookup answer resolves only locally too', async () => {
    const f = await srv004(undefined, ['172.18.0.2']);
    expect(f[0].message).toMatch(/resolves only locally \(172\.18\.0\.2\)/);
  });
});

describe('I-A04-5 SRV-004 names the resolver servers', () => {
  it('lookupHost records dns.getServers() and the NXDOMAIN message names it', async () => {
    const d = await lookupHost('mcp.example.com', stubDeps('ENOTFOUND', []));
    expect(d.servers).toEqual(['10.9.8.7']);
    const f = await srv004('ENOTFOUND', []);
    expect(f[0].message).toBe('hostname mcp.example.com does not resolve (NXDOMAIN) (configured resolver 10.9.8.7)');
  });

  it('a getServers that throws leaves the field out', async () => {
    const d = await lookupHost('mcp.example.com', { ...stubDeps('ENOTFOUND', []), getServers: () => { throw new Error('no resolv.conf'); } });
    expect(d.servers).toBeUndefined();
  });
});

describe('A04-04 SPEC-010 empty contents: warning on 2025-11-25, error on 2026-07-28', () => {
  const empty = (era: Snapshot['era'], probe: 'resourceMissing' | 'resourceMissingModern') => snap({
    resources: [{ uri: 'file:///a.txt', name: 'a' }],
    set: (s) => {
      s.era = era;
      s.capabilities = { resources: {} };
      s.transport.probes[probe] = { kind: 'jsonrpc', label: probe, durationMs: 1, result: { contents: [] } };
    },
  });

  it('the legacy probe gives a SHOULD warning that cites the 2025-11-25 page', () => {
    const f = evaluate(byId('SPEC-010'), empty('legacy', 'resourceMissing'));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warning');
    expect(f[0].docs).toEqual(['https://modelcontextprotocol.io/specification/2025-11-25/server/resources#error-handling']);
  });

  it('the modern probe stays an error', () => {
    const f = evaluate(byId('SPEC-010'), empty('dual', 'resourceMissingModern'));
    expect(f.map((x) => x.severity)).toEqual(['error']);
    expect(f[0].docs).toEqual(['https://modelcontextprotocol.io/specification/2026-07-28/server/resources#error-handling']);
  });
});

describe('C-01 SPEC-016: an error response without an id is read like id null', () => {
  it('a 403 Origin rejection whose JSON-RPC error has no id gives no warning', async () => {
    const url = await serve((req, res, body) => {
      const m = (() => { try { return JSON.parse(body); } catch { return {}; } })() as { id?: unknown; method?: string };
      if (/evil/.test(String(req.headers.origin ?? ''))) return json(res, 403, { jsonrpc: '2.0', error: { code: -32600, message: 'Origin not allowed' } });
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      if (m.id === undefined) { res.writeHead(202); res.end(); return; }
      if (m.method === 'initialize') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'c01', version: '1' } } });
      if (m.method === 'tools/list') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { tools: [] } });
      return json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    });
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 5000 });
    expect(s.transport.observedErrors?.some((e) => /origin/i.test(e.source) && e.responseId === undefined)).toBe(true);
    const f = runRules(s, RULES).findings;
    expect(f.filter((x) => x.ruleId === 'SPEC-016')).toEqual([]);
    expect(f.filter((x) => x.ruleId === 'SRV-008')).toEqual([]);
  }, 30000);

  it('a present id that differs is still a warning', () => {
    const s = snap({ set: (x) => { x.transport.observedErrors = [{ source: 'unknownMethod', requestId: 3, responseId: 'server-error', code: -32601 }]; } });
    expect(evaluate(byId('SPEC-016'), s).map((x) => x.severity)).toEqual(['warning']);
  });
});

describe('I-C-4 SRV-008 and SPEC-005 cite the 2024-11-05 transports page on HTTP+SSE', () => {
  it('a legacy SSE fixture that accepts a foreign Origin: the SRV-008 finding cites 2024-11-05 first', async () => {
    const b = await startBridge(createGoodServer, { sseOnly: true });
    closers.push(() => b.close());
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url: b.url }, timeoutMs: 5000 });
    expect(s.transport.kind).toBe('sse');
    const f = runRules(s, RULES).findings.filter((x) => x.ruleId === 'SRV-008');
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x.docs[0]).toBe(TRANSPORTS_2024);
  }, 30000);

  it('a Streamable HTTP target keeps the 2026-07-28 page', () => {
    const s = snap({ url: 'http://127.0.0.1:1/mcp', set: (x) => { x.localMode = true; x.transport.probes.originEvil = { url: 'http://127.0.0.1:1/mcp', method: 'POST', label: 'originEvil', requestHeaders: {}, status: 200, durationMs: 1 } as never; } });
    const f = evaluate(byId('SRV-008'), s);
    expect(f[0].docs).toEqual(['https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http']);
  });

  it('SPEC-005 findings on an sse snapshot get the 2024-11-05 page first', () => {
    const s = snap({ url: 'http://127.0.0.1:1/mcp', set: (x) => { x.transport.kind = 'sse'; x.transport.probes.subscriptionsListen = { url: 'http://127.0.0.1:1/mcp', method: 'POST', label: 'subscriptionsListen', requestHeaders: {}, status: 200, contentType: 'application/json', durationMs: 1 } as never; } });
    const f = evaluate(byId('SPEC-005'), s);
    expect(f).toHaveLength(1);
    expect(f[0].docs[0]).toBe(TRANSPORTS_2024);
  });
});

describe('A03-01 RT-003 does not count a -32020 header rejection as a JSON-RPC error instead of isError', () => {
  const rt = (era: Snapshot['era'], code: number) => evaluate(byId('RT-003'), snap({
    tools: [{ name: 'echo', inputSchema: { type: 'object' } }], active: true,
    set: (s) => {
      s.era = era;
      s.active = { calls: [{ tool: 'echo', kind: 'invalid-type', args: {}, jsonRpcError: { code, message: 'Header mismatch' }, httpStatus: 400, durationMs: 1 }] };
    },
  }));

  it('a modern -32020 is not reported', () => { expect(rt('modern', -32020)).toEqual([]); });
  it('a modern -32602 is still reported', () => { expect(rt('modern', -32602).map((x) => x.message)).toEqual(['invalid-type input returned a JSON-RPC error instead of isError']); });
});
