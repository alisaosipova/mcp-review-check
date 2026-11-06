// 1.2.0 block P2 (auth probe): the probe runs at most once per run, so --active-auth registers one DCR client and the
// notice names it (A03-02); the probe is on the snapshot from its start, so a --max-duration stop after the DCR POST
// still names the client it created (I-A03-6). Every server is local, on 127.0.0.1.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/connect.js';
import { dcrClientNotice } from '../src/probe/auth.js';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { tool } from './helpers.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });

type Counts = Record<string, number>;

/**
 * A stateless 2025-11-25 server: initialize is 401 without a bearer and 200 with any bearer; tools/list is 401 with a
 * resource_metadata challenge (an expired token); PRM and AS metadata on the same origin, with a registration endpoint
 * that hands out client-1, client-2, ... `hangAuthorize`: /authorize is never answered.
 */
async function oauthServer(o: { hangAuthorize?: boolean; hangPrm?: boolean } = {}): Promise<{ url: string; counts: Counts }> {
  const counts: Counts = {};
  let clients = 0;
  let origin = '';
  const challenge = () => ({ 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      const key = `${req.method} ${path}`;
      counts[key] = (counts[key] ?? 0) + 1;
      if (path.startsWith('/.well-known/oauth-protected-resource') && o.hangPrm) return; // never answered
      if (path.startsWith('/.well-known/oauth-protected-resource')) return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
      if (path === '/.well-known/oauth-authorization-server') {
        return json(res, 200, {
          issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`,
          response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
        });
      }
      if (path === '/register') return json(res, 201, { client_id: `client-${++clients}` });
      if (path === '/authorize') { if (o.hangAuthorize) return; res.writeHead(400); res.end(); return; }
      if (path === '/token') return json(res, 400, { error: 'invalid_grant' });
      if (path !== '/mcp') { res.writeHead(404); res.end(); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      let m: { id?: unknown; method?: string } = {};
      try { m = JSON.parse(body); } catch { /* not JSON */ }
      const bearer = /^Bearer /.test(String(req.headers.authorization ?? ''));
      const valid = bearer && req.headers.authorization !== 'Bearer mcp-review-check-invalid-token';
      if (m.method === 'initialize') {
        if (!valid) return json(res, 401, { error: 'unauthorized' }, challenge());
        return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'a3', version: '1' } } });
      }
      if (m.id === undefined) { res.writeHead(202); res.end(); return; }
      if (m.method === 'tools/list') return json(res, 401, { error: 'invalid_token' }, challenge());
      return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { tools: [tool()] } });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  origin = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url: `${origin}/mcp`, counts };
}

const BEARER = ['tok', 'SYNTH', 'p2auth'].join('_');

describe('the auth probe runs at most once per run (A03-02)', () => {
  it('with --active-auth one DCR client is registered, and the notice names it', async () => {
    const { url, counts } = await oauthServer();
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, bearer: BEARER, activeAuth: true, timeoutMs: 5000 });
    expect(snap.coverage.toolLevel).toBe('token-rejected');
    expect(counts['POST /register']).toBe(1);
    expect(counts['GET /authorize']).toBe(3);
    expect(counts['POST /token']).toBe(2);
    expect(snap.authProbe?.active?.clientId).toBe('client-1');
    expect(dcrClientNotice(snap.authProbe)).toMatch(/client_id=client-1 at /);
    // One PRM document fetch plus its two timing samples, not two rounds of them.
    expect(counts['GET /.well-known/oauth-protected-resource/mcp']).toBe(3);
  }, 30000);

  it('without --active-auth the metadata is fetched once and nothing is registered', async () => {
    const { url, counts } = await oauthServer();
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, bearer: BEARER, timeoutMs: 5000 });
    expect(snap.authProbe?.trigger).toBe('preflight-401');
    expect(counts['POST /register']).toBeUndefined();
    expect(counts['GET /.well-known/oauth-authorization-server']).toBe(3);
  }, 30000);
});

describe('a stop after the DCR POST still names the client (I-A03-6)', () => {
  it('--max-duration during /authorize keeps the registration on the snapshot', async () => {
    const { url, counts } = await oauthServer({ hangAuthorize: true });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, activeAuth: true, timeoutMs: 20000, maxDurationMs: 2500 });
    expect(counts['POST /register']).toBe(1);
    expect(snap.limits?.stopped?.phase).toBe('auth probe');
    expect(snap.authProbe?.active?.clientId).toBe('client-1');
    expect(dcrClientNotice(snap.authProbe)).toMatch(/registered DCR client client_id=client-1/);
    const ids = runRules(snap, RULES).findings.map((f) => f.ruleId);
    expect(ids).not.toContain('AUTH-004');
    expect(ids).not.toContain('AUTH-007');
  }, 30000);

  it('a stop while the PRM GET hangs reports no missing PRM or AS metadata (the partial probe is not a finished one)', async () => {
    const { url } = await oauthServer({ hangPrm: true });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, maxDurationMs: 1500 });
    expect(snap.limits?.stopped?.phase).toBe('auth probe');
    expect(snap.authProbe?.prm).toBeUndefined();
    const ids = runRules(snap, RULES).findings.map((f) => f.ruleId);
    expect(ids).not.toContain('AUTH-004');
    expect(ids).not.toContain('AUTH-007');
  }, 30000);
});
