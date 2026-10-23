// SRV: endpoint and deployment (§2.1).
import type { HttpExchange, Snapshot } from '../snapshot.js';
import { defineRule, type RawFinding } from './types.js';
import { isObj, isNonEmptyStr, isStr, toolName } from './util/access.js';
import { corpus } from './util/text.js';
import { displayUrl, hostUnder, isNonPublicIp, SHARED_PLATFORM_SUFFIXES, TUNNEL_SUFFIXES } from './util/net.js';
import { allExchanges, INCONCLUSIVE, probeExchange } from './util/obs.js';
import { TEXT_CAP } from '../limits.js';

const DEPLOY = 'Deploy-time check: ';
const SUBMISSION = 'https://claude.com/docs/connectors/building/submission';
const OAI_MCP = 'https://developers.openai.com/plugins/build/mcp-server';
const OAI_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';

function localize(snap: Snapshot, f: RawFinding): RawFinding {
  return snap.localMode ? { ...f, severity: 'info', message: DEPLOY + f.message } : f;
}

export const SRV_001 = defineRule(
  {
    id: 'SRV-001', title: 'Remote server served over HTTPS', severity: { claude: 'error', chatgpt: 'error' }, needs: ['http'],
    rationale: 'Both directories accept only https:// URLs, and hosts reject certificates that are not publicly trusted.',
    fix: 'Deploy behind TLS with a publicly trusted certificate.',
    sources: [SUBMISSION, OAI_MCP],
  },
  (snap) => {
    if (snap.target.kind !== 'http') return [];
    let proto: string;
    try { proto = new URL(snap.target.urlAsEntered).protocol; } catch { proto = snap.target.url.protocol; }
    if (proto !== 'https:') return [localize(snap, { message: `URL uses ${proto.replace(':', '')}, not https` })];
    // The MCP host's certificate (checked even when the server does not ask for auth).
    const host = snap.target.url.host;
    const t = (snap.transport.tls ?? []).find((x) => (x.role ? x.role === 'mcp' : x.host === host));
    // A plain network error (ENOTFOUND, ECONNREFUSED, ...) is not a certificate verdict: SRV-003/SRV-004 report it.
    if (!t || t.ok || (/^E[A-Z_]+$/.test(t.code ?? '') && t.code !== 'EPROTO' && !t.transient)) return [];
    const tries = t.attempts && t.attempts.length > 1 ? ` (attempts: ${t.attempts.join(', ')})` : '';
    if (t.transient) return [{ severity: 'info', message: `${INCONCLUSIVE}: TLS handshake with ${t.host} did not complete: ${t.code ?? 'unknown error'}${tries}` }];
    return [localize(snap, { message: `TLS handshake with ${t.host} failed: ${t.code ?? 'unknown error'}${tries}; hosts reject this certificate` })];
  },
);

export const SRV_002 = defineRule(
  {
    id: 'SRV-002', title: 'Local stdio server cannot be submitted as a remote connector', severity: { claude: 'info', chatgpt: 'info' }, needs: ['stdio'],
    rationale: 'Local servers go through a different distribution channel.',
    fix: 'Deploy remotely, or package the server as a Claude plugin.',
    sources: [SUBMISSION],
  },
  () => [
    { platforms: ['claude'], message: 'Directory no longer accepts local MCPB servers; distribute via a plugin.' },
    { platforms: ['chatgpt'], message: 'Requires a public HTTPS Streamable HTTP endpoint.' },
  ],
);

export const SRV_003 = defineRule(
  {
    id: 'SRV-003', title: 'Streamable HTTP transport available', severity: { claude: 'warning', chatgpt: 'warning', spec: 'warning' }, needs: [],
    rationale: 'SSE has been deprecated since 2025-03-26; both directories expect Streamable HTTP.',
    fix: 'Serve Streamable HTTP at the registered URL.',
    sources: ['https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy', 'https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http'],
  },
  (snap) => {
    if (snap.fatal && snap.target.kind === 'stdio') {
      // A local launch failure is not a directory transport defect: spec only, with stdio-specific advice.
      return [{ platforms: ['spec'], severity: 'error', message: `stdio server did not start: ${snap.fatal}`, fix: 'Check that the command starts and speaks MCP on stdin/stdout (the stderr cause is shown above; --verbose prints all of stderr).' }];
    }
    if (snap.fatal) {
      // Nothing could be checked: spec error only, so the directory verdicts read INCOMPLETE (as for stdio), not BLOCKED.
      const hint = snap.connectDiagnosis?.hint;
      return [{
        platforms: ['spec'], severity: 'error', message: `No working transport: ${snap.fatal}`,
        fix: hint ? `${hint[0].toUpperCase()}${hint.slice(1)}.` : 'Check the URL and that the server answers a Streamable HTTP POST initialize there (--verbose prints the HTTP trace).',
      }];
    }
    if (snap.transport.kind === 'sse') return [{ message: 'legacy HTTP+SSE only; Streamable HTTP POST was rejected' }];
    return [];
  },
);

export const SRV_004 = defineRule(
  {
    id: 'SRV-004', title: 'Hostname resolves to public IPv4', severity: { claude: 'error', chatgpt: 'error' }, needs: ['http'],
    rationale: 'Claude reaches connectors over IPv4 only. Private addresses are unreachable from both hosts.',
    fix: 'Publish public A records.',
    sources: ['https://claude.com/docs/connectors/building/troubleshooting'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const results = [snap.transport.dns, ...(snap.authProbe?.asDns ?? [])].filter((d) => d !== undefined);
    for (const d of results) {
      const note = ' (system resolver)';
      if (d.a.length === 0 && d.aaaa.length === 0 && d.error) {
        // NXDOMAIN or a failed lookup is not an IPv6-only host. When the MCP host itself does not resolve, the
        // connect failure (SRV-003) carries the verdict and this stays informational.
        const own = d === snap.transport.dns && !!snap.fatal;
        if (d.code === 'ENOTFOUND' || /ENOTFOUND|NXDOMAIN/.test(d.error)) out.push(localize(snap, { severity: own ? 'info' : undefined, message: `hostname ${d.host} does not resolve (NXDOMAIN)${note}` }));
        else if (d.code === 'ENODATA' || /ENODATA/.test(d.error)) out.push(localize(snap, { severity: own ? 'info' : undefined, message: `${d.host} has no A or AAAA records${note}` }));
        else out.push({ severity: 'info', message: `${INCONCLUSIVE}: DNS lookup for ${d.host} failed (${d.code ?? d.error})${note}` });
        continue;
      }
      if (d.a.length === 0) {
        out.push(localize(snap, { platforms: ['claude'], message: `${d.host} has no A record; Connectors are IPv4-only${note}` }));
        out.push(localize(snap, { platforms: ['chatgpt'], severity: 'info', message: `${d.host} has no A record${note}` }));
      }
      const priv = [...d.a, ...d.aaaa].filter(isNonPublicIp);
      if (priv.length) out.push(localize(snap, { message: `${d.host} resolves to non-public address ${priv.join(', ')}${note}` }));
    }
    return out;
  },
);

export const SRV_005 = defineRule(
  {
    id: 'SRV-005', title: 'Temporary tunnel or shared hosting domain', severity: { chatgpt: 'error', claude: 'warning' }, needs: ['http'],
    rationale: 'ChatGPT forbids tunnels for public submission. Claude expects the server domain to match the service domain.',
    fix: 'Serve the endpoint from your own domain.',
    sources: [OAI_MCP, 'https://claude.com/docs/connectors/building/review-criteria'],
  },
  (snap) => {
    if (snap.target.kind !== 'http') return [];
    const host = snap.target.url.hostname;
    const tunnel = TUNNEL_SUFFIXES.find((s) => hostUnder(host, s));
    if (tunnel) return [localize(snap, { message: `${host} is a temporary tunnel domain (${tunnel})` })];
    const shared = SHARED_PLATFORM_SUFFIXES.find((s) => hostUnder(host, s));
    if (shared) return [localize(snap, { platforms: ['claude'], severity: 'info', message: `${host} is on a shared platform domain (${shared}); MCP server domain should match your service` })];
    return [];
  },
);

const REDIRECTS = new Set([301, 302, 307, 308]);

export const SRV_006 = defineRule(
  {
    id: 'SRV-006', title: 'No cross-host redirect at the registered URL', severity: { claude: 'error' }, needs: ['http'],
    rationale: 'Claude drops the Authorization header on a cross-host redirect.',
    fix: 'Register the final URL, or serve MCP directly at the entered URL.',
    sources: ['https://claude.com/docs/connectors/building/troubleshooting'],
  },
  (snap) => {
    if (snap.target.kind !== 'http') return [];
    const url = snap.target.url;
    const out: RawFinding[] = [];
    const seen = new Set<string>();
    for (const ex of [snap.transport.preflight, probeExchange(snap, 'get')]) {
      if (!ex?.status || !REDIRECTS.has(ex.status)) continue;
      const loc = ex.headers?.location;
      if (!loc) continue;
      let target: URL;
      try { target = new URL(loc, url); } catch { continue; }
      const cross = target.host !== url.host;
      const msg = cross
        ? `${ex.method} redirects (${ex.status}) to another host: ${target.href}`
        : `${ex.method} redirects (${ex.status}) to ${target.href}; register the final URL`;
      if (seen.has(msg)) continue;
      seen.add(msg);
      out.push({ message: msg, severity: cross ? undefined : 'warning' });
    }
    return out;
  },
);

export const SRV_007 = defineRule(
  {
    id: 'SRV-007', title: 'Host-header (DNS-rebinding) protection rejects the public hostname', severity: { claude: 'error', chatgpt: 'error' }, needs: ['http'],
    rationale: "The SDK's createMcpExpressApp default allowedHosts permits only localhost, so every request from the host fails.",
    fix: 'Add the public hostname to allowedHosts.',
    sources: ['https://claude.com/docs/connectors/building/testing'],
  },
  (snap) => {
    const hit = allExchanges(snap).find((e) => e.status === 403 && /Invalid Host/i.test(e.bodySnippet ?? ''));
    return hit ? [{ message: `${hit.label} got 403 "Invalid Host"`, evidence: hit.bodySnippet?.slice(0, 120) }] : [];
  },
);

function is2xx(e: HttpExchange | undefined): boolean {
  return !!e?.status && e.status >= 200 && e.status < 300;
}

export const SRV_008 = defineRule(
  {
    id: 'SRV-008', title: 'Origin header handling', severity: { claude: 'warning', chatgpt: 'warning', spec: 'error' }, needs: ['http'],
    rationale: 'The spec requires a 403 for an invalid Origin, but hosts send their own Origin values.',
    fix: 'Validate Origin against an allowlist that includes the host origins.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const base = probeExchange(snap, 'originNone');
    const pairs: Array<['claude' | 'chatgpt', ReturnType<typeof probeExchange>, string]> = [
      ['claude', probeExchange(snap, 'originClaude'), 'https://claude.ai'],
      ['chatgpt', probeExchange(snap, 'originChatgpt'), 'https://chatgpt.com'],
    ];
    for (const [p, ex, origin] of pairs) {
      if (ex?.status === 403 && is2xx(base)) out.push({ platforms: [p], message: `overly strict Origin validation: Origin ${origin} gets 403` });
    }
    const evil = probeExchange(snap, 'originEvil');
    if (is2xx(evil)) {
      if (snap.localMode) out.push({ platforms: ['spec'], severity: 'error', message: 'loopback server accepts a foreign Origin (DNS rebinding risk)' });
      else out.push({ platforms: ['spec'], severity: 'info', message: 'server accepts any Origin (acceptable for a public server)' });
    }
    return out;
  },
);

export const SRV_009 = defineRule(
  {
    id: 'SRV-009', title: 'Bot challenge or WAF signature in responses', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['http'],
    rationale: 'Directory crawlers and hosts cannot pass bot challenges.',
    fix: "Allowlist host egress. Anthropic's egress range is 160.79.104.0/21.",
    sources: ['https://claude.com/docs/connectors/building/authentication'],
  },
  (snap) => {
    const ex = allExchanges(snap).filter((e) => e.status !== undefined);
    const out: RawFinding[] = [];
    const cf = ex.find((e) => (e.headers?.['cf-mitigated'] ?? '').toLowerCase() === 'challenge');
    if (cf) out.push({ message: `${cf.label}: cf-mitigated: challenge` });
    const jam = ex.find((e) => /Just a moment\.\.\./.test(e.bodySnippet ?? '') && /html/i.test(e.contentType ?? 'text/html'));
    if (jam) out.push({ message: `${jam.label}: "Just a moment..." bot challenge page` });
    const waf = ex.find((e) => (e.status === 403 || e.status === 429) && /cloudflare|akamai/i.test(e.headers?.server ?? '') && !/json/i.test(e.contentType ?? ''));
    if (waf) out.push({ message: `${waf.label}: ${waf.status} from ${waf.headers?.server} with a non-JSON body` });
    if (ex.length >= 2 && ex.every((e) => e.status === 403 && /text\/plain/i.test(e.contentType ?? '') && !e.headers?.['www-authenticate'])) {
      out.push({ message: 'every endpoint (including well-known) returns 403 text/plain without WWW-Authenticate' });
    }
    return out;
  },
);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const SRV_010 = defineRule(
  {
    id: 'SRV-010', title: 'Handshake and listing latency', severity: { chatgpt: 'info' }, needs: ['http'],
    rationale: 'OpenAI notes that components feel sluggish above a few hundred milliseconds.',
    fix: 'Cache metadata and keep list handlers cheap.',
    sources: ['https://developers.openai.com/plugins/deploy/troubleshooting'],
  },
  (snap) => {
    const keys = ['initialize', 'server/discover', 'tools/list', 'resources/read'];
    const samples = keys.flatMap((k) => (snap.transport.timings[k] ?? []).map((ms) => ({ k, ms })));
    if (!samples.length) return [];
    const out: RawFinding[] = [];
    const med = median(samples.map((s) => s.ms));
    if (med > 500) out.push({ message: `median handshake/listing latency ${Math.round(med)} ms (> 500 ms)` });
    const slow = samples.filter((s) => s.ms > 5000);
    if (slow.length) out.push({ severity: 'warning', message: `slow calls over 5 s: ${slow.map((s) => `${s.k} ${Math.round(s.ms)} ms`).join(', ')}` });
    return out;
  },
);

const SUFFIX_RE = /(\b|[\s_-])(mcp([\s_-]?server)?|plugin)\s*$/i;

export const SRV_011 = defineRule(
  {
    id: 'SRV-011', title: 'Server name ends with "MCP", "MCP Server" or "Plugin"', severity: { chatgpt: 'warning' }, needs: [],
    rationale: 'OpenAI guidelines ask for the bare product name.',
    fix: 'Use the bare product name.',
    sources: [OAI_GUIDE],
  },
  (snap) => {
    const si = snap.serverInfo ?? {};
    if (isStr(si.title) && SUFFIX_RE.test(si.title)) return [{ message: `serverInfo.title "${si.title}" ends with a generic suffix` }];
    if (isStr(si.name) && SUFFIX_RE.test(si.name)) return [{ severity: 'info', message: `serverInfo.name "${si.name}" ends with a generic suffix (fine for a package name; make sure the listing name does not)` }];
    return [];
  },
);

const GENERIC_NAMES = new Set(['search', 'travel', 'notes', 'chess', 'weather', 'calendar', 'tasks', 'assistant', 'helper', 'tools', 'files', 'docs', 'mail', 'chat']);

export const SRV_012 = defineRule(
  {
    id: 'SRV-012', title: 'Overly generic single-word name', severity: { chatgpt: 'info' }, needs: [],
    rationale: 'Generic names are hard to distinguish in the directory.',
    fix: 'Tie the name to your brand.',
    sources: [OAI_GUIDE],
  },
  (snap) => {
    const n = snap.serverInfo?.title ?? snap.serverInfo?.name;
    return isStr(n) && GENERIC_NAMES.has(n.trim().toLowerCase()) ? [{ message: `server name "${n}" is a generic single word` }] : [];
  },
);

/** serverInfo problems as "<field> <problem>" keys; an empty version string is a warning, a missing one an error. */
export function serverInfoProblems(si: unknown): Array<{ key: string; severity?: 'warning' }> {
  if (!isObj(si)) return [{ key: 'is not an object' }];
  const out: Array<{ key: string; severity?: 'warning' }> = [];
  if (!isNonEmptyStr(si.name)) out.push({ key: '.name is not a non-empty string' });
  if (si.version === '' || (isStr(si.version) && !si.version.trim())) out.push({ key: '.version is an empty string', severity: 'warning' });
  else if (!isStr(si.version)) out.push({ key: '.version is missing or not a string' });
  return out;
}

export const SRV_013 = defineRule(
  {
    id: 'SRV-013', title: 'serverInfo present with name and version', severity: { spec: 'error' }, needs: [],
    rationale: 'The lifecycle requires serverInfo with name and version.',
    fix: 'Return serverInfo { name, version } (legacy initialize) or the io.modelcontextprotocol/serverInfo _meta (server/discover).',
    sources: ['https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    // The same problem in initialize and server/discover is one finding naming both sources.
    const seen = new Map<string, { where: string[]; severity?: 'warning' }>();
    const check = (si: unknown, where: string) => {
      for (const p of serverInfoProblems(si)) {
        const prev = seen.get(p.key);
        if (prev) prev.where.push(where);
        else seen.set(p.key, { where: [where], severity: p.severity });
      }
    };
    if (isObj(snap.initializeRaw)) {
      if (snap.initializeRaw.serverInfo === undefined) out.push({ message: 'initialize result has no serverInfo' });
      else check(snap.initializeRaw.serverInfo, 'initialize');
    }
    if ((snap.era === 'modern' || snap.era === 'dual') && isObj(snap.discoverRaw)) {
      const meta = isObj(snap.discoverRaw._meta) ? snap.discoverRaw._meta : {};
      const si = meta['io.modelcontextprotocol/serverInfo'];
      if (si === undefined) out.push({ severity: 'warning', message: 'server/discover result has no _meta["io.modelcontextprotocol/serverInfo"]' });
      else check(si, 'server/discover');
    }
    for (const [key, v] of seen) {
      out.push({ severity: v.severity, message: `serverInfo${key} (${v.where.join(' and ')})${v.severity ? '; set the server version' : ''}` });
    }
    return out;
  },
);

export const SRV_014 = defineRule(
  {
    id: 'SRV-014', title: 'Server instructions quality', severity: { chatgpt: 'warning', spec: 'info' }, needs: [],
    rationale: 'Key guidance belongs in the first 512 characters; instructions should not duplicate tool descriptions.',
    fix: 'Keep instructions short and cross-tool; leave per-tool details in tool descriptions.',
    sources: [OAI_MCP],
  },
  (snap) => {
    const ins = snap.instructions;
    if (!isStr(ins)) return [];
    const out: RawFinding[] = [];
    if (ins === '') out.push({ platforms: ['spec'], message: 'instructions is an empty string; omit it instead' });
    if (ins.length > 512) out.push({ platforms: ['chatgpt'], severity: 'info', message: `instructions are ${ins.length >= TEXT_CAP ? `over ${TEXT_CAP}` : ins.length} characters; key guidance belongs in the first 512` });
    const dup = snap.tools.filter((t) => isStr(t.description) && t.description.length > 40 && ins.includes(t.description)).map(toolName);
    if (dup.length >= 3) {
      const msg = `instructions repeat ${dup.length} tool descriptions verbatim (${dup.slice(0, 3).join(', ')}${dup.length > 3 ? ', …' : ''})`;
      out.push({ platforms: ['chatgpt'], message: msg }, { platforms: ['spec'], message: msg });
    }
    return out;
  },
);

export const SRV_015 = defineRule(
  {
    id: 'SRV-015', title: 'Server depends on features Claude does not support', severity: { claude: 'info' }, needs: [],
    rationale: 'Claude does not support resource subscriptions, tasks, sampling or experimental capabilities.',
    fix: 'Make sure core functionality works without these features.',
    sources: ['https://claude.com/docs/connectors/building'],
  },
  (snap) => {
    const caps = snap.capabilities ?? {};
    const used: string[] = [];
    if (isObj(caps.resources) && caps.resources.subscribe === true) used.push('resources.subscribe');
    if (isObj(caps.experimental) && Object.keys(caps.experimental).length) used.push('experimental');
    if (caps.tasks !== undefined) used.push('tasks');
    if (corpus(snap).some((e) => /sampling\/createMessage|\bsampling\b/i.test(e.text))) used.push('sampling');
    return used.length ? [{ message: `uses ${used.join(', ')}` }] : [];
  },
);

export const SRV_016 = defineRule(
  {
    id: 'SRV-016', title: 'ChatGPT domain-verification file format', severity: { chatgpt: 'info' }, needs: ['http'],
    rationale: 'The verification file must contain only the token.',
    fix: 'Return only the exact token as text/plain.',
    sources: ['https://developers.openai.com/plugins/deploy/submission'],
  },
  (snap) => {
    const ex = probeExchange(snap, 'challenge');
    if (ex?.status !== 200) return [];
    const body = (ex.bodySnippet ?? '').trim();
    const problems: string[] = [];
    if (/json/i.test(ex.contentType ?? '')) problems.push('JSON Content-Type');
    if (/\n/.test(body)) problems.push('multiple lines');
    else if (/\s/.test(body)) problems.push('internal whitespace');
    return problems.length ? [{ message: `/.well-known/openai-apps-challenge has ${problems.join(', ')}` }] : [];
  },
);

export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  // URL lowercases scheme/host and drops default ports; a bare origin has no '/' path in canonical form.
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

export const SRV_017 = defineRule(
  {
    id: 'SRV-017', title: 'Canonical server URL form', severity: { spec: 'warning', claude: 'info' }, needs: ['http'],
    rationale: 'Resource indicators and token audiences use the canonical server URI.',
    fix: 'Register the canonical URL: lowercase scheme and host, no default port, no query, fragment or trailing slash.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri', 'https://claude.com/docs/connectors/building/troubleshooting'],
  },
  (snap) => {
    if (snap.target.kind !== 'http') return [];
    const raw = snap.target.urlAsEntered;
    const out: RawFinding[] = [];
    const m = /^([^:]+):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(raw);
    if (!m) return [];
    const [, scheme, authority, path, query, frag] = m;
    if (frag !== undefined) out.push({ platforms: ['spec'], severity: 'error', message: 'URL has a fragment' });
    const issues: string[] = [];
    if (scheme !== scheme.toLowerCase() || authority !== authority.toLowerCase()) issues.push('uppercase scheme or host');
    if (/:(443)$/.test(authority) && scheme.toLowerCase() === 'https') issues.push('explicit default port');
    if (/:(80)$/.test(authority) && scheme.toLowerCase() === 'http') issues.push('explicit default port');
    if (query !== undefined) issues.push('query component');
    if (path.length > 1 && path.endsWith('/')) issues.push('trailing slash');
    if (issues.length) out.push({ platforms: ['spec'], message: `URL is not canonical: ${issues.join(', ')}` });
    try {
      const canon = canonicalUrl(raw);
      // https://host and https://host/ are the same URL: a root '/' alone is not reported.
      const rawNoRoot = raw.replace(/^([^:]+:\/\/[^/?#]+)\/(?=[?#]|$)/, '$1');
      if (canon !== rawNoRoot) out.push({ platforms: ['claude'], message: `Entered URL differs from canonical ${displayUrl(canon)}. Tokens should accept the canonical \`aud\`; PRM \`resource\` and \`ui.domain\` hash use the URL exactly as entered.` });
    } catch { /* ignore */ }
    return out;
  },
);

export const SRV_018 = defineRule(
  {
    id: 'SRV-018', title: 'stdio server writes non-MCP output to stdout', severity: { spec: 'error' }, needs: ['stdio'],
    rationale: 'stdout is reserved for JSON-RPC messages.',
    fix: 'Log to stderr.',
    sources: ['https://modelcontextprotocol.io/specification/2025-11-25/basic/transports'],
  },
  (snap) => {
    const lines = snap.transport.stdio?.nonJsonStdout ?? [];
    if (!lines.length) return [];
    const shown = lines.slice(0, 3).map((l) => (l.length > 120 ? l.slice(0, 120) + '…' : l));
    return [{ message: `${lines.length} non-JSON line(s) on stdout: ${shown.map((l) => JSON.stringify(l)).join(', ')}` }];
  },
);

export const SRV_019 = defineRule(
  {
    id: 'SRV-019', title: 'tools/list stable across calls and connections', severity: { spec: 'warning' }, needs: ['tools'],
    rationale: 'Clients cache tool lists; unstable lists confuse hosts.',
    fix: 'Return a deterministic tool list.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities'],
  },
  (snap) => {
    const first = snap.tools.map(toolName);
    const setKey = (xs: string[]) => [...new Set(xs)].sort().join('\n');
    const out: RawFinding[] = [];
    if (snap.toolsRelist) {
      if (setKey(snap.toolsRelist) !== setKey(first)) out.push({ message: 'tools/list returned a different set on the same connection' });
      else if (snap.toolsRelist.join('\n') !== first.join('\n')) out.push({ severity: 'info', message: 'tools/list order differs between calls (deterministic order is recommended)' });
    }
    if (snap.toolsFreshConnection && setKey(snap.toolsFreshConnection) !== setKey(first)) {
      out.push({ message: 'tools/list returned a different set on a fresh connection' });
    }
    return out;
  },
);

export const SRV_020 = defineRule(
  {
    id: 'SRV-020', title: 'Protocol era report', severity: { spec: 'info' }, needs: ['http'],
    rationale: 'Reports which protocol revision the server speaks.',
    fix: 'No action needed.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle'],
  },
  (snap) => {
    if (snap.era === 'unknown') return [];
    let msg = `era: ${snap.era}${snap.protocolVersion ? ` (${snap.protocolVersion})` : ''}`;
    if (snap.era === 'legacy' || snap.era === 'sse-legacy') msg += '. 2026-07-28 clients fall back to initialize. Not a defect.';
    if (snap.era === 'dual' && isObj(snap.discoverRaw) && Array.isArray(snap.discoverRaw.supportedVersions) && snap.protocolVersion && !snap.discoverRaw.supportedVersions.includes(snap.protocolVersion)) {
      msg += `. Note: server/discover supportedVersions omits ${snap.protocolVersion}, which the server still accepts.`;
    }
    return [{ message: msg }];
  },
);

export const serverRules = [
  SRV_001, SRV_002, SRV_003, SRV_004, SRV_005, SRV_006, SRV_007, SRV_008, SRV_009, SRV_010,
  SRV_011, SRV_012, SRV_013, SRV_014, SRV_015, SRV_016, SRV_017, SRV_018, SRV_019, SRV_020,
];
