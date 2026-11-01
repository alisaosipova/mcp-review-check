// Regression tests for the 2026-11-01 review remediation, package WP7 (AUTH, SPEC, SRV rules, MAN checklist, net and
// WWW-Authenticate helpers). One describe block per finding id.
import { describe, expect, it } from 'vitest';
import { authRules } from '../src/rules/auth.js';
import { serverRules } from '../src/rules/server.js';
import { specRules } from '../src/rules/spec.js';
import type { Rule } from '../src/rules/types.js';
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
// @end
