// Network helpers (§1.5). Not a full Public Suffix List; only info/warning rules depend on it.
import { isIP } from 'node:net';

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

const SECRET_PARAM = /^(token|access_token|api_?key|apikey|key|secret|auth|password|bearer)$/i;

export function isSecretQueryParam(name: string): boolean {
  return SECRET_PARAM.test(name);
}

export const REDACTED_MARK = '«redacted»';

/** The URL for display in reports: secret query values redacted, userinfo (user:pass@) removed. */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    let changed = false;
    if (u.username || u.password) { u.username = ''; u.password = ''; changed = true; }
    const marker = 'MCPREVIEWCHECKREDACTED';
    for (const k of [...u.searchParams.keys()]) if (isSecretQueryParam(k)) { u.searchParams.set(k, marker); changed = true; }
    return changed ? u.href.split(marker).join(REDACTED_MARK) : raw;
  } catch {
    return raw;
  }
}
