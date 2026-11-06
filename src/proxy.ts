// Corporate proxy support: HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and lowercase) for every request made with global fetch.
// Node's built-in fetch ignores these variables; undici's EnvHttpProxyAgent honours them, and is installed only when one is set.
import { createRequire } from 'node:module';
import { displayUrl } from './rules/util/net.js';

// undici is loaded only inside installProxy, when a proxy variable is set: explain and --list-rules reach this module
// through the rules (diagnose.ts) and should not pay for it. undici is a CommonJS package, so require gives the same module.
const loadUndici = (): typeof import('undici') => createRequire(import.meta.url)('undici') as typeof import('undici');

type Env = Record<string, string | undefined>;

/** Every proxy variable proxyConfig() routes through (each also read in lowercase). The redactor treats the credentials of each as secret, so the two lists cannot drift. */
export const PROXY_URL_VARS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY'] as const;

/** The proxy URL values of `env` under every name and case in PROXY_URL_VARS (schemeless values read as http://), for redaction. */
export function proxyEnvUrls(env: Env = process.env): string[] {
  const out: string[] = [];
  for (const name of PROXY_URL_VARS) {
    for (const k of [name, name.toLowerCase()]) {
      const v = env[k]?.trim();
      if (v) out.push(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`);
    }
  }
  return out;
}

/** The variable under either case; a value without a scheme ("proxy:3128") is read as http://, as curl does. */
const pick = (env: Env, upper: string): string | undefined => {
  const v = (env[upper] || env[upper.toLowerCase()] || '').trim();
  return !v ? undefined : /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || upper === 'NO_PROXY' ? v : `http://${v}`;
};

/** A proxy variable holds a scheme undici cannot use (socks4, socks4a, ftp, ...). The message names the variable; credentials are never shown. */
export class ProxyConfigError extends Error {}

/** Schemes undici's ProxyAgent speaks: http(s) proxies and SOCKS5 (socks5h is the same: the target host name is always sent to the proxy). */
const SUPPORTED = new Set(['http:', 'https:', 'socks5:', 'socks5h:', 'socks:']);
const normalize = (name: string, value: string | undefined): string | undefined => {
  if (!value) return value;
  let u: URL;
  try { u = new URL(value); } catch { throw new ProxyConfigError(`${name}: not a valid proxy URL (the value is not shown)`); }
  if (!SUPPORTED.has(u.protocol)) {
    throw new ProxyConfigError(`${name}: unsupported proxy scheme "${u.protocol.slice(0, -1)}://" (use http://, https://, socks5:// or socks5h://; SOCKS4 is not supported). (${displayUrl(value)})`);
  }
  return u.protocol === 'socks5h:' ? value.replace(/^socks5h:/i, 'socks5:') : value;
};

export interface ProxyConfig { httpProxy?: string; httpsProxy?: string; noProxy?: string }

/** The proxy variables of `env`, or undefined when none is set. ALL_PROXY is the fallback for HTTP_PROXY, and HTTPS_PROXY falls back to HTTP_PROXY, as undici's EnvHttpProxyAgent does, so diagnostics match what fetch really does. */
export function proxyConfig(env: Env = process.env): ProxyConfig | undefined {
  const all = pick(env, 'ALL_PROXY');
  const httpProxy = pick(env, 'HTTP_PROXY') ?? all;
  const httpsProxy = pick(env, 'HTTPS_PROXY') ?? httpProxy;
  if (!httpProxy && !httpsProxy) return undefined;
  return { httpProxy, httpsProxy, noProxy: pick(env, 'NO_PROXY') };
}

/**
 * True when `host:port` is excluded by a NO_PROXY list ("example.com", ".example.com", "*.example.com", "host:8080",
 * "[::1]"), decided exactly as undici's EnvHttpProxyAgent decides it, so diagnostics and the TLS check assume the route
 * fetch really takes: "*" bypasses only as the whole value (inside a list it matches nothing), an entry's port is the
 * digits after its last ":", and an IPv6 host is compared in brackets.
 */
export function bypassesProxy(host: string, port: number, noProxy: string | undefined): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  const h = bare.includes(':') ? `[${bare}]` : bare;
  const value = noProxy ?? '';
  const entries = value.split(/[,\s]/).filter(Boolean).map((e) => {
    const m = /^(.+):(\d+)$/.exec(e);
    return { hostname: (m ? m[1] : e).replace(/^\*?\./, '').toLowerCase(), port: m ? Number.parseInt(m[2], 10) : 0 };
  });
  if (!entries.length) return false;
  if (value === '*') return true;
  return entries.some((e) => (!e.port || e.port === port) && (h === e.hostname || h.slice(-(e.hostname.length + 1)) === `.${e.hostname}`));
}

/** The proxy URL used for `https://host:port`, or undefined when no proxy is set or NO_PROXY excludes the host. */
export function httpsProxyFor(host: string, port: number, env: Env = process.env): string | undefined {
  const c = proxyConfig(env);
  if (!c?.httpsProxy || bypassesProxy(host, port, c.noProxy)) return undefined;
  return c.httpsProxy;
}

const EXPERIMENTAL = /^(\[UNDICI-EHPA\]|SOCKS5 proxy support is experimental)/;
/** Drop exactly undici's ExperimentalWarning about its proxy agents; every other warning goes through unchanged. */
export function suppressProxyWarning(): void {
  if ((process.emitWarning as { proxyFilter?: boolean }).proxyFilter) return;
  const original = process.emitWarning.bind(process) as (...a: unknown[]) => void;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const first = rest[0] as unknown;
    const type = typeof first === 'string' ? first : (first as { type?: string } | undefined)?.type ?? (warning as Error | undefined)?.name;
    const message = typeof warning === 'string' ? warning : (warning as Error | undefined)?.message ?? '';
    if (type === 'ExperimentalWarning' && EXPERIMENTAL.test(message)) return;
    original(warning, ...rest);
  }) as typeof process.emitWarning;
  (process.emitWarning as { proxyFilter?: boolean }).proxyFilter = true;
}

/** Install the proxy-aware dispatcher for global fetch when a proxy variable is set; returns whether it did. */
export function installProxy(env: Env = process.env): boolean {
  const c = proxyConfig(env);
  if (!c) return false;
  const httpProxy = normalize(env.HTTP_PROXY || env.http_proxy ? 'HTTP_PROXY' : 'ALL_PROXY', c.httpProxy);
  const httpsProxy = normalize(env.HTTPS_PROXY || env.https_proxy ? 'HTTPS_PROXY' : env.HTTP_PROXY || env.http_proxy ? 'HTTP_PROXY' : 'ALL_PROXY', c.httpsProxy);
  suppressProxyWarning();
  const { EnvHttpProxyAgent, fetch: undiciFetch, setGlobalDispatcher } = loadUndici();
  // noProxy is always given ("" when unset) so undici never rereads the environment and decides as bypassesProxy does.
  // proxyTunnel: false makes undici send an http: target as an absolute-URI request (plain forwarding) only when the
  // proxy itself is http:; with an https: proxy an http: target is still tunnelled with CONNECT, and https: targets always
  // are. A SOCKS5 proxy forwards nothing: every target goes through its own SOCKS CONNECT (proxyTunnels below).
  const dispatcher = new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy: c.noProxy ?? '', proxyTunnel: false });
  setGlobalDispatcher(dispatcher);
  // The fetch built into newer Node releases (24+) bundles a newer undici than the dependency and ignores a dispatcher
  // installed from it, so global fetch is replaced by the dependency's own fetch, bound to the proxy-aware dispatcher.
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as typeof fetch;
  return true;
}

/** The proxy URL used for a request to `url`, or undefined when no proxy is set or NO_PROXY excludes the host. */
export function proxyForUrl(url: URL, env: Env = process.env): string | undefined {
  const c = proxyConfig(env);
  const proxy = url.protocol === 'https:' ? c?.httpsProxy : c?.httpProxy;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return proxy && !bypassesProxy(url.hostname, port, c?.noProxy) ? proxy : undefined;
}

/** A proxy URL for display: user:pass@ removed. */
export function proxyLabel(proxy: string): string {
  try { return displayUrl(proxy); } catch { return '[proxy]'; }
}

/** A SOCKS proxy URL (socks5:, socks5h:, socks:). */
export function isSocksProxy(proxy: string): boolean {
  return /^socks(5h?)?:/i.test(proxy.trim());
}

/** The proxy kind for messages: "SOCKS5 proxy", "HTTPS proxy" (TLS to the proxy) or "HTTP proxy". */
export function proxyKind(proxy: string): string {
  return isSocksProxy(proxy) ? 'SOCKS5 proxy' : /^https:/i.test(proxy.trim()) ? 'HTTPS proxy' : 'HTTP proxy';
}

/** The request to `url` goes through an HTTP CONNECT tunnel of `proxy`, as undici decides it with proxyTunnel: false:
 *  an https: target, or any target behind an https: proxy. Plain forwarding (an http: target behind an http: proxy)
 *  and SOCKS5 use no CONNECT. */
export function proxyTunnels(url: URL, proxy: string): boolean {
  return !isSocksProxy(proxy) && (url.protocol === 'https:' || /^https:/i.test(proxy.trim()));
}

const setIn = (env: Env, upper: string): boolean => !!(env[upper]?.trim() || env[upper.toLowerCase()]?.trim());

/** The variable that supplies the proxy for `url` (HTTPS_PROXY, HTTP_PROXY or ALL_PROXY, as proxyConfig falls back), or
 *  undefined when no proxy is used for it. */
export function proxyVarFor(url: URL, env: Env = process.env): string | undefined {
  if (!proxyForUrl(url, env)) return undefined;
  if (url.protocol === 'https:' && setIn(env, 'HTTPS_PROXY')) return 'HTTPS_PROXY';
  return setIn(env, 'HTTP_PROXY') ? 'HTTP_PROXY' : 'ALL_PROXY';
}

/**
 * The route a request to `url` takes, for --verbose: "proxy: socks5://host:1080 via ALL_PROXY (SOCKS5)", "proxy: http://host:3128
 * via HTTPS_PROXY (CONNECT tunnel; NO_PROXY: ...)", or "proxy: none for host:port (NO_PROXY: ...)". Credentials are never
 * shown. Undefined when no proxy variable is set.
 */
export function proxyRouteLine(url: URL, env: Env = process.env): string | undefined {
  const c = proxyConfig(env);
  if (!c) return undefined;
  const no = c.noProxy ? `; NO_PROXY: ${c.noProxy}` : '';
  const proxy = proxyForUrl(url, env);
  if (!proxy) return `proxy: none for ${url.host} (direct${no})`;
  const how = isSocksProxy(proxy) ? 'SOCKS5' : proxyTunnels(url, proxy) ? 'CONNECT tunnel' : 'plain forwarding';
  return `proxy: ${proxyLabel(proxy)} via ${proxyVarFor(url, env)} (${how}${no})`;
}
