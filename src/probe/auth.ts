// Auth probe: WWW-Authenticate, PRM discovery, AS discovery, invalid token, timings; active-auth probes.
import { createHash, randomBytes } from 'node:crypto';
import type { AsObservation, AuthProbe, HttpExchange } from '../snapshot.js';
import type { Tracer } from '../protocol/trace.js';
import { isObj, isStr } from '../rules/util/access.js';
import { parseWwwAuthenticate } from '../rules/util/wwwAuth.js';
import { initializeBody, JSON_HEADERS, lookupHost, type Deps } from './network.js';

export interface AuthProbeInput {
  tracer: Tracer;
  url: URL;
  trigger: AuthProbe['trigger'];
  challengeExchange: HttpExchange;
  deps: Deps;
  timeoutMs: number;
  activeAuth: boolean;
}

const isJsonObject = (e: HttpExchange) => e.status === 200 && isObj(e.json);
const CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:3118/callback', 'http://127.0.0.1:3118/callback'];

export function prmCandidates(url: URL, headerUrl?: string): Array<{ url: string; via: 'header' | 'well-known-path' | 'well-known-root' }> {
  const out: Array<{ url: string; via: 'header' | 'well-known-path' | 'well-known-root' }> = [];
  if (headerUrl) { try { out.push({ url: new URL(headerUrl).href, via: 'header' }); } catch { /* invalid header URL */ } }
  // RFC 9728 §3.1: drop a terminating '/' from the path and keep the query.
  const p = url.pathname.replace(/\/$/, '');
  if (p || url.search) out.push({ url: `${url.origin}/.well-known/oauth-protected-resource${p}${url.search}`, via: 'well-known-path' });
  out.push({ url: `${url.origin}/.well-known/oauth-protected-resource`, via: 'well-known-root' });
  return out;
}

export function asDiscoveryUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const p = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  if (p) {
    return [
      `${u.origin}/.well-known/oauth-authorization-server${p}`,
      `${u.origin}/.well-known/openid-configuration${p}`,
      `${u.origin}${p}/.well-known/openid-configuration`,
    ];
  }
  return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
}

async function get(tracer: Tracer, label: string, url: string, timeoutMs: number): Promise<HttpExchange> {
  return (await tracer.request(label, url, { method: 'GET', headers: { accept: 'application/json' }, timeoutMs })).exchange;
}

async function sample(tracer: Tracer, label: string, url: string, first: number, timeoutMs: number): Promise<number[]> {
  const xs = [first];
  for (let i = 0; i < 2; i++) xs.push((await get(tracer, `${label} (timing)`, url, timeoutMs)).durationMs);
  return xs;
}

export interface TlsHost { host: string; hostname: string; port: number }

export async function runAuthProbe(input: AuthProbeInput): Promise<{ probe: AuthProbe; tlsHosts: TlsHost[] }> {
  const { tracer, url, timeoutMs } = input;
  const raw = input.challengeExchange.headers?.['www-authenticate'] ?? '';
  const parsed = parseWwwAuthenticate(raw);
  const probe: AuthProbe = {
    trigger: input.trigger,
    challenge: { status: input.challengeExchange.status ?? 0, raw, parsed: parsed.map((c) => ({ scheme: c.scheme, params: c.params })) },
    prmAttempts: [], as: [], timings: {},
  };
  const bearer = parsed.find((c) => c.scheme === 'bearer' || c.scheme === 'dpop');

  // PRM discovery
  for (const cand of prmCandidates(url, bearer?.params.resource_metadata)) {
    const ex = await get(tracer, `auth prm ${cand.via}`, cand.url, timeoutMs);
    probe.prmAttempts.push(ex);
    if (isJsonObject(ex)) {
      probe.prm = { url: cand.url, via: cand.via, json: ex.json as Record<string, unknown>, contentType: ex.contentType };
      probe.timings['protected resource metadata'] = await sample(tracer, 'auth prm', cand.url, ex.durationMs, timeoutMs);
      break;
    }
  }

  // Legacy (2025-03-26) fallback, as the MCP SDK client does: without PRM the MCP origin acts as the authorization server.
  if (!probe.prm) {
    const legacyUrl = `${url.origin}/.well-known/oauth-authorization-server`;
    const ex = await get(tracer, 'auth as-metadata (legacy origin)', legacyUrl, timeoutMs);
    if (isJsonObject(ex)) {
      probe.legacyDiscovery = true;
      probe.as.push({ issuer: url.origin, attempts: [ex], discoveryUrl: legacyUrl, json: ex.json as Record<string, unknown> });
      probe.timings['authorization server metadata'] = await sample(tracer, 'auth as-metadata', legacyUrl, ex.durationMs, timeoutMs);
    }
  }

  // AS discovery (up to 3 servers)
  const servers = Array.isArray(probe.prm?.json.authorization_servers) ? (probe.prm!.json.authorization_servers as unknown[]).filter(isStr).slice(0, 3) : [];
  for (const [i, issuer] of servers.entries()) {
    const as: AsObservation = { issuer, attempts: [] };
    probe.as.push(as);
    let urls: string[];
    try { urls = asDiscoveryUrls(issuer); } catch { continue; }
    for (const u of urls) {
      const ex = await get(tracer, `auth as-metadata #${i + 1}`, u, timeoutMs);
      as.attempts.push(ex);
      if (isJsonObject(ex)) {
        as.discoveryUrl = u;
        as.json = ex.json as Record<string, unknown>;
        if (i === 0) probe.timings['authorization server metadata'] = await sample(tracer, 'auth as-metadata', u, ex.durationMs, timeoutMs);
        break;
      }
    }
  }

  // Invalid token
  probe.invalidToken = (await tracer.request('auth invalid-token', url, {
    method: 'POST', headers: { ...JSON_HEADERS, authorization: 'Bearer mcp-review-check-invalid-token' }, body: JSON.stringify(initializeBody()), timeoutMs,
  })).exchange;

  // DNS and TLS for the authorization server
  const tlsHosts = new Map<string, TlsHost>();
  probe.asDns = [];
  const first = probe.as[0];
  if (first) {
    try {
      const host = new URL(first.issuer).hostname;
      if (host !== url.hostname) probe.asDns.push(await lookupHost(host, input.deps));
    } catch { /* invalid issuer reported by AUTH-006 */ }
    const meta = first.json ?? {};
    for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'jwks_uri']) {
      const v = meta[k] ?? (k === 'issuer' ? first.issuer : undefined);
      if (!isStr(v)) continue;
      try {
        const u = new URL(v);
        // keep hostname and port from the parsed URL: re-splitting "host:port" breaks IPv6 literals
        if (u.protocol === 'https:' && u.host !== url.host) tlsHosts.set(u.host, { host: u.host, hostname: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port || 443) });
      } catch { /* ignore */ }
    }
  }

  if (input.activeAuth && first?.json) probe.active = await activeAuth(tracer, url, first.json, timeoutMs, probe.timings);
  return { probe, tlsHosts: [...tlsHosts.values()] };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** --active-auth: creates a DCR client and probes /authorize and /token with bogus values. */
async function activeAuth(tracer: Tracer, url: URL, meta: Record<string, unknown>, timeoutMs: number, timings: Record<string, number[]>): Promise<NonNullable<AuthProbe['active']>> {
  const out: NonNullable<AuthProbe['active']> = {};
  if (isStr(meta.registration_endpoint)) {
    const { exchange } = await tracer.request('auth dcr', meta.registration_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, timeoutMs,
      body: JSON.stringify({
        client_name: 'mcp-review-check', redirect_uris: CALLBACKS, token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      }),
    });
    out.dcr = exchange;
    timings['registration'] = [exchange.durationMs];
    if (isObj(exchange.json) && isStr(exchange.json.client_id)) out.clientId = exchange.json.client_id;
  }
  const clientId = out.clientId ?? 'mcp-review-check';
  if (isStr(meta.authorization_endpoint)) {
    out.authorize = [];
    for (const redirect of CALLBACKS) {
      const { challenge } = pkce();
      const u = new URL(meta.authorization_endpoint);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('redirect_uri', redirect);
      u.searchParams.set('code_challenge', challenge);
      u.searchParams.set('code_challenge_method', 'S256');
      u.searchParams.set('state', randomBytes(8).toString('hex'));
      u.searchParams.set('resource', url.href);
      out.authorize.push((await tracer.request('auth authorize', u, { method: 'GET', timeoutMs })).exchange);
    }
  }
  if (isStr(meta.token_endpoint)) {
    out.token = [];
    const form = (params: Record<string, string>) => new URLSearchParams(params).toString();
    const post = async (label: string, body: string) =>
      (await tracer.request(label, meta.token_endpoint as string, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, timeoutMs,
      })).exchange;
    const code = await post('auth token code', form({
      grant_type: 'authorization_code', code: 'mcp-review-check-bogus-code', redirect_uri: CALLBACKS[0], client_id: clientId, code_verifier: pkce().verifier, resource: url.href,
    }));
    out.token.push(code);
    timings['token'] = [code.durationMs];
    if (out.clientId) out.token.push(await post('auth token refresh', form({ grant_type: 'refresh_token', refresh_token: 'mcp-review-check-bogus-refresh', client_id: clientId })));
  }
  return out;
}
