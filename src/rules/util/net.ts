// Network helpers (§1.5). Not a full Public Suffix List; only info/warning rules depend on it.
import { isIP } from 'node:net';
import type { DnsResult } from '../../snapshot.js';

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export function isNonPublicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const n = v4ToInt(ip);
  return V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

export function isNonPublicIPv6(ip: string): boolean {
  if (isIP(ip) !== 6) return false;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isNonPublicIPv4(mapped[1]);
  if (lower === '::1' || lower === '::') return true;
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

export function isNonPublicIp(ip: string): boolean {
  return isNonPublicIPv4(ip) || isNonPublicIPv6(ip);
}

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isIP(h) === 4) return h.startsWith('127.');
  if (isIP(h) === 6) return h === '::1';
  return false;
}

/** Local mode for a host without a dot, or one whose every address (DNS and the system resolver) is non-public. */
export function isLocalTarget(d: DnsResult): boolean {
  const addrs = [...d.a, ...d.aaaa, ...(d.lookup ?? [])];
  return (!d.host.includes('.') && !isIP(d.host)) || (addrs.length > 0 && addrs.every(isNonPublicIp));
}

const MULTI_LABEL = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'com.br', 'co.nz', 'co.in', 'co.za', 'com.mx', 'com.cn', 'com.tr', 'co.kr', 'com.sg'];

export const SHARED_HOST_SUFFIXES = [
  'vercel.app', 'netlify.app', 'workers.dev', 'pages.dev', 'herokuapp.com', 'onrender.com', 'fly.dev',
  'azurewebsites.net', 'run.app', 'github.io', 'railway.app', 'replit.app', 'ngrok.app', 'ngrok-free.app',
  'ngrok.io', 'trycloudflare.com', 'loca.lt', 'devtunnels.ms',
];

export const TUNNEL_SUFFIXES = ['ngrok.io', 'ngrok.app', 'ngrok-free.app', 'trycloudflare.com', 'loca.lt', 'localtunnel.me', 'serveo.net', 'devtunnels.ms'];
export const SHARED_PLATFORM_SUFFIXES = ['vercel.app', 'netlify.app', 'workers.dev', 'herokuapp.com', 'onrender.com', 'fly.dev', 'azurewebsites.net', 'run.app'];

export function hostUnder(host: string, suffix: string): boolean {
  const h = host.toLowerCase();
  return h === suffix || h.endsWith('.' + suffix);
}

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (isIP(h)) return h;
  const labels = h.split('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL.includes(lastTwo) || SHARED_HOST_SUFFIXES.includes(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/** AUTH-001: query parameter names that put a credential in the server URL; the redaction's list, so one source. */
export function isSecretQueryParam(name: string): boolean {
  return isSecretName(name);
}

/** A secret sign in any kebab, snake, dotted or camelCase segment of a name (--auth-header, client_secret, accessToken). */
const SECRET_SIGN = /(^|[-_.])(api[-_]?key|apikey|key|token|secret|password|passwd|pwd|pass|auth|authorization|bearer|credentials?|cookie|session|private[-_]?key|signature|dsn)([-_.]|$)/i;
/** The same sign glued to what precedes it (authtoken, apitoken, secretkey, GITHUBTOKEN): fail-closed, NOT_SECRET still applies. */
const SECRET_TAIL = /(token|secret|passw(or)?d|credentials?|(api|auth|secret|private|access|client)key)([-_.]|$)/i;
/** Names that point to or describe a secret rather than hold it: --token-file, --key-id, --auth-url, TOKEN_LIMIT. */
const NOT_SECRET = /[-_.](file|path|dir|directory|id|name|url|uri|endpoint|type|mode|format|max|min|limit|count|size|length|timeout|ttl|expiry|expires)$/i;

/** Whether the value of a flag, KEY= or query parameter with this name is a credential (redaction, fail-closed). */
export function isSecretName(name: string): boolean {
  const n = name.replace(/^-+/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  return (SECRET_SIGN.test(n) || SECRET_TAIL.test(n)) && !NOT_SECRET.test(n);
}

/** A whole value in a known token format (OpenAI, Stripe, GitHub, GitLab, Slack, AWS, Google, npm, Hugging Face keys, a JWT); no entropy guess. */
const KNOWN_TOKEN = /^(sk-(live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{16,}|[sr]k_(live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprse]-[A-Za-z0-9-]{10,}|(AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})$/;

/** Whether a value is a credential by its form alone (a positional argument, a path segment, a query value under any name). */
export function isKnownToken(value: string): boolean {
  return KNOWN_TOKEN.test(value);
}

export const REDACTED_MARK = '«redacted»';

/** The URL for display in reports: userinfo (user:pass@) removed; secret query and fragment values and known-format tokens redacted. */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    let changed = false;
    if (u.username || u.password) { u.username = ''; u.password = ''; changed = true; }
    const marker = 'MCPREVIEWCHECKREDACTED';
    for (const [k, v] of [...u.searchParams]) if (isSecretName(k) || isKnownToken(v)) { u.searchParams.set(k, marker); changed = true; }
    const path = u.pathname.replace(/[^/]+/g, (s) => (isKnownToken(s) ? marker : s));
    const hash = u.hash.slice(1).replace(/(^|&)([^&=]+)=([^&]*)/g, (m, sep, k, v) => (isSecretName(k) || isKnownToken(v) ? `${sep}${k}=${marker}` : m));
    if (path !== u.pathname) { u.pathname = path; changed = true; }
    if (hash !== u.hash.slice(1)) { u.hash = hash; changed = true; }
    // A mark the report redaction already put into the path or query comes back percent-encoded: keep it readable.
    return changed ? u.href.split(marker).join(REDACTED_MARK).split(encodeURIComponent(REDACTED_MARK)).join(REDACTED_MARK) : raw;
  } catch {
    return raw;
  }
}
