// Corporate proxy support: HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and lowercase) for every request made with global fetch.
// Node's built-in fetch ignores these variables; undici's EnvHttpProxyAgent honours them, and is installed only when one is set.
import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';
import { displayUrl } from './rules/util/net.js';

type Env = Record<string, string | undefined>;

/** The variable under either case; a value without a scheme ("proxy:3128") is read as http://, as curl does. */
const pick = (env: Env, upper: string): string | undefined => {
  const v = (env[upper] || env[upper.toLowerCase()] || '').trim();
  return !v ? undefined : /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || upper === 'NO_PROXY' ? v : `http://${v}`;
};

export interface ProxyConfig { httpProxy?: string; httpsProxy?: string; noProxy?: string }

/** The proxy variables of `env`, or undefined when none is set. HTTPS_PROXY falls back to HTTP_PROXY, as undici's EnvHttpProxyAgent does, so diagnostics match what fetch really does. */
export function proxyConfig(env: Env = process.env): ProxyConfig | undefined {
  const httpProxy = pick(env, 'HTTP_PROXY');
  const httpsProxy = pick(env, 'HTTPS_PROXY');
  if (!httpProxy && !httpsProxy) return undefined;
  return { httpProxy, httpsProxy: httpsProxy ?? httpProxy, noProxy: pick(env, 'NO_PROXY') };
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

/** Install the proxy-aware dispatcher for global fetch when a proxy variable is set; returns whether it did. */
export function installProxy(env: Env = process.env): boolean {
  const c = proxyConfig(env);
  if (!c) return false;
  const dispatcher = new EnvHttpProxyAgent({ httpProxy: c.httpProxy, httpsProxy: c.httpsProxy, noProxy: c.noProxy });
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
