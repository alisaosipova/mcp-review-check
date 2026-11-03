// Corporate proxy support: HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and lowercase) for every request made with global fetch.
// Node's built-in fetch ignores these variables; undici's EnvHttpProxyAgent honours them, and is installed only when one is set.
import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';
import { displayUrl } from './rules/util/net.js';

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

/** True when `host:port` is excluded by a NO_PROXY list ("*", "example.com", ".example.com", "*.example.com", "host:8080"). */
export function bypassesProxy(host: string, port: number, noProxy: string | undefined): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  for (const raw of (noProxy ?? '').split(/[,\s]+/).filter(Boolean)) {
    if (raw === '*') return true;
    const m = /^(.*?)(?::(\d+))?$/.exec(raw.toLowerCase().replace(/^\[([^\]]*)\]/, '$1'))!;
    if (m[2] && Number(m[2]) !== port) continue;
    const entry = m[1].replace(/^\*?\./, '');
    if (entry && (h === entry || h.endsWith(`.${entry}`))) return true;
  }
  return false;
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
  // proxyTunnel: false sends http: targets as absolute-URI requests (plain forwarding); https: targets still use CONNECT.
  const dispatcher = new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy: c.noProxy, proxyTunnel: false });
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
