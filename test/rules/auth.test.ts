import { describe, expect, it } from 'vitest';
import { AUTH_LATENCY, authRules } from '../../src/rules/auth.js';
import { parseWwwAuthenticate } from '../../src/rules/util/wwwAuth.js';
import type { AuthProbe, Snapshot } from '../../src/snapshot.js';
import { checkCase, evaluate, exchange, snap, type Case } from '../helpers.js';

const URL_OK = 'https://mcp.acme.test/mcp';
const ISSUER = 'https://auth.acme.test';
const GOOD_AS = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  registration_endpoint: `${ISSUER}/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
};
const CHALLENGE = `Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp", scope="notes.read"`;

interface AuthOpts {
  challenge?: string | null;
  prm?: Record<string, unknown> | null;
  as?: Record<string, unknown>;
  probe?: Partial<AuthProbe>;
  url?: string;
  set?: (s: Snapshot) => void;
}

function authSnap(o: AuthOpts = {}): Snapshot {
  const url = o.url ?? URL_OK;
  return snap({
    url,
    set: (s) => {
      const raw = o.challenge === null ? '' : o.challenge ?? CHALLENGE;
      const prmJson = o.prm === null ? undefined : { resource: url, authorization_servers: [ISSUER], scopes_supported: ['notes.read'], ...(o.prm ?? {}) };
      s.transport.preflight = exchange({ status: 401, headers: raw ? { 'www-authenticate': raw } : {} });
      s.authProbe = {
        trigger: 'preflight-401',
        challenge: { status: 401, raw, parsed: parseWwwAuthenticate(raw).map((c) => ({ scheme: c.scheme, params: c.params })) },
        prmAttempts: [],
        prm: prmJson ? { url: 'https://mcp.acme.test/.well-known/oauth-protected-resource/mcp', via: 'header', json: prmJson, contentType: 'application/json' } : undefined,
        as: [{ issuer: ISSUER, attempts: [], discoveryUrl: `${ISSUER}/.well-known/oauth-authorization-server`, json: { ...GOOD_AS, ...(o.as ?? {}) } }],
        invalidToken: exchange({ status: 401, headers: { 'www-authenticate': CHALLENGE } }),
        timings: { 'protected resource metadata': [120, 90, 100] },
        ...(o.probe ?? {}),
      };
      o.set?.(s);
    },
  });
}

const good = authSnap();

const cases: Record<string, Case> = {
  'AUTH-001': { pos: snap({ url: 'https://mcp.acme.test/mcp?api_key=abc123' }), neg: snap({ url: URL_OK }), severity: 'error', match: /«redacted»/ },
  'AUTH-002': { pos: authSnap({ challenge: null, prm: null }), neg: good, severity: 'error' },
  'AUTH-003': {
    pos: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 200, headers: { 'www-authenticate': 'Bearer' } }); } }),
    neg: snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 401, headers: { 'www-authenticate': CHALLENGE } }); } }), severity: 'error',
  },
  'AUTH-004': { pos: authSnap({ prm: null }), neg: good, severity: 'error' },
  'AUTH-005': { pos: authSnap({ prm: { resource: `${URL_OK}/` } }), neg: good, match: /trailing slash/ },
  'AUTH-006': { pos: authSnap({ prm: { authorization_servers: [] } }), neg: good, severity: 'error' },
  'AUTH-007': { pos: authSnap({ probe: { as: [{ issuer: ISSUER, attempts: [] }] } }), neg: good, severity: 'error' },
  'AUTH-008': { pos: authSnap({ as: { issuer: `${ISSUER}/tenant` } }), neg: good, severity: 'error' },
  'AUTH-009': { pos: authSnap({ as: { token_endpoint: undefined } }), neg: good, severity: 'error' },
  'AUTH-010': { pos: authSnap({ as: { token_endpoint: 'http://auth.acme.test/token' } }), neg: good, severity: 'error' },
  'AUTH-011': { pos: authSnap({ as: { code_challenge_methods_supported: ['plain'] } }), neg: good, severity: 'error' },
  'AUTH-012': {
    pos: authSnap({ as: { client_id_metadata_document_supported: undefined, registration_endpoint: undefined } }),
    neg: good, severity: 'warning', match: /neither CIMD nor DCR/,
  },
  'AUTH-013': { pos: authSnap({ as: { grant_types_supported: ['client_credentials'] } }), neg: good, severity: 'error' },
  'AUTH-014': { pos: authSnap({ as: { authorization_response_iss_parameter_supported: undefined } }), neg: good, severity: 'info' },
  'AUTH-015': { pos: authSnap({ challenge: `Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp"` }), neg: good, severity: 'info' },
  'AUTH-016': { pos: authSnap({ probe: { invalidToken: exchange({ status: 200 }) } }), neg: good, severity: 'error' },
  'AUTH-017': { pos: authSnap({ probe: { timings: { 'authorization server metadata': [100, 11000] } } }), neg: good, severity: 'error' },
  'AUTH-018': { pos: authSnap({ url: 'https://acme.azurewebsites.net/mcp' }), neg: good },
  'AUTH-019': {
    pos: authSnap({ set: (s) => { s.options.activeAuth = true; s.authProbe!.active = { dcr: exchange({ status: 415 }) }; } }),
    neg: authSnap({ set: (s) => { s.options.activeAuth = true; s.authProbe!.active = { dcr: exchange({ status: 201 }) }; } }), severity: 'error',
  },
  'AUTH-020': {
    pos: authSnap({ set: (s) => { s.options.activeAuth = true; s.authProbe!.active = { authorize: [exchange({ method: 'GET', url: `${ISSUER}/authorize?redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback`, status: 400, bodySnippet: 'invalid redirect_uri' })] }; } }),
    neg: authSnap({ set: (s) => { s.options.activeAuth = true; s.authProbe!.active = { authorize: [exchange({ method: 'GET', url: `${ISSUER}/authorize?redirect_uri=x`, status: 302 })] }; } }),
    severity: 'error',
  },
  'AUTH-021': {
    pos: authSnap({ set: (s) => { s.options.activeAuth = true; s.authProbe!.active = { token: [exchange({ status: 415, bodySnippet: 'Unsupported Media Type' })] }; } }),
    neg: authSnap({ set: (s) => { s.options.activeAuth = true; s.authProbe!.active = { token: [exchange({ status: 400, json: { error: 'invalid_grant' } }), exchange({ status: 400, json: { error: 'invalid_grant' } })] }; } }),
    severity: 'error',
  },
};

describe('AUTH rules', () => {
  it('has a case for every rule', () => expect(Object.keys(cases).sort()).toEqual(authRules.map((r) => r.id).sort()));
  for (const rule of authRules) it(`${rule.id} ${rule.title}`, () => checkCase(rule, cases[rule.id]));

  const byId = (id: string) => authRules.find((r) => r.id === id)!;

  it('AUTH-002 missing header is only a warning when a PRM still resolves', () => {
    expect(evaluate(byId('AUTH-002'), authSnap({ challenge: null }))[0].severity).toBe('warning');
  });

  it('AUTH-002 Basic scheme: chatgpt error, claude warning', () => {
    const f = evaluate(byId('AUTH-002'), authSnap({ challenge: 'Basic realm="api"' }));
    expect(f.find((x) => x.platforms.includes('chatgpt'))?.severity).toBe('error');
    expect(f.find((x) => x.platforms.includes('claude'))?.severity).toBe('warning');
  });

  it('AUTH-003 unauthenticated 403 is a warning', () => {
    expect(evaluate(byId('AUTH-003'), snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 403 }); } }))[0].severity).toBe('warning');
  });

  it('AUTH-004 root-only PRM for a path endpoint is claude info', () => {
    const f = evaluate(byId('AUTH-004'), authSnap({ set: (s) => { s.authProbe!.prm!.via = 'well-known-root'; } }));
    expect(f).toMatchObject([{ severity: 'info', platforms: ['claude'] }]);
  });

  it('AUTH-005 path trailing slash: claude/spec error, chatgpt warning (one finding, per-platform severity)', () => {
    const f = evaluate(byId('AUTH-005'), authSnap({ prm: { resource: `${URL_OK}/` } }));
    expect(f).toHaveLength(1);
    expect(f[0].severityByPlatform).toEqual({ claude: 'error', chatgpt: 'warning', spec: 'error' });
    expect(f[0].message).toMatch(/trailing slash/);
  });

  it('AUTH-005 bare origin with or without the root slash is the same URL', () => {
    for (const [url, resource] of [['https://mcp.box.test', 'https://mcp.box.test/'], ['https://mcp.box.test/', 'https://mcp.box.test']]) {
      expect(evaluate(byId('AUTH-005'), authSnap({ url, prm: { resource } }))).toEqual([]);
    }
  });

  it('AUTH-005 origin resource covering a path endpoint (MCP SDK prefix rule): claude info, spec warning', () => {
    const f = evaluate(byId('AUTH-005'), authSnap({ url: 'https://mcp.asana.test/sse', prm: { resource: 'https://mcp.asana.test' } }));
    expect(f.map((x) => [x.platforms.join(','), x.severity]).sort()).toEqual([['claude', 'info'], ['spec', 'warning']]);
    // a sibling path is not covered
    const other = evaluate(byId('AUTH-005'), authSnap({ url: 'https://mcp.acme.test/mcp2', prm: { resource: 'https://mcp.acme.test/mcp' } }));
    expect(other[0].severity).toBe('error');
  });

  it('AUTH-005 messages redact secrets in the server URL', () => {
    const f = evaluate(byId('AUTH-005'), authSnap({ url: 'https://mcp.acme.test/mcp?api_key=SUPERSECRET', prm: { resource: 'https://other.test/mcp' } }));
    expect(f[0].message).not.toContain('SUPERSECRET');
  });

  it('AUTH-008 origin-only issuers that differ by the root slash are info', () => {
    expect(evaluate(byId('AUTH-008'), authSnap({ as: { issuer: `${ISSUER}/` } }))).toMatchObject([{ severity: 'info' }]);
  });

  it('AUTH-002 with a well-known PRM is a Claude-only warning (the spec needs only one mechanism)', () => {
    expect(evaluate(byId('AUTH-002'), authSnap({ challenge: 'Bearer realm="x"' }))).toMatchObject([{ severity: 'warning', platforms: ['claude'] }]);
  });

  it('AUTH-002/004 legacy origin discovery: Claude deprecation warning, chatgpt/spec errors', () => {
    const s = authSnap({ challenge: 'Bearer realm="x"', prm: null, probe: { legacyDiscovery: true } });
    for (const id of ['AUTH-002', 'AUTH-004']) {
      const f = evaluate(byId(id), s);
      expect(f.find((x) => x.platforms.includes('claude'))?.severity, id).toBe('warning');
      expect(f.find((x) => x.platforms.includes('chatgpt'))?.severity, id).toBe('error');
    }
    expect(evaluate(byId('AUTH-013'), s)).toEqual([]);
  });

  it('AUTH-003 insufficient_scope without scope=: claude info, spec warning', () => {
    const s = snap({ url: URL_OK, set: (x) => { x.transport.exchanges = [exchange({ label: 'sdk tools/call', status: 403, headers: { 'www-authenticate': 'Bearer error="insufficient_scope"' } })]; } });
    const f = evaluate(byId('AUTH-003'), s);
    expect(f.map((x) => [x.platforms.join(','), x.severity]).sort()).toEqual([['claude', 'info'], ['spec', 'warning']]);
  });

  it('AUTH-006 multiple authorization servers is a claude warning', () => {
    const f = evaluate(byId('AUTH-006'), authSnap({ prm: { authorization_servers: [ISSUER, 'https://other.test'] } }));
    expect(f).toMatchObject([{ severity: 'warning', platforms: ['claude'] }]);
  });

  it('AUTH-012 pre-registered clients only (no CIMD/DCR) is a Claude warning, not a blocker', () => {
    const f = evaluate(byId('AUTH-012'), authSnap({ as: { client_id_metadata_document_supported: undefined, registration_endpoint: undefined, token_endpoint_auth_methods_supported: ['client_secret_basic'] } }));
    expect(f.find((x) => x.platforms.includes('claude'))).toMatchObject({ severity: 'warning', message: expect.stringMatching(/mcp-review@anthropic\.com/) });
  });

  it('AUTH-012 CIMD without "none" warns for Claude; DCR-only is spec info', () => {
    const f = evaluate(byId('AUTH-012'), authSnap({ as: { token_endpoint_auth_methods_supported: ['client_secret_basic'] } }));
    expect(f.some((x) => x.platforms.includes('claude') && x.severity === 'warning' && /CIMD ignored/.test(x.message))).toBe(true);
    const dcr = evaluate(byId('AUTH-012'), authSnap({ as: { client_id_metadata_document_supported: undefined } }));
    expect(dcr).toMatchObject([{ severity: 'info', platforms: ['spec'] }]);
  });

  it('AUTH-013 401 without OAuth discovery: chatgpt error, claude info', () => {
    const f = evaluate(byId('AUTH-013'), authSnap({ challenge: null, prm: null, probe: { as: [] } }));
    expect(f.find((x) => x.platforms.includes('chatgpt'))?.severity).toBe('error');
    expect(f.find((x) => x.platforms.includes('claude'))?.severity).toBe('info');
  });

  it('AUTH-014 non-boolean flag is a spec error', () => {
    expect(evaluate(byId('AUTH-014'), authSnap({ as: { authorization_response_iss_parameter_supported: 'yes' } }))[0].severity).toBe('error');
  });

  it('AUTH-015 offline_access in PRM scopes is a spec warning; OIDC scopes are chatgpt info', () => {
    const f = evaluate(byId('AUTH-015'), authSnap({ prm: { scopes_supported: ['notes.read', 'offline_access'] }, as: { scopes_supported: ['openid', 'email'] } }));
    expect(f.some((x) => x.platforms.includes('spec') && x.severity === 'warning')).toBe(true);
    expect(f.some((x) => x.platforms.includes('chatgpt') && x.severity === 'info')).toBe(true);
  });

  it('AUTH-016 401 without resource_metadata is a warning', () => {
    expect(evaluate(byId('AUTH-016'), authSnap({ probe: { invalidToken: exchange({ status: 401 }) } }))[0].severity).toBe('warning');
  });

  it('AUTH-017 thresholds are injectable', () => {
    const saved = { ...AUTH_LATENCY };
    AUTH_LATENCY.warningMs = 500;
    try {
      expect(evaluate(byId('AUTH-017'), authSnap({ probe: { timings: { prm: [900] } } }))[0].severity).toBe('warning');
    } finally {
      Object.assign(AUTH_LATENCY, saved);
    }
  });

  it('AUTH-010 TLS failures are errors', () => {
    const f = evaluate(byId('AUTH-010'), authSnap({ set: (s) => { s.transport.tls = [{ host: 'auth.acme.test', ok: false, code: 'CERT_HAS_EXPIRED' }]; } }));
    expect(f[0].message).toMatch(/CERT_HAS_EXPIRED/);
  });

  it('AUTH-010 (B6/B7): a TLS timeout after retries is inconclusive; the MCP host itself is left to SRV-001', () => {
    const f = evaluate(byId('AUTH-010'), authSnap({ set: (s) => {
      s.transport.tls = [
        { host: 'mcp.acme.test', role: 'mcp', ok: false, code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
        { host: 'auth.acme.test', role: 'as', ok: false, code: 'ETIMEDOUT', attempts: ['ETIMEDOUT', 'ETIMEDOUT', 'ETIMEDOUT'], transient: true },
      ];
    } }));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('info');
    expect(f[0].message).toBe('inconclusive (network): TLS handshake with auth.acme.test did not complete: ETIMEDOUT (attempts: ETIMEDOUT, ETIMEDOUT, ETIMEDOUT)');
  });

  it('AUTH-016 (B6): an invalid-token probe that keeps answering 503 is inconclusive', () => {
    const f = evaluate(byId('AUTH-016'), authSnap({ probe: { invalidToken: exchange({ status: 503 }) } }));
    expect(f[0]).toMatchObject({ severity: 'info', message: 'inconclusive (network): invalid bearer token got 503 after retries' });
  });

  it('AUTH-007 (B6): lists every attempt; a definitive 404 everywhere stays an error', () => {
    const s = authSnap({ set: (x) => {
      const as = x.authProbe!.as[0];
      as.json = undefined;
      as.attempts = [
        exchange({ url: `${ISSUER}/.well-known/oauth-authorization-server`, status: 503 }),
        exchange({ url: `${ISSUER}/.well-known/oauth-authorization-server`, status: 404 }),
        exchange({ url: `${ISSUER}/.well-known/openid-configuration`, status: 404 }),
      ];
    } });
    const f = evaluate(byId('AUTH-007'), s);
    expect(f[0].severity).toBe('error');
    expect(f[0].message).toMatch(/oauth-authorization-server: 503, 404; .*openid-configuration: 404\)$/);
  });

  it('local loopback AS over http is accepted', () => {
    const local = 'http://127.0.0.1:4000';
    const s = authSnap({ url: `${local}/mcp`, as: { issuer: local, authorization_endpoint: `${local}/authorize`, token_endpoint: `${local}/token`, registration_endpoint: `${local}/register` }, prm: { authorization_servers: [local] }, set: (x) => { x.localMode = true; x.authProbe!.as[0].issuer = local; } });
    expect(evaluate(byId('AUTH-010'), s)).toEqual([]);
    expect(evaluate(byId('AUTH-006'), s)).toEqual([]);
  });

  it('local mode (R-35): an http AS on a private IP, a dotless host or the MCP host is accepted like loopback; a public one is not', () => {
    const asSnap = (mcp: string, as: string, localMode = true) => authSnap({ url: `${mcp}/mcp`, as: { issuer: as, authorization_endpoint: `${as}/authorize`, token_endpoint: `${as}/token`, registration_endpoint: `${as}/register` }, prm: { authorization_servers: [as] }, set: (x) => { x.localMode = localMode; x.authProbe!.as[0].issuer = as; } });
    for (const [mcp, as] of [['http://10.0.0.5:8080', 'http://10.0.0.5:4000'], ['http://devbox:8080', 'http://devbox:4000'], ['http://mcp.lan:8080', 'http://mcp.lan:4000'], ['http://10.0.0.5:8080', 'http://[fd00::5]:4000']]) {
      expect(evaluate(byId('AUTH-010'), asSnap(mcp, as)), as).toEqual([]);
      expect(evaluate(byId('AUTH-006'), asSnap(mcp, as)), as).toEqual([]);
    }
    expect(evaluate(byId('AUTH-010'), asSnap('http://10.0.0.5:8080', 'http://auth.example.com')).length).toBeGreaterThan(0);
    expect(evaluate(byId('AUTH-006'), asSnap('http://10.0.0.5:8080', 'http://auth.example.com')).length).toBeGreaterThan(0);
    expect(evaluate(byId('AUTH-010'), asSnap('https://mcp.example.com', 'http://10.0.0.5:4000', false)).length).toBeGreaterThan(0);
  });
});

describe('R-12: AUTH-001 by the shared secret-name list (D-rules-3, D-6)', () => {
  const auth001 = authRules.find((r) => r.id === 'AUTH-001')!;

  it('R-12: AUTH-001 uses the shared secret-name list', () => {
    const names = ['api-key', 'credential', 'client_secret', 'session', 'cookie', 'signature', 'pass', 'pwd', 'dsn'];
    const url = `https://mcp.acme.test/mcp?${names.map((n, i) => `${n}=SYNTHV${i}`).join('&')}&page=2`;
    const f = evaluate(auth001, snap({ url }));
    expect(f.map((x) => x.severity)).toEqual(['error']);
    expect(f[0].message).toBe(`URL query contains credential parameter(s): ${names.map((n) => `${n}=«redacted»`).join(', ')}`);
    expect(f[0].message).not.toMatch(/page|SYNTHV/);
  });

  it('R-12: the old AUTH-001 names still count; names that point to a secret do not', () => {
    for (const n of ['token', 'access_token', 'api_key', 'apikey', 'key', 'secret', 'auth', 'password', 'bearer']) {
      expect(evaluate(auth001, snap({ url: `https://mcp.acme.test/mcp?${n}=SYNTHV` })).length, n).toBe(1);
    }
    expect(evaluate(auth001, snap({ url: 'https://mcp.acme.test/sse?sessionId=abc&token_type=x&key_id=k' }))).toEqual([]);
  });
});

describe('R-12: AUTH-010 names a network failure instead of a TLS verdict (D-rules-2)', () => {
  const auth010 = authRules.find((r) => r.id === 'AUTH-010')!;
  const asTls = (code: string) => evaluate(auth010, authSnap({ set: (s) => { s.transport.tls = [{ host: 'auth.acme.test', role: 'as', ok: false, code }]; } }));

  it("R-12: AUTH-010 for tls {role:'as', code:'ENOTFOUND'} says the host does not resolve, not that the TLS handshake failed", () => {
    const f = asTls('ENOTFOUND');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
    expect(f[0].message).not.toMatch(/TLS handshake/);
    expect(f[0].message).toMatch(/does not resolve/);
    expect(f[0].message).toBe('hostname auth.acme.test does not resolve (ENOTFOUND); TLS not checked');
    expect(f[0].fix).toMatch(/^Publish public DNS records/);
    expect(asTls('ECONNREFUSED')[0].message).toBe('connection refused by auth.acme.test:443 (ECONNREFUSED); TLS not checked');
    // a certificate code is still a TLS verdict with the rule's fix
    expect(asTls('CERT_HAS_EXPIRED')[0]).toMatchObject({ message: 'TLS handshake with auth.acme.test failed: CERT_HAS_EXPIRED', fix: auth010.fix });
  });
});

describe('R-12: AUTH-010 gives the DNS fix only for a DNS failure (review round 1)', () => {
  const auth010 = authRules.find((r) => r.id === 'AUTH-010')!;
  const asTls = (code: string) => evaluate(auth010, authSnap({ set: (s) => { s.transport.tls = [{ host: 'auth.acme.test', role: 'as', ok: false, code }]; } }));

  it('R-12: AUTH-010 for ECONNREFUSED and EHOSTUNREACH has no DNS fix; ENOTFOUND keeps it', () => {
    const refused = asTls('ECONNREFUSED')[0];
    expect(refused.message).toBe('connection refused by auth.acme.test:443 (ECONNREFUSED); TLS not checked');
    expect(refused.fix).not.toMatch(/DNS/);
    expect(refused.fix).toBe('Nothing is listening there: check that the server is running and the port is right.');
    const unreach = asTls('EHOSTUNREACH')[0];
    expect(unreach.message).toBe('no route to auth.acme.test:443 (EHOSTUNREACH); TLS not checked');
    expect(unreach.fix).not.toMatch(/DNS/);
    expect(unreach.fix).toMatch(/^Check the address, VPN and firewall/);
    // a code without a hint: reachability, not DNS and not the certificate
    expect(asTls('EACCES')[0].fix).toBe('Make every OAuth endpoint host reachable over https.');
    expect(asTls('ENOTFOUND')[0].fix).toBe('Publish public DNS records for every OAuth endpoint host and serve it over https.');
  });
});
