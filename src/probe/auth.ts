// Auth probe: WWW-Authenticate, PRM discovery, AS discovery, invalid token, timings; active-auth probes.
import { createHash, randomBytes } from 'node:crypto';
import type { AsObservation, AuthProbe, HttpExchange } from '../snapshot.js';
import { scrub, type Redactor, type Tracer } from '../protocol/trace.js';
import { isObj, isStr } from '../rules/util/access.js';
import { parseWwwAuthenticate } from '../rules/util/wwwAuth.js';
import { closeProbeSession, initializeBody, JSON_HEADERS, lookupHost, requestRetried, requestWithRetry, type Deps } from './network.js';

export interface AuthProbeInput {
  tracer: Tracer;
  url: URL;
  trigger: AuthProbe['trigger'];
  challengeExchange: HttpExchange;
  deps: Deps;
  timeoutMs: number;
  activeAuth: boolean;
}

/** The metadata GETs keep their parsed body (keepJson): the PRM and AS observations are that same object (F036). */
const isJsonObject = (e: HttpExchange) => e.status === 200 && isObj(e.json);
/** Longest wait for one metadata GET: these documents are small and static. A lower --timeout lowers it. */
export const METADATA_TIMEOUT_MS = 10000;
/** Retries (beyond the first attempt of each URL) shared by all metadata GETs of one auth probe. */
export const METADATA_RETRY_BUDGET = 6;
const CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:3118/callback', 'http://127.0.0.1:3118/callback'];

export function prmCandidates(url: URL, headerUrl?: string): Array<{ url: string; via: 'header' | 'well-known-path' | 'well-known-root' }> {
  const out: Array<{ url: string; via: 'header' | 'well-known-path' | 'well-known-root' }> = [];
  // The header usually names a well-known URL: request each URL once, under the first way it was found.
  const add = (u: string, via: 'header' | 'well-known-path' | 'well-known-root') => { if (!out.some((c) => c.url === u)) out.push({ url: u, via }); };
  if (headerUrl) { try { add(new URL(headerUrl).href, 'header'); } catch { /* invalid header URL */ } }
  // RFC 9728 §3.1: drop a terminating '/' from the path and keep the query.
  const p = url.pathname.replace(/\/$/, '');
  if (p || url.search) add(new URL(`${url.origin}/.well-known/oauth-protected-resource${p}${url.search}`).href, 'well-known-path');
  add(new URL(`${url.origin}/.well-known/oauth-protected-resource`).href, 'well-known-root');
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
  return (await tracer.request(label, url, { method: 'GET', headers: { accept: 'application/json' }, timeoutMs, keepJson: true })).exchange;
}

const metadataTimeout = (timeoutMs: number) => Math.min(timeoutMs, METADATA_TIMEOUT_MS);

/**
 * A metadata GET retried on timeouts, resets, 5xx and 429 while the probe's shared retry budget lasts: every attempt,
 * the last one being the result. Once the budget is spent each URL gets one attempt.
 */
async function getRetried(input: AuthProbeInput, budget: { retries: number }, label: string, url: string): Promise<HttpExchange[]> {
  const timeoutMs = metadataTimeout(input.timeoutMs);
  if (budget.retries <= 0) return [await get(input.tracer, label, url, timeoutMs)];
  const tries = await requestWithRetry(input.tracer, label, url, { method: 'GET', headers: { accept: 'application/json' }, timeoutMs, keepJson: true }, input.deps.sleep);
  budget.retries -= tries.length - 1;
  return tries;
}

const last = <T>(xs: T[]): T => xs[xs.length - 1];

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
  const budget = { retries: METADATA_RETRY_BUDGET };
  const sampleTimeout = metadataTimeout(timeoutMs);

  // PRM discovery
  for (const cand of prmCandidates(url, bearer?.params.resource_metadata)) {
    const tries = await getRetried(input, budget, `auth prm ${cand.via}`, cand.url);
    probe.prmAttempts.push(...tries);
    const ex = last(tries);
    if (isJsonObject(ex)) {
      probe.prm = { url: cand.url, via: cand.via, json: ex.json as Record<string, unknown>, contentType: ex.contentType };
      probe.timings['protected resource metadata'] = await sample(tracer, 'auth prm', cand.url, ex.durationMs, sampleTimeout);
      break;
    }
  }

  // Legacy (2025-03-26) fallback, as the MCP SDK client does: without PRM the MCP origin acts as the authorization server.
  if (!probe.prm) {
    const legacyUrl = `${url.origin}/.well-known/oauth-authorization-server`;
    const tries = await getRetried(input, budget, 'auth as-metadata (legacy origin)', legacyUrl);
    const ex = last(tries);
    if (isJsonObject(ex)) {
      probe.legacyDiscovery = true;
      probe.as.push({ issuer: url.origin, attempts: tries, discoveryUrl: legacyUrl, json: ex.json as Record<string, unknown> });
      probe.timings['authorization server metadata'] = await sample(tracer, 'auth as-metadata', legacyUrl, ex.durationMs, sampleTimeout);
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
      const tries = await getRetried(input, budget, `auth as-metadata #${i + 1}`, u);
      as.attempts.push(...tries);
      const ex = last(tries);
      if (isJsonObject(ex)) {
        as.discoveryUrl = u;
        as.json = ex.json as Record<string, unknown>;
        if (i === 0) probe.timings['authorization server metadata'] = await sample(tracer, 'auth as-metadata', u, ex.durationMs, sampleTimeout);
        break;
      }
    }
  }

  // Invalid token
  const invalidAuth = { authorization: 'Bearer mcp-review-check-invalid-token' };
  probe.invalidToken = await requestRetried(tracer, 'auth invalid-token', url, {
    method: 'POST', headers: { ...JSON_HEADERS, ...invalidAuth }, body: JSON.stringify(initializeBody()), timeoutMs,
  }, input.deps.sleep);
  await closeProbeSession(tracer, url, probe.invalidToken, invalidAuth, timeoutMs);

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
    const { exchange, json } = await tracer.request('auth dcr', meta.registration_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, timeoutMs,
      body: JSON.stringify({
        client_name: 'mcp-review-check', redirect_uris: CALLBACKS, token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      }),
    });
    out.dcr = exchange;
    timings['registration'] = [exchange.durationMs];
    if (isObj(json) && isStr(json.client_id)) out.clientId = json.client_id;
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
        // keepJson: AUTH-021 reads the token error body (src/rules/auth.ts), F036.
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, timeoutMs, keepJson: true,
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

/** Server-chosen text for one stderr line: printable ASCII only (anything else as \u{..}), at most 200 characters. */
function oneLine(s: string): string {
  const pieces = Array.from(s, (ch) => (/[\x20-\x7e]/.test(ch) ? ch : `\\u{${ch.codePointAt(0)!.toString(16).toUpperCase()}}`));
  if (pieces.join('').length <= 200) return pieces.join('');
  // Cut between characters, never inside an escape: at most 199 characters before the ellipsis.
  let out = '';
  for (const p of pieces) { if (out.length + p.length > 199) break; out += p; }
  return `${out}…`;
}

/**
 * --active-auth: the stderr line that names the DCR client the run registered, so the user can delete it
 * (SECURITY.md). Only the client_id and the registration endpoint (a client_id is not a secret; client_secret and
 * registration_access_token are never printed), scrubbed of the run's secret values. Undefined when no DCR POST was
 * accepted.
 */
export function dcrClientNotice(probe: AuthProbe | undefined, redactor?: Redactor): string | undefined {
  const dcr = probe?.active?.dcr;
  if (!dcr || dcr.status === undefined || dcr.status < 200 || dcr.status >= 300) return undefined;
  // Scrub before escaping, so a secret value is recognised as the run sent it.
  const shown = (v: string) => oneLine(redactor ? scrub(v, redactor) : v);
  const at = shown(dcr.url);
  const clientId = probe!.active!.clientId;
  return clientId !== undefined
    ? `Notice: --active-auth registered DCR client client_id=${shown(clientId)} at ${at}; delete it if your authorization server does not expire unused clients.\n`
    : `Notice: --active-auth registration at ${at} answered ${dcr.status} without a client_id; check your authorization server for a client named mcp-review-check.\n`;
}
