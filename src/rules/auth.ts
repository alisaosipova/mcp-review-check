// AUTH: OAuth and authorization (§2.8).
import type { AsObservation, Platform, Snapshot } from '../snapshot.js';
import { defineRule, type RawFinding } from './types.js';
import { describeCause, isTlsCode } from '../diagnose.js';
import { isObj, isStr, isStrArray, type Obj } from './util/access.js';
import { displayUrl, isLoopbackHost, isNonPublicIp, isSecretQueryParam } from './util/net.js';
import { describeAttempts, endedTransient, INCONCLUSIVE, isTransient } from './util/obs.js';
import { parseWwwAuthenticate } from './util/wwwAuth.js';

const CLAUDE_AUTH = 'https://claude.com/docs/connectors/building/authentication';
const OAI_AUTH = 'https://developers.openai.com/plugins/build/auth';
const AS_DISCOVERY = 'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery';

/** Latency thresholds for AUTH-017 (mutable for tests). */
export const AUTH_LATENCY = { errorMs: 10000, warningMs: 3000 };


/** Iterate discovered authorization servers: [0] for every platform, [1..2] for ChatGPT only. */
function forEachAs(snap: Snapshot, fn: (as: AsObservation, meta: Obj, i: number, platforms?: Platform[]) => RawFinding[]): RawFinding[] {
  const list = snap.authProbe?.as ?? [];
  return list.slice(0, 3).flatMap((as, i) => {
    if (!as.json) return [];
    const platforms: Platform[] | undefined = i === 0 ? undefined : ['chatgpt'];
    return fn(as, as.json, i, platforms).map((f) => ({
      ...f,
      platforms: f.platforms && platforms ? f.platforms.filter((p) => platforms.includes(p)) : f.platforms ?? platforms,
      message: i === 0 ? f.message : `${f.message} (authorization server #${i + 1})`,
    })).filter((f) => !f.platforms || f.platforms.length > 0);
  });
}

/** https, or in local mode plain http on a local host: loopback, a non-public IP, a name without a dot or the MCP host (R-35). */
function httpsOrLocal(snap: Snapshot, raw: string): boolean {
  try {
    const u = new URL(raw);
    const h = u.hostname.replace(/^\[|\]$/g, '');
    const local = isLoopbackHost(h) || isNonPublicIp(h) || !/[.:]/.test(h) || (snap.target.kind === 'http' && u.hostname === snap.target.url.hostname);
    return u.protocol === 'https:' || (snap.localMode && u.protocol === 'http:' && local);
  } catch {
    return false;
  }
}

export const AUTH_001 = defineRule(
  {
    id: 'AUTH-001', title: 'Token in the server URL query', severity: { claude: 'error', chatgpt: 'error', spec: 'error' }, needs: ['http'],
    rationale: 'Credentials in URLs leak into logs and are not supported by either directory.',
    fix: 'Use OAuth; never put credentials in the server URL.',
    sources: [CLAUDE_AUTH],
  },
  (snap) => {
    if (snap.target.kind !== 'http') return [];
    const names = [...snap.target.url.searchParams.keys()].filter((k) => isSecretQueryParam(k));
    return names.length ? [{ message: `URL query contains credential parameter(s): ${names.map((n) => `${n}=«redacted»`).join(', ')}` }] : [];
  },
);

export { displayUrl, isSecretQueryParam } from './util/net.js';

export const AUTH_002 = defineRule(
  {
    id: 'AUTH-002', title: '401 challenge format', severity: { claude: 'error', chatgpt: 'error', spec: 'warning' }, needs: ['auth'],
    rationale: 'Clients start OAuth discovery from the WWW-Authenticate Bearer challenge and its resource_metadata.',
    fix: 'Return `WWW-Authenticate: Bearer resource_metadata="https://.../.well-known/oauth-protected-resource"` with every 401.',
    sources: [CLAUDE_AUTH, 'https://datatracker.ietf.org/doc/html/rfc9728#section-5.1'],
  },
  (snap) => {
    const a = snap.authProbe!;
    const ch = a.challenge;
    const parsed = ch?.parsed ?? [];
    const bearer = parsed.find((c) => c.scheme === 'bearer' || c.scheme === 'dpop');
    const out: RawFinding[] = [];
    // The spec needs only one discovery mechanism: with a well-known PRM the header pointer is a Claude
    // reliability concern (Claude treats the header as the reliable path), not a spec or ChatGPT defect.
    // With only legacy (2025-03-26) discovery, Claude still connects: a deprecation warning there.
    const missing = (message: string): RawFinding[] => {
      if (a.prm) return [{ platforms: ['claude'], severity: 'warning', message: `${message} (a well-known PRM still resolves)` }];
      if (a.legacyDiscovery) {
        return [
          { platforms: ['chatgpt', 'spec'], message },
          { platforms: ['claude'], severity: 'warning', message: `${message}; Claude falls back to legacy origin discovery, which is deprecated` },
        ];
      }
      return [{ message }];
    };
    if (!ch?.raw) out.push(...missing(`${ch?.status ?? 401} has no WWW-Authenticate header`));
    else if (!bearer) {
      const other = parsed.find((c) => c.scheme === 'basic' || c.scheme === 'apikey');
      if (other) {
        out.push({ platforms: ['chatgpt'], severity: 'error', message: `challenge scheme is ${other.scheme}, not Bearer` });
        out.push({ platforms: ['claude'], severity: 'warning', message: `challenge scheme is ${other.scheme}, not Bearer` });
      } else out.push(...missing(`challenge has no Bearer scheme: ${ch.raw.slice(0, 120)}`));
    } else if (!bearer.params.resource_metadata) out.push(...missing('Bearer challenge has no resource_metadata parameter'));
    else if (!httpsOrLocal(snap, bearer.params.resource_metadata)) out.push({ severity: 'error', message: `resource_metadata ${bearer.params.resource_metadata} is not an absolute https URL` });
    return out;
  },
);

export const AUTH_003 = defineRule(
  {
    id: 'AUTH-003', title: 'Wrong status for an unauthenticated request', severity: { claude: 'error', chatgpt: 'error', spec: 'warning' }, needs: ['http'],
    rationale: 'Only a 401 starts the sign-in flow.',
    fix: 'Return 401 with a Bearer challenge for missing or invalid tokens; 403 insufficient_scope (with scope=) only for valid tokens lacking scope.',
    sources: [CLAUDE_AUTH, 'https://claude.com/docs/connectors/building/lazy-authentication', 'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#runtime-insufficient-scope-errors'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const hosts: Platform[] = ['claude', 'chatgpt'];
    const pf = snap.transport.preflight;
    if (pf?.status === 200 && pf.headers?.['www-authenticate']) out.push({ platforms: hosts, message: '200 response carries WWW-Authenticate; Claude ignores the header on a 200' });
    if (pf?.status === 403) out.push({ platforms: hosts, severity: 'warning', message: 'unauthenticated initialize got 403; only a 401 starts sign-in (a WAF block can look the same, see SRV-009)' });
    for (const e of snap.transport.exchanges) {
      if (e.status !== 403 || !e.label.startsWith('sdk ')) continue;
      const ch = parseWwwAuthenticate(e.headers?.['www-authenticate']).find((c) => c.scheme === 'bearer');
      if (ch?.params.error !== 'insufficient_scope') out.push({ platforms: ['claude'], severity: 'info', message: `${e.label}: 403 without error="insufficient_scope"` });
      else if (!ch.params.scope) {
        // Claude recovers (challenge scope, then PRM and AS scopes_supported); the spec says SHOULD include scope.
        out.push({ platforms: ['spec'], severity: 'warning', message: `${e.label}: insufficient_scope challenge without scope=` });
        out.push({ platforms: ['claude'], severity: 'info', message: `${e.label}: insufficient_scope challenge without scope=; Claude falls back to its discovery-time scope selection` });
      }
      break;
    }
    return out;
  },
);

export const AUTH_004 = defineRule(
  {
    id: 'AUTH-004', title: 'Protected Resource Metadata discoverable', severity: { claude: 'error', chatgpt: 'error', spec: 'error' }, needs: ['auth'],
    rationale: 'Clients locate the authorization server through RFC 9728 metadata.',
    fix: 'Serve /.well-known/oauth-protected-resource{path} as application/json and reference it from the 401.',
    sources: [AS_DISCOVERY],
  },
  (snap) => {
    const a = snap.authProbe!;
    if (!a.prm) {
      const message = `no Protected Resource Metadata found (tried ${describeAttempts(a.prmAttempts) || 'nothing'})`;
      // A candidate that kept timing out or answering 5xx/429 may still hold the metadata: not a verdict.
      if (endedTransient(a.prmAttempts)) return [{ severity: 'info', message: `${INCONCLUSIVE}: ${message}` }];
      if (!a.legacyDiscovery) return [{ message }];
      return [
        { platforms: ['chatgpt', 'spec'], message },
        { platforms: ['claude'], severity: 'warning', message: `${message}; only legacy (2025-03-26) discovery at ${a.as[0]?.discoveryUrl ?? 'the origin'} works, which is deprecated` },
      ];
    }
    const out: RawFinding[] = [];
    if (!/json/i.test(a.prm.contentType ?? '')) out.push({ severity: 'warning', message: `PRM served with Content-Type ${a.prm.contentType ?? '(none)'}` });
    if (a.prm.via === 'well-known-root' && snap.target.kind === 'http' && snap.target.url.pathname !== '/') {
      out.push({ platforms: ['claude'], severity: 'info', message: 'only the root PRM exists while the endpoint has a path; serve the path-aware form too' });
    }
    return out;
  },
);

/** The MCP SDK rule (checkResourceAllowed): same origin, and the resource path is a path-segment prefix. */
export function resourceCovers(resource: URL, server: URL): boolean {
  if (resource.origin !== server.origin || server.pathname.length < resource.pathname.length) return false;
  const withSlash = (p: string) => (p.endsWith('/') ? p : `${p}/`);
  return withSlash(server.pathname).startsWith(withSlash(resource.pathname));
}

function diffHint(a: string, b: string): string {
  if (a.replace(/\/$/, '') === b.replace(/\/$/, '')) return ' (differs only by trailing slash)';
  if (a.toLowerCase() === b.toLowerCase()) return ' (differs only by case)';
  return '';
}

export const AUTH_005 = defineRule(
  {
    id: 'AUTH-005', title: 'PRM `resource` matches the MCP URL', severity: { claude: 'error', spec: 'error', chatgpt: 'warning' }, needs: ['auth'],
    rationale: 'Clients verify that the metadata describes the URL they connect to.',
    fix: 'Set PRM `resource` to the MCP URL as users register it (same origin; the path must equal, or be a path prefix of, the MCP path).',
    sources: [CLAUDE_AUTH, 'https://datatracker.ietf.org/doc/html/rfc9728#section-3.3'],
  },
  (snap) => {
    const prm = snap.authProbe?.prm;
    if (!prm || snap.target.kind !== 'http') return [];
    const res = prm.json.resource;
    if (!isStr(res)) return [{ message: 'PRM `resource` is missing or not a string' }];
    let resUrl: URL;
    try { resUrl = new URL(res); } catch { return [{ message: `PRM resource ${JSON.stringify(res)} is not an absolute URL` }]; }
    // Compare WHATWG-normalized URLs: https://host and https://host/ are the same URL.
    const server = new URL(snap.target.url.href);
    server.hash = '';
    resUrl.hash = '';
    if (resUrl.href === server.href) return [];
    if (resourceCovers(resUrl, server)) {
      return [
        { platforms: ['claude'], severity: 'info', message: `PRM resource ${res} is a path prefix of ${displayUrl(server.href)}; accepted, but an exact match is safest` },
        { platforms: ['spec'], severity: 'warning', message: `PRM resource ${res} is not identical to ${displayUrl(server.href)} (RFC 9728 §3.3); MCP SDK clients accept it as a path prefix` },
      ];
    }
    return [{ message: `PRM resource ${res} does not match ${displayUrl(server.href)}${diffHint(resUrl.href, server.href)}` }];
  },
);

export const AUTH_006 = defineRule(
  {
    id: 'AUTH-006', title: 'PRM authorization_servers', severity: { claude: 'error', chatgpt: 'error', spec: 'error' }, needs: ['auth'],
    rationale: 'Clients need an https issuer to discover the authorization server.',
    fix: 'List exactly one https issuer (no query or fragment) in authorization_servers.',
    sources: [CLAUDE_AUTH, AS_DISCOVERY],
  },
  (snap) => {
    const prm = snap.authProbe?.prm;
    if (!prm) return [];
    const list = prm.json.authorization_servers;
    if (!Array.isArray(list) || list.length === 0) return [{ message: 'authorization_servers is missing, not an array, or empty' }];
    const out: RawFinding[] = [];
    const first = list[0];
    let bad = !isStr(first) || !httpsOrLocal(snap, first);
    if (!bad) { const u = new URL(first as string); bad = !!u.search || !!u.hash || (first as string).includes('#'); }
    if (bad) out.push({ message: `authorization_servers[0] ${JSON.stringify(first)} is not an https issuer without query or fragment` });
    if (list.length > 1) out.push({ platforms: ['claude'], severity: 'warning', message: `${list.length} authorization servers listed; only the first is used, no fallback` });
    return out;
  },
);

export const AUTH_007 = defineRule(
  {
    id: 'AUTH-007', title: 'Authorization server metadata discoverable', severity: { claude: 'error', chatgpt: 'error', spec: 'error' }, needs: ['auth'],
    rationale: 'Clients need RFC 8414 / OIDC metadata to find the endpoints.',
    fix: 'Serve /.well-known/oauth-authorization-server (or openid-configuration) for the issuer.',
    sources: [AS_DISCOVERY],
  },
  (snap) => (snap.authProbe?.as ?? []).slice(0, 3).flatMap((as, i): RawFinding[] => {
    if (as.json) return [];
    const message = `no authorization server metadata for ${as.issuer} (tried ${describeAttempts(as.attempts) || 'nothing'})`;
    const platforms: Platform[] | undefined = i === 0 ? undefined : ['chatgpt'];
    return [endedTransient(as.attempts) ? { platforms, severity: 'info', message: `${INCONCLUSIVE}: ${message}` } : { platforms, message }];
  }),
);

function sameOriginOnlyIssuer(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const bare = (u: URL, raw: string) => u.pathname === '/' && !u.search && !u.hash && /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\/?$/i.test(raw);
    return bare(ua, a) && bare(ub, b) && ua.href === ub.href;
  } catch {
    return false;
  }
}

export const AUTH_008 = defineRule(
  {
    id: 'AUTH-008', title: 'Issuer identical', severity: { claude: 'error', spec: 'error', chatgpt: 'warning' }, needs: ['auth'],
    rationale: 'RFC 8414 requires the metadata issuer to equal the issuer identifier exactly.',
    fix: 'Make metadata.issuer exactly equal to the authorization_servers entry.',
    sources: [AS_DISCOVERY, OAI_AUTH],
  },
  (snap) => forEachAs(snap, (as, m) => {
    if (m.issuer === as.issuer) return [];
    // Origin-only issuers that differ only by the root '/' parse to the same URL; strict string equality still fails
    // RFC 8414, so this is an observation. Issuers with a path keep strict equality.
    if (isStr(m.issuer) && sameOriginOnlyIssuer(m.issuer, as.issuer)) {
      return [{ severity: 'info', message: `metadata issuer ${JSON.stringify(m.issuer)} differs from ${as.issuer} only by the trailing '/'; most clients normalize this, RFC 8414 asks for identical strings` }];
    }
    return [{ message: `metadata issuer ${JSON.stringify(m.issuer)} !== ${as.issuer}` }];
  }),
);

export const AUTH_009 = defineRule(
  {
    id: 'AUTH-009', title: 'Required AS endpoints and response types', severity: { claude: 'error', chatgpt: 'error', spec: 'error' }, needs: ['auth'],
    rationale: 'The authorization-code flow needs both endpoints and the code response type.',
    fix: 'Publish authorization_endpoint, token_endpoint and response_types_supported: ["code"].',
    sources: ['https://datatracker.ietf.org/doc/html/rfc8414#section-2'],
  },
  (snap) => forEachAs(snap, (_as, m) => {
    const out: RawFinding[] = [];
    for (const k of ['authorization_endpoint', 'token_endpoint']) if (!isStr(m[k])) out.push({ message: `${k} is missing` });
    const rt = m.response_types_supported;
    if (rt === undefined) out.push({ severity: 'warning', message: 'response_types_supported is missing (RFC 8414 REQUIRED)' });
    else if (!Array.isArray(rt) || !rt.includes('code')) out.push({ message: 'response_types_supported does not include "code"' });
    return out;
  }),
);

const ENDPOINT_KEYS = ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint', 'introspection_endpoint', 'jwks_uri'];

export const AUTH_010 = defineRule(
  {
    id: 'AUTH-010', title: 'AS endpoints over HTTPS with trusted certificates', severity: { claude: 'error', chatgpt: 'error', spec: 'error' }, needs: ['auth'],
    rationale: 'OAuth endpoints must use TLS with publicly trusted certificates.',
    fix: 'Serve every OAuth endpoint over https with a valid public certificate.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations', 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy'],
  },
  (snap) => {
    const out = forEachAs(snap, (_as, m) => ENDPOINT_KEYS.filter((k) => isStr(m[k]) && !httpsOrLocal(snap, m[k] as string)).map((k) => ({ message: `${k} ${String(m[k])} is not https` })));
    // The MCP host's own certificate is SRV-001 (it runs without a 401).
    const mcpHost = snap.target.kind === 'http' ? snap.target.url.host : undefined;
    for (const t of snap.transport.tls ?? []) {
      if (t.ok || (t.role ? t.role !== 'as' : t.host === mcpHost)) continue;
      const tries = t.attempts && t.attempts.length > 1 ? ` (attempts: ${t.attempts.join(', ')})` : '';
      // A plain network error (ENOTFOUND, ECONNREFUSED) is no certificate verdict, as in SRV-001: name the cause (R-12).
      if (!t.transient && /^E[A-Z_]+$/.test(t.code ?? '') && !isTlsCode(t.code) && t.code !== 'EPROTO') {
        const d = describeCause(new URL(`https://${t.host}`), { code: t.code });
        out.push({ message: `${/^fetch failed/.test(d.summary) ? `${t.host} could not be reached (${t.code})` : d.summary}; TLS not checked${tries}`, fix: 'Publish public DNS records for every OAuth endpoint host and serve it over https.' });
        continue;
      }
      out.push(t.transient
        ? { severity: 'info', message: `${INCONCLUSIVE}: TLS handshake with ${t.host} did not complete: ${t.code ?? 'unknown error'}${tries}` }
        : { message: `TLS handshake with ${t.host} failed: ${t.code ?? 'unknown error'}${tries}` });
    }
    if (snap.env?.nodeExtraCaCerts) out.push({ severity: 'info', message: 'NODE_EXTRA_CA_CERTS is set; certificate checks may pass here but fail for hosts' });
    return out;
  },
);

export const AUTH_011 = defineRule(
  {
    id: 'AUTH-011', title: 'PKCE S256 advertised', severity: { claude: 'error', chatgpt: 'error', spec: 'error' }, needs: ['auth'],
    rationale: 'Clients refuse to proceed unless S256 PKCE is advertised.',
    fix: 'Advertise code_challenge_methods_supported: ["S256"].',
    sources: [CLAUDE_AUTH, OAI_AUTH],
  },
  (snap) => forEachAs(snap, (_as, m) => (Array.isArray(m.code_challenge_methods_supported) && m.code_challenge_methods_supported.includes('S256') ? [] : [{ message: 'code_challenge_methods_supported does not include S256' }])),
);

export const AUTH_012 = defineRule(
  {
    id: 'AUTH-012', title: 'Client registration path', severity: { claude: 'warning', chatgpt: 'warning', spec: 'warning' }, needs: ['auth'],
    rationale: 'Hosts register themselves via CIMD (preferred) or DCR, or use pre-registered credentials.',
    fix: 'Support Client ID Metadata Documents (client_id_metadata_document_supported: true with token auth "none") or DCR, or arrange pre-registered credentials with each host.',
    sources: [CLAUDE_AUTH, OAI_AUTH, 'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration'],
  },
  (snap) => forEachAs(snap, (_as, m) => {
    const out: RawFinding[] = [];
    const flag = m.client_id_metadata_document_supported;
    if (flag !== undefined && typeof flag !== 'boolean') out.push({ severity: 'error', message: 'client_id_metadata_document_supported is not a boolean' });
    const cimd = flag === true;
    const methods = m.token_endpoint_auth_methods_supported;
    const none = Array.isArray(methods) && methods.includes('none');
    const pkjwt = Array.isArray(methods) && methods.includes('private_key_jwt');
    const dcr = isStr(m.registration_endpoint);
    // Claude
    if (cimd && !none) out.push({ platforms: ['claude'], severity: 'warning', message: 'CIMD advertised without token auth method "none": CIMD ignored, falls back to DCR' });
    // Pre-registered (Anthropic-held) and connection-time credentials are supported paths the linter cannot see.
    if (!(cimd && none) && !dcr) out.push({ platforms: ['claude'], severity: 'warning', message: 'neither CIMD nor DCR: Claude requires Anthropic-held credentials (contact mcp-review@anthropic.com) or connection-time credentials; the linter cannot see whether pre-registration is in place' });
    // ChatGPT
    if (cimd && methods === undefined) out.push({ platforms: ['chatgpt'], message: 'CIMD advertised but token_endpoint_auth_methods_supported is absent (RFC 8414 default client_secret_basic)' });
    else if (cimd && !none && !pkjwt) out.push({ platforms: ['chatgpt'], message: 'CIMD advertised without "none" or "private_key_jwt"' });
    if (!cimd && !dcr) out.push({ platforms: ['chatgpt'], message: 'neither CIMD nor DCR: predefined client required; secret goes in the portal, not the manifest' });
    // Spec
    if (!cimd && !dcr) out.push({ platforms: ['spec'], message: 'neither CIMD nor DCR supported' });
    else if (!cimd && dcr) out.push({ platforms: ['spec'], severity: 'info', message: 'DCR only: DCR deprecated in 2026-07-28; add CIMD' });
    return out;
  }),
);

export const AUTH_013 = defineRule(
  {
    id: 'AUTH-013', title: 'Authorization-code grant supported', severity: { chatgpt: 'error', claude: 'warning' }, needs: ['auth'],
    rationale: 'Hosts sign users in with the authorization-code grant.',
    fix: 'Support grant_types_supported: ["authorization_code", "refresh_token"].',
    sources: [OAI_AUTH, CLAUDE_AUTH],
  },
  (snap) => {
    const a = snap.authProbe!;
    const out = forEachAs(snap, (_as, m) => (Array.isArray(m.grant_types_supported) && !m.grant_types_supported.includes('authorization_code')
      ? [{ message: `grant_types_supported (${m.grant_types_supported.join(', ')}) lacks authorization_code` }] : []));
    const bearer = (a.challenge?.parsed ?? []).some((c) => c.scheme === 'bearer' || c.scheme === 'dpop');
    if (!a.prm && !a.legacyDiscovery && !bearer) {
      out.push({ platforms: ['chatgpt'], severity: 'error', message: 'server rejects unauthenticated requests without OAuth discovery: API-key or custom-header auth is unsupported' });
      out.push({ platforms: ['claude'], severity: 'info', message: 'no OAuth discovery: static headers are beta; directory expects OAuth' });
    }
    return out;
  },
);

export const AUTH_014 = defineRule(
  {
    id: 'AUTH-014', title: 'RFC 9207 iss parameter', severity: { chatgpt: 'info', spec: 'info' }, needs: ['auth'],
    rationale: 'The iss parameter protects against mix-up attacks.',
    fix: 'Return iss in authorization responses and advertise authorization_response_iss_parameter_supported: true.',
    sources: [OAI_AUTH, 'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#authorization-response-validation'],
  },
  (snap) => forEachAs(snap, (_as, m) => {
    const v = m.authorization_response_iss_parameter_supported;
    if (v === true) return [];
    if (v !== undefined && typeof v !== 'boolean') return [{ platforms: ['spec'], severity: 'error', message: 'authorization_response_iss_parameter_supported is not a boolean' }];
    return [
      { platforms: ['chatgpt'], message: 'iss parameter not supported: ChatGPT uses the callback-specific redirect instead of the stable one' },
      { platforms: ['spec'], message: 'authorization_response_iss_parameter_supported is not true' },
    ];
  }),
);

export const AUTH_015 = defineRule(
  {
    id: 'AUTH-015', title: 'Scope guidance', severity: { claude: 'info', spec: 'warning', chatgpt: 'info' }, needs: ['auth'],
    rationale: 'Clients request the challenge scope, or every scope in PRM scopes_supported.',
    fix: 'Advertise a small, least-privilege scope set; include scope= in the 401 challenge.',
    sources: [CLAUDE_AUTH, 'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#refresh-tokens'],
  },
  (snap) => {
    const a = snap.authProbe!;
    const out: RawFinding[] = [];
    const bearer = a.challenge?.parsed.find((c) => c.scheme === 'bearer');
    const challengeScope = bearer?.params.scope?.split(/\s+/).filter(Boolean) ?? [];
    const prmScopes = isStrArray(a.prm?.json.scopes_supported) ? (a.prm!.json.scopes_supported as string[]) : [];
    const asMeta = a.as[0]?.json ?? {};
    const asScopes = isStrArray(asMeta.scopes_supported) ? asMeta.scopes_supported : [];
    if (!bearer?.params.scope) {
      const requested = [...prmScopes, ...(asScopes.includes('offline_access') && !prmScopes.includes('offline_access') ? ['offline_access'] : [])];
      out.push({ platforms: ['claude'], message: `401 has no scope=; Claude will request: ${requested.length ? requested.join(' ') : '(no scope)'}` });
      if (requested.length > 10 || requested.some((s) => /admin|write:all|\*|full_access/i.test(s))) out.push({ platforms: ['claude'], severity: 'warning', message: `requested scope set is broad (${requested.length} scopes)` });
    }
    if (challengeScope.includes('offline_access') || prmScopes.includes('offline_access')) out.push({ platforms: ['spec'], message: 'offline_access is advertised as a resource scope' });
    const oidc = asScopes.filter((s) => ['openid', 'email', 'profile'].includes(s));
    if (oidc.length) out.push({ platforms: ['chatgpt'], severity: 'info', message: `AS lists ${oidc.join(', ')}: requested by default; enable for the client` });
    return out;
  },
);

export const AUTH_016 = defineRule(
  {
    id: 'AUTH-016', title: 'Invalid token gets 401', severity: { spec: 'error', chatgpt: 'warning' }, needs: ['auth'],
    rationale: 'Invalid or expired tokens must trigger re-authentication via 401.',
    fix: 'Return 401 with the Bearer challenge for invalid tokens.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#token-handling'],
  },
  (snap) => {
    const ex = snap.authProbe?.invalidToken;
    if (!ex?.status) return [];
    if (isTransient(ex)) return [{ severity: 'info', message: `${INCONCLUSIVE}: invalid bearer token got ${ex.status} after retries` }];
    if (ex.status !== 401) return [{ message: `invalid bearer token got ${ex.status}, expected 401` }];
    const ch = parseWwwAuthenticate(ex.headers?.['www-authenticate']).find((c) => c.scheme === 'bearer');
    return ch?.params.resource_metadata ? [] : [{ severity: 'warning', message: '401 for an invalid token lacks a WWW-Authenticate resource_metadata' }];
  },
);

export const AUTH_017 = defineRule(
  {
    id: 'AUTH-017', title: 'OAuth endpoint latency', severity: { claude: 'error' }, needs: ['auth'],
    rationale: 'Claude times out slow OAuth discovery and token calls.',
    fix: 'Keep metadata and token endpoints fast (well under 3 s).',
    sources: [CLAUDE_AUTH],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const [k, xs] of Object.entries(snap.authProbe?.timings ?? {})) {
      if (!xs.length) continue;
      const max = Math.max(...xs);
      if (max > AUTH_LATENCY.errorMs) out.push({ message: `${k} took ${Math.round(max)} ms (> ${AUTH_LATENCY.errorMs} ms)` });
      else if (max > AUTH_LATENCY.warningMs) out.push({ severity: 'warning', message: `${k} took ${Math.round(max)} ms (> ${AUTH_LATENCY.warningMs} ms)` });
    }
    return out;
  },
);

export const AUTH_018 = defineRule(
  {
    id: 'AUTH-018', title: 'Microsoft Entra ID notes', severity: { claude: 'info' }, needs: ['auth'],
    rationale: 'Entra ID needs the MCP URL registered as an Application ID URI.',
    fix: 'Register the MCP URL as an Application ID URI and serve MCP from your own domain.',
    sources: [CLAUDE_AUTH],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const issuer = snap.authProbe?.as[0]?.issuer;
    try {
      const h = issuer ? new URL(issuer).hostname : '';
      if (h === 'login.microsoftonline.com' || h === 'sts.windows.net') out.push({ message: 'Entra ID issuer: register the MCP URL as an Application ID URI' });
    } catch { /* ignore */ }
    if (snap.target.kind === 'http' && snap.target.url.hostname.endsWith('.azurewebsites.net')) out.push({ severity: 'warning', message: 'MCP host is on azurewebsites.net; use your own domain for the Application ID URI' });
    return out;
  },
);

export const AUTH_019 = defineRule(
  {
    id: 'AUTH-019', title: 'DCR accepts JSON registration', severity: { claude: 'warning' }, needs: ['active-auth'],
    rationale: 'Claude registers via a JSON DCR request with its callback URLs.',
    fix: 'Accept application/json registrations with the Claude redirect URIs and token auth "none".',
    sources: [CLAUDE_AUTH],
  },
  (snap) => {
    const ex = snap.authProbe?.active?.dcr;
    if (!ex) return [];
    const out: RawFinding[] = [];
    const body = ex.bodySnippet ?? '';
    if (ex.status === 415 || (ex.status !== undefined && (ex.status < 200 || ex.status >= 300) && /invalid_redirect_uri/.test(body))) {
      out.push({ severity: 'error', message: `registration rejected (${ex.status}): ${body.slice(0, 120)}` });
    } else if (ex.status === undefined || ex.status >= 300) out.push({ message: `registration returned ${ex.status ?? ex.error?.message}` });
    if (ex.durationMs > 10000) out.push({ message: `registration took ${Math.round(ex.durationMs)} ms` });
    return out;
  },
);

export const AUTH_020 = defineRule(
  {
    id: 'AUTH-020', title: 'Redirect URIs accepted at /authorize', severity: { claude: 'error' }, needs: ['active-auth'],
    rationale: 'Claude uses fixed web and loopback callback URLs.',
    fix: 'Allow https://claude.ai/api/mcp/auth_callback and port-agnostic loopback callbacks.',
    sources: [CLAUDE_AUTH],
  },
  (snap) => (snap.authProbe?.active?.authorize ?? []).flatMap((ex): RawFinding[] => {
    const redirect = new URL(ex.url).searchParams.get('redirect_uri');
    const body = ex.bodySnippet ?? '';
    if (ex.status === 400 || /redirect_uri/i.test(body)) return [{ message: `/authorize rejected redirect_uri ${redirect} (${ex.status})` }];
    if (ex.status === 200 && /<form|login|sign in/i.test(body)) return [{ severity: 'info', message: `/authorize shows a login page before validating ${redirect}; verify manually` }];
    return [];
  }),
);

export const AUTH_021 = defineRule(
  {
    id: 'AUTH-021', title: 'Token endpoint form-encoding and error codes', severity: { claude: 'error' }, needs: ['active-auth'],
    rationale: 'Token requests are form-encoded and errors must be RFC 6749 JSON.',
    fix: 'Parse application/x-www-form-urlencoded and answer bad grants with 400 {"error":"invalid_grant"}.',
    sources: [CLAUDE_AUTH],
  },
  (snap) => {
    const [code, refresh] = snap.authProbe?.active?.token ?? [];
    const out: RawFinding[] = [];
    if (code) {
      if (code.status === 415 || /unsupported.*(content|media)|could not parse|missing.*grant_type/i.test(code.bodySnippet ?? '')) out.push({ message: `token endpoint did not parse a form-encoded body (${code.status})` });
      else if (code.json === undefined) out.push({ severity: 'warning', message: `token error body is not JSON (${code.status})` });
    }
    if (refresh) {
      const err = isObj(refresh.json) ? refresh.json.error : undefined;
      if (!(refresh.status === 400 && err === 'invalid_grant')) out.push({ severity: 'warning', message: `bogus refresh_token got ${refresh.status} ${JSON.stringify(err)}; expected 400 invalid_grant` });
    }
    return out;
  },
);

export const authRules = [
  AUTH_001, AUTH_002, AUTH_003, AUTH_004, AUTH_005, AUTH_006, AUTH_007, AUTH_008, AUTH_009, AUTH_010,
  AUTH_011, AUTH_012, AUTH_013, AUTH_014, AUTH_015, AUTH_016, AUTH_017, AUTH_018, AUTH_019, AUTH_020, AUTH_021,
];
