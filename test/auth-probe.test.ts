// Auth probe against a local HTTP server that mimics 401 + PRM + AS metadata endpoints.
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/connect.js';
import type { Deps } from '../src/probe/network.js';
import { AUTH_LATENCY } from '../src/rules/auth.js';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { startAuthServer, type AuthServerOptions } from './fixtures/auth-server.js';
import type { Started } from './fixtures/http-bridge.js';

/** Injected deps: the tests never touch DNS or remote TLS. */
const deps: Deps = {
  resolve4: async () => { throw new Error('DNS must not be used in tests'); },
  resolve6: async () => { throw new Error('DNS must not be used in tests'); },
  tlsCheck: async () => ({ ok: true }),
  now: () => performance.now(),
  sleep: async () => {},
};

let server: Started | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

async function probe(opts: AuthServerOptions = {}, extra: { activeAuth?: boolean; suffix?: string } = {}) {
  server = await startAuthServer(opts);
  const { snap } = await buildSnapshot({ target: { kind: 'http', url: server.url + (extra.suffix ?? '') }, timeoutMs: 5000, activeAuth: extra.activeAuth }, deps);
  const findings = runRules(snap, RULES).findings.filter((f) => f.ruleId.startsWith('AUTH-'));
  return { snap, findings, ids: [...new Set(findings.map((f) => f.ruleId))].sort() };
}

describe('auth probe', () => {
  it('good server (Linear shape): discovery succeeds and no AUTH errors or warnings', async () => {
    const { snap, findings } = await probe();
    const a = snap.authProbe!;
    expect(a.trigger).toBe('preflight-401');
    expect(a.prm?.via).toBe('header');
    expect(a.as[0].discoveryUrl).toMatch(/\/\.well-known\/oauth-authorization-server$/);
    expect(a.invalidToken?.status).toBe(401);
    expect(a.timings['protected resource metadata']).toHaveLength(3);
    expect(snap.coverage.toolLevel).toBe('auth-required');
    expect(findings.filter((f) => f.severity !== 'info')).toEqual([]);
    // the invalid-token request header is redacted in the trace
    expect(a.invalidToken?.requestHeaders.authorization).toBe('«redacted»');
  });

  it('missing WWW-Authenticate: falls back to well-known PRM and warns', async () => {
    const { snap, findings } = await probe({ noWwwAuth: true });
    expect(snap.authProbe!.prm?.via).toBe('well-known-path');
    expect(findings.find((f) => f.ruleId === 'AUTH-002')?.severity).toBe('warning');
  });

  it('resource mismatched by a trailing slash: claude and spec errors with a hint', async () => {
    const { findings } = await probe({ resourceTrailingSlash: true });
    const f = findings.filter((x) => x.ruleId === 'AUTH-005');
    expect(f).toHaveLength(1);
    expect(f[0].severityByPlatform).toMatchObject({ claude: 'error', spec: 'error' });
    expect(f[0].message).toMatch(/trailing slash/);
  });

  it('URL with a trailing slash: the path-aware PRM drops the terminating "/" (RFC 9728 §3.1)', async () => {
    const { snap, ids } = await probe({ noWwwAuth: true }, { suffix: '/' });
    expect(snap.authProbe!.prmAttempts[0].url).toMatch(/\/\.well-known\/oauth-protected-resource\/mcp$/);
    expect(snap.authProbe!.prm?.via).toBe('well-known-path');
    expect(ids).not.toContain('AUTH-004');
  });

  it('legacy (2025-03-26) discovery: origin AS metadata is found; Claude gets deprecation warnings, not blockers', async () => {
    const { snap, findings } = await probe({ legacyOnly: true });
    const a = snap.authProbe!;
    expect(a.prm).toBeUndefined();
    expect(a.legacyDiscovery).toBe(true);
    expect(a.as[0].json?.issuer).toBe(new URL(server!.url).origin);
    const claudeErrors = findings.filter((x) => x.platforms.includes('claude') && (x.severityByPlatform?.claude ?? x.severity) === 'error');
    expect(claudeErrors.map((x) => `${x.ruleId} ${x.message}`)).toEqual([]);
    expect(findings.find((x) => x.ruleId === 'AUTH-004' && x.platforms.includes('claude'))?.severity).toBe('warning');
  });

  it('origin-only issuer differing by the root slash is info', async () => {
    const { findings } = await probe({ issuerTrailingSlash: true });
    expect(findings.find((x) => x.ruleId === 'AUTH-008')?.severity).toBe('info');
  });

  it('two authorization servers: claude warning; second AS checked for chatgpt', async () => {
    const { snap, findings } = await probe({ twoAs: true });
    expect(findings.find((f) => f.ruleId === 'AUTH-006')).toMatchObject({ severity: 'warning', platforms: ['claude'] });
    expect(snap.authProbe!.as).toHaveLength(2);
    expect(findings.find((f) => f.ruleId === 'AUTH-007')).toMatchObject({ platforms: ['chatgpt'] });
  });

  it('no CIMD/DCR: Claude warning (pre-registered credentials are a supported path)', async () => {
    const { findings } = await probe({ noRegistration: true });
    const f = findings.filter((x) => x.ruleId === 'AUTH-012');
    expect(f.find((x) => x.platforms.includes('claude'))?.severity).toBe('warning');
  });

  it.each([
    ['issuer mismatch', { issuerMismatch: true }, 'AUTH-008'],
    ['no S256', { noS256: true }, 'AUTH-011'],
    ['client_credentials only', { clientCredentialsOnly: true }, 'AUTH-013'],
    ['200 for an invalid token', { invalidToken200: true }, 'AUTH-016'],
  ] as const)('%s → %s', async (_label, opts, id) => {
    const { ids, findings } = await probe(opts);
    expect(ids).toContain(id);
    expect(findings.find((f) => f.ruleId === id)?.severity).toBe('error');
  });

  it('B6: transient 503s on PRM and AS metadata are retried; the run is clean', async () => {
    const { snap, findings } = await probe({ asFailures: 2, prmFailures: 1 });
    const a = snap.authProbe!;
    expect(a.prm).toBeDefined();
    expect(a.as[0].json).toBeDefined();
    expect(a.as[0].attempts.map((e) => e.status)).toEqual([503, 503, 200]);
    expect(a.as[0].attempts[1].label).toMatch(/\(retry 1\)$/);
    expect(findings.filter((f) => f.severity !== 'info').map((f) => `${f.ruleId} ${f.message}`)).toEqual([]);
  });

  it('B6: AS metadata that keeps failing with 503 is inconclusive (network), with the status of every attempt', async () => {
    const { findings } = await probe({ asFailures: 100 });
    const f = findings.filter((x) => x.ruleId === 'AUTH-007');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('info');
    expect(f[0].message).toMatch(/^inconclusive \(network\): no authorization server metadata .*oauth-authorization-server: 503, 503, 503; .*openid-configuration: 404/);
  });

  it('B6: PRM that keeps failing is inconclusive, not an AUTH-004 error', async () => {
    const { findings } = await probe({ prmFailures: 100, noWwwAuth: false });
    const f = findings.find((x) => x.ruleId === 'AUTH-004');
    expect(f?.severity).toBe('info');
    expect(f?.message).toMatch(/inconclusive \(network\).*503, 503, 503/);
  });

  it('1 s artificial delay triggers AUTH-017 with injected thresholds', async () => {
    const saved = { ...AUTH_LATENCY };
    Object.assign(AUTH_LATENCY, { warningMs: 500, errorMs: 5000 });
    try {
      const { findings } = await probe({ delayMs: 1000 });
      expect(findings.find((f) => f.ruleId === 'AUTH-017')?.severity).toBe('warning');
    } finally {
      Object.assign(AUTH_LATENCY, saved);
    }
  });

  it('--active-auth registers a client and probes /authorize and /token', async () => {
    const { snap, ids } = await probe({}, { activeAuth: true });
    const act = snap.authProbe!.active!;
    expect(act.clientId).toBe('client-123');
    expect(act.authorize).toHaveLength(3);
    expect(act.token?.length).toBe(2);
    for (const id of ['AUTH-019', 'AUTH-020', 'AUTH-021']) expect(ids).not.toContain(id);
  });
});
