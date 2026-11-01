// Regression tests for the 2026-11-01 review remediation, package WP7 (AUTH, SPEC, SRV rules, MAN checklist, net and
// WWW-Authenticate helpers). One describe block per finding id.
import { describe, expect, it } from 'vitest';
import { authRules } from '../src/rules/auth.js';
import { serverRules } from '../src/rules/server.js';
import { specRules } from '../src/rules/spec.js';
import type { Rule } from '../src/rules/types.js';
import { parseWwwAuthenticate } from '../src/rules/util/wwwAuth.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, exchange, snap } from './helpers.js';

const URL_OK = 'https://mcp.acme.test/mcp';
const byId = (id: string): Rule => [...authRules, ...specRules, ...serverRules].find((r) => r.id === id)!;
const modern = (set?: (s: Snapshot) => void) => snap({
  url: URL_OK,
  set: (s) => {
    s.era = 'modern';
    s.protocolVersion = '2026-07-28';
    s.discoverRaw = { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000, cacheScope: 'public' };
    set?.(s);
  },
});
const rpcErr = (status: number, code: number, data?: unknown) => exchange({ status, json: { jsonrpc: '2.0', id: 1, error: { code, message: 'Unsupported protocol version', data } }, requestJson: { jsonrpc: '2.0', id: 1, method: 'server/discover' } });

describe('F041 SPEC-011 when server/discover was rejected', () => {
  it('reports the status, code and data.supported as info instead of "result is not an object"', () => {
    const s = modern((x) => { x.discoverRaw = undefined; x.transport.probes.discover = rpcErr(400, -32022, { supported: ['2026-12-01'] }); });
    const f = evaluate(byId('SPEC-011'), s);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('info');
    expect(f[0].message).toMatch(/HTTP 400 \/ code -32022/);
    expect(f[0].message).toMatch(/2026-12-01/);
    expect(f[0].message).not.toMatch(/not an object/);
  });

  it('a header-mismatch code names the probe headers', () => {
    const s = modern((x) => { x.discoverRaw = undefined; x.transport.probes.discover = rpcErr(400, -32020); });
    expect(evaluate(byId('SPEC-011'), s)[0].message).toMatch(/rejected the probe's headers/);
  });

  it('a non-object result is still an error', () => {
    const s = modern((x) => { x.discoverRaw = 'nope'; });
    expect(evaluate(byId('SPEC-011'), s)).toMatchObject([{ severity: 'error', message: 'server/discover result is not an object' }]);
  });
});

const authorizeSnap = (ex: Parameters<typeof exchange>[0]) => snap({
  url: URL_OK,
  activeAuth: true,
  set: (s) => {
    s.authProbe = { trigger: 'preflight-401', prmAttempts: [], as: [], timings: {}, active: { authorize: [exchange({ method: 'GET', url: 'https://auth.acme.test/authorize?redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback', ...ex })] } };
  },
});

describe('F038 AUTH-020 login page carrying redirect_uri', () => {
  it('a 200 sign-in page with redirect_uri in a hidden input is info, not a rejection', () => {
    const body = '<html><h1>Sign in</h1><form method="post"><input type="hidden" name="redirect_uri" value="https://claude.ai/api/mcp/auth_callback"></form></html>';
    expect(evaluate(byId('AUTH-020'), authorizeSnap({ status: 200, bodySnippet: body }))).toMatchObject([{ severity: 'info', message: expect.stringMatching(/login page/) }]);
  });

  it('an error body naming redirect_uri is still a rejection', () => {
    expect(evaluate(byId('AUTH-020'), authorizeSnap({ status: 200, bodySnippet: '<p>Invalid redirect_uri</p>' }))[0].severity).toBe('error');
    expect(evaluate(byId('AUTH-020'), authorizeSnap({ status: 200, bodySnippet: '<p>The redirect_uri is not registered for this client</p>' }))[0].severity).toBe('error');
    expect(evaluate(byId('AUTH-020'), authorizeSnap({ status: 403, json: { error: 'invalid_request', error_description: 'redirect_uri mismatch' } }))[0].severity).toBe('error');
    expect(evaluate(byId('AUTH-020'), authorizeSnap({ status: 400 }))[0].severity).toBe('error');
  });
});

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
const PRM_URL = 'https://mcp.acme.test/.well-known/oauth-protected-resource/mcp';
const CHALLENGE = `Bearer resource_metadata="${PRM_URL}", scope="notes.read"`;

interface AuthOpts {
  challenge?: string | null;
  prm?: Record<string, unknown> | null;
  as?: Record<string, unknown>;
  probe?: Partial<NonNullable<Snapshot['authProbe']>>;
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
        prm: prmJson ? { url: PRM_URL, via: 'header', json: prmJson, contentType: 'application/json' } : undefined,
        as: [{ issuer: ISSUER, attempts: [], discoveryUrl: `${ISSUER}/.well-known/oauth-authorization-server`, json: { ...GOOD_AS, ...(o.as ?? {}) } }],
        invalidToken: exchange({ status: 401, headers: { 'www-authenticate': CHALLENGE } }),
        timings: { 'protected resource metadata': [120, 90, 100] },
        ...(o.probe ?? {}),
      };
      o.set?.(s);
    },
  });
}

describe('F020 unquoted URL in WWW-Authenticate', () => {
  it('reads an unquoted resource_metadata URL whole, without a phantom challenge', () => {
    const parsed = parseWwwAuthenticate(`Bearer resource_metadata=${PRM_URL}, scope="a b"`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ scheme: 'bearer', params: { resource_metadata: PRM_URL, scope: 'a b' }, unquoted: ['resource_metadata'] });
  });

  it('keeps tokens, quoted strings and multiple challenges as before', () => {
    expect(parseWwwAuthenticate('Basic realm="r", Bearer error=invalid_token, resource_metadata="https://a/x"')).toEqual([
      { scheme: 'basic', params: { realm: 'r' } },
      { scheme: 'bearer', params: { error: 'invalid_token', resource_metadata: 'https://a/x' } },
    ]);
  });

  it('AUTH-002 accepts the URL and adds only a spec note about quoting', () => {
    const f = evaluate(byId('AUTH-002'), authSnap({ challenge: `Bearer resource_metadata=${PRM_URL}` }));
    expect(f).toMatchObject([{ platforms: ['spec'], severity: 'warning', message: expect.stringMatching(/quoted-string/) }]);
  });
});

describe('F052 AUTH-017 one slow sample out of three', () => {
  const latency = (xs: number[]) => evaluate(byId('AUTH-017'), authSnap({ probe: { timings: { 'authorization server metadata': xs } } }));

  it('a single spike over 10 s is a warning naming the sample count', () => {
    expect(latency([100, 11000, 120])).toMatchObject([{ severity: 'warning', message: expect.stringMatching(/1 of 3 samples/) }]);
  });

  it('most samples over 10 s, or a single one-shot call, stay an error', () => {
    expect(latency([11000, 100, 12000])[0].severity).toBe('error');
    expect(latency([11000])[0].severity).toBe('error');
  });
});

describe('F050 missing initialize.serverInfo is reported once', () => {
  it('SRV-013 reports it and SPEC-001 does not', () => {
    const s = snap({ set: (x) => { x.initializeRaw = { protocolVersion: '2025-11-25', capabilities: {} }; } });
    expect(evaluate(byId('SRV-013'), s)).toMatchObject([{ severity: 'error', message: 'initialize result has no serverInfo' }]);
    expect(evaluate(byId('SPEC-001'), s)).toEqual([]);
  });
});

describe('F049 modern-only GET and session findings come from SPEC-015 alone', () => {
  const s = modern((x) => {
    x.transport.probes.get = exchange({ method: 'GET', status: 200, contentType: 'text/html' });
    x.transport.probes.delete = exchange({ method: 'DELETE', status: 404 });
    x.transport.sessionId = '6f1c2a0e-3b7d-4c55-9a51-0e2d8c1b7f42';
  });

  it('SPEC-015 lists the session, GET and DELETE; SPEC-005 and SPEC-006 stay silent', () => {
    expect(evaluate(byId('SPEC-015'), s).map((f) => f.message).sort()).toEqual([
      'DELETE returned 404, expected 405', 'GET returned 200, expected 405', 'server mints or echoes Mcp-Session-Id',
    ]);
    expect(evaluate(byId('SPEC-005'), s)).toEqual([]);
    expect(evaluate(byId('SPEC-006'), s)).toEqual([]);
  });

  it('SPEC-006 still checks the session id format on a modern-only server', () => {
    const bad = modern((x) => { x.transport.sessionId = 'bad id'; });
    expect(evaluate(byId('SPEC-006'), bad)).toMatchObject([{ severity: 'error' }]);
  });
});

describe('F051 a 401 without any OAuth discovery is one error (AUTH-004)', () => {
  const s = authSnap({ challenge: null, prm: null, probe: { as: [] } });

  it('AUTH-004 fails every platform; AUTH-002 and AUTH-013 add only context', () => {
    expect(evaluate(byId('AUTH-004'), s)).toMatchObject([{ severity: 'error' }]);
    const a2 = evaluate(byId('AUTH-002'), s);
    expect(a2).toMatchObject([{ severity: 'info', message: expect.stringMatching(/see AUTH-004/) }]);
    expect(evaluate(byId('AUTH-013'), s).every((f) => f.severity === 'info')).toBe(true);
  });

  it('legacy discovery and a reachable PRM keep their AUTH-002 verdicts', () => {
    const legacy = evaluate(byId('AUTH-002'), authSnap({ challenge: 'Bearer realm="x"', prm: null, probe: { legacyDiscovery: true } }));
    expect(legacy.find((f) => f.platforms.includes('chatgpt'))?.severity).toBe('error');
    expect(evaluate(byId('AUTH-002'), authSnap({ challenge: null }))).toMatchObject([{ severity: 'warning', platforms: ['claude'] }]);
  });
});

describe('F045 DPoP challenges count like Bearer', () => {
  it('AUTH-015 reads scope= from a DPoP challenge', () => {
    const f = evaluate(byId('AUTH-015'), authSnap({ challenge: `DPoP resource_metadata="${PRM_URL}", scope="a b"` }));
    expect(f.map((x) => x.message).join('\n')).not.toMatch(/has no scope=/);
  });

  it('AUTH-016 accepts resource_metadata on a DPoP invalid-token challenge', () => {
    const s = authSnap({ probe: { invalidToken: exchange({ status: 401, headers: { 'www-authenticate': `DPoP resource_metadata="${PRM_URL}"` } }) } });
    expect(evaluate(byId('AUTH-016'), s)).toEqual([]);
  });
});

describe('F042 AUTH-012 CIMD without "none" and without DCR', () => {
  const claude = (as: Record<string, unknown>) => evaluate(byId('AUTH-012'), authSnap({ as })).filter((f) => f.platforms.includes('claude'));

  it('gives one Claude warning that names the ignored CIMD and the missing DCR', () => {
    const f = claude({ token_endpoint_auth_methods_supported: ['client_secret_basic'], registration_endpoint: undefined });
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/CIMD advertised without token auth method "none" \(Claude ignores it\) and no DCR/);
    expect(f[0].message).not.toMatch(/falls back to DCR|neither CIMD nor DCR/);
  });

  it('with DCR it still says CIMD falls back to DCR; with neither it says so', () => {
    expect(claude({ token_endpoint_auth_methods_supported: ['client_secret_basic'] }).map((x) => x.message)).toEqual(['CIMD advertised without token auth method "none": CIMD ignored, falls back to DCR']);
    expect(claude({ client_id_metadata_document_supported: undefined, registration_endpoint: undefined })[0].message).toMatch(/^neither CIMD nor DCR/);
  });
});
// @end
