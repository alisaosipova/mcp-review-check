// Connection diagnostics: turn "fetch failed" and HTML error pages into a cause and a next step.
import type { ConnectDiagnosis } from './snapshot.js';
import { displayUrl } from './rules/util/net.js';
import { isSocksProxy, proxyForUrl, proxyKind, proxyLabel, proxyTunnels, proxyVarFor } from './proxy.js';

const TLS_CODE = /^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(GET|VERIFY)|ERR_TLS_|ERR_SSL_|HOSTNAME_MISMATCH)/;

/** The network cause of a failed fetch: undici puts the system error on `cause`. */
export function networkCause(e: unknown): { code?: string; message?: string } | undefined {
  // The chain is fetch failed > cause > cause: undici's fetch wraps a tunnel failure ("Proxy response (407) !== 200") one level deeper.
  const chain: Array<{ code?: unknown; message?: unknown; cause?: unknown }> = [];
  for (let x = e as (typeof chain)[number] | undefined, i = 0; x && typeof x === 'object' && i < 4; x = x.cause as typeof x, i++) chain.push(x);
  const causes = chain.slice(1);
  const code = causes.map((c) => c.code).find((c): c is string => typeof c === 'string')
    ?? (typeof (chain[0] as { code?: unknown })?.code === 'string' && /^[A-Z_]+$/.test(chain[0].code as string) ? (chain[0].code as string) : undefined);
  const messages = causes.map((c) => c.message).filter((m): m is string => typeof m === 'string');
  const message = messages.find((m) => /^Proxy response \(\d+\)/.test(m)) ?? messages[0];
  return code || message ? { code, message } : undefined;
}

export function isTlsCode(code: string | undefined): boolean {
  return !!code && TLS_CODE.test(code);
}

const PROXY_HOP = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_PRX_TLS']);
/** undici's SOCKS5 client errors (lib/core/socks5-client.js): the proxy hop failed or refused, not the target. */
const SOCKS5_CODE = /^UND_ERR_SOCKS5/;

/** "set HTTPS_PROXY=http://user:pass@host:port" naming the variable that supplied the proxy, with its scheme. */
function credentialsExample(variable: string, proxy: string): string {
  const scheme = isSocksProxy(proxy) ? 'socks5' : /^https:/i.test(proxy) ? 'https' : 'http';
  return `${variable}=${scheme}://user:pass@host:port`;
}

function proxyAuth(url: URL, proxy: string): ConnectDiagnosis {
  const variable = proxyVarFor(url) ?? 'HTTPS_PROXY';
  return {
    kind: 'http', status: 407, summary: `HTTP 407: the ${proxyKind(proxy)} ${proxyLabel(proxy)} requires authentication (Proxy Authentication Required)`,
    hint: `put the credentials in the proxy URL (${credentialsExample(variable, proxy)}), or list the target in NO_PROXY`,
  };
}

/** A failure inside the SOCKS5 exchange (UND_ERR_SOCKS5_*): the proxy rejected the credentials, or its reply named why
 *  it could not reach the target (RFC 1928 s6 reply codes). */
function socksFailure(url: URL, hostPort: string, proxy: string, code: string): ConnectDiagnosis {
  const p = `the SOCKS5 proxy ${proxyLabel(proxy)}`;
  const variable = proxyVarFor(url) ?? 'ALL_PROXY';
  if (code === 'UND_ERR_SOCKS5_AUTH_FAILED') {
    return { kind: 'other', code, summary: `${p} rejected the user name and password (${code})`, hint: `check the credentials in ${variable} (${credentialsExample(variable, proxy)})` };
  }
  if (code === 'UND_ERR_SOCKS5_AUTH_REJECTED' || code === 'UND_ERR_SOCKS5_AUTH_METHOD') {
    return { kind: 'other', code, summary: `${p} requires an authentication method the proxy URL does not offer (${code})`, hint: `put the user name and password in ${variable} (${credentialsExample(variable, proxy)})` };
  }
  const reply = /^UND_ERR_SOCKS5_REPLY_(\d+)$/.exec(code)?.[1];
  switch (reply) {
    case '5':
      return { kind: 'refused', code, summary: `${p} could not connect to ${hostPort}: connection refused (${code})`, hint: 'nothing is listening there: check that the server is running and the port is right' };
    case '3':
    case '4':
      return { kind: 'other', code, summary: `${p} could not reach ${hostPort}: ${reply === '3' ? 'network' : 'host'} unreachable (${code})`, hint: 'check the address; the proxy has no route to it (list hosts to reach directly in NO_PROXY)' };
    case '6':
      return { kind: 'timeout', code, summary: `${p} could not reach ${hostPort}: TTL expired (${code})`, hint: 'check that the host is reachable from the proxy (firewall, VPN, WAF)' };
    case '2':
      return { kind: 'other', code, summary: `${p} does not allow a connection to ${hostPort}: not allowed by the proxy's rules (${code})`, hint: 'ask the proxy administrator to allow the target, or list it in NO_PROXY' };
  }
  return { kind: 'other', code, summary: `${p} failed to connect to ${hostPort} (${code})`, hint: `check ${variable}: the proxy address and port and that it speaks SOCKS5; list hosts to reach directly in NO_PROXY` };
}

/** Describe a network-level failure for `url` by its error code (falls back to the cause message). */
export function describeCause(url: URL, cause: { code?: string; message?: string }): ConnectDiagnosis {
  const { code, message } = cause;
  const host = url.hostname;
  const hostPort = `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;
  // With a proxy in the way, the socket error comes from the proxy hop (or the proxy's refusal to tunnel), not from the target.
  const proxy = proxyForUrl(url);
  const socks = !!proxy && isSocksProxy(proxy);
  if (proxy && socks && SOCKS5_CODE.test(code ?? '')) return socksFailure(url, hostPort, proxy, code!);
  const viaProxy = proxy && (PROXY_HOP.has(code ?? '') || (!socks && /^Proxy response \(\d+\)|\b407\b/.test(message ?? '')));
  if (proxy && viaProxy) {
    const p = proxyLabel(proxy);
    if (!socks && /\b407\b/.test(message ?? '')) return proxyAuth(url, proxy);
    const kind = code === 'ECONNREFUSED' ? 'refused' : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'dns' : code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' ? 'timeout' : code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET' ? 'reset' : 'other';
    const variable = proxyVarFor(url) ?? 'HTTPS_PROXY / HTTP_PROXY';
    // CONNECT only where undici tunnels (an https: target, or an https: proxy); plain forwarding and SOCKS5 use none.
    const tunnel = proxyTunnels(url, proxy) ? ', that it is running and allows CONNECT to the target' : ' and that it is running';
    return {
      kind, code, summary: `cannot reach ${hostPort} through the ${proxyKind(proxy)} ${p} (${code ?? 'proxy error'})`,
      hint: `check ${variable}: the proxy address and port${tunnel}; list hosts to reach directly in NO_PROXY`,
    };
  }
  switch (code) {
    case 'ENOTFOUND':
      return { kind: 'dns', code, summary: `hostname ${host} does not resolve (ENOTFOUND)`, hint: 'check the hostname for typos and that its DNS records are published' };
    case 'EAI_AGAIN':
      return { kind: 'dns', code, summary: `DNS lookup for ${host} failed temporarily (EAI_AGAIN)`, hint: 'retry; check your network or DNS resolver' };
    case 'ECONNREFUSED':
      return { kind: 'refused', code, summary: `connection refused by ${hostPort} (ECONNREFUSED)`, hint: 'nothing is listening there: check that the server is running and the port is right' };
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return { kind: 'timeout', code, summary: `connection to ${hostPort} timed out (${code})`, hint: 'check that the host is reachable from this network (firewall, VPN, WAF)' };
    case 'ECONNRESET':
    case 'EPIPE':
    case 'UND_ERR_SOCKET':
      return { kind: 'reset', code, summary: `connection to ${hostPort} was reset (${code})`, hint: 'retry; a proxy, WAF or TLS terminator may be dropping the request' };
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'EADDRNOTAVAIL': // kind stays 'other': JSON coverage.diagnosis.kind does not change
      return { kind: 'other', code, summary: `no route to ${hostPort} (${code})`, hint: 'check the address, VPN and firewall; on macOS 15+ allow Local Network access for your terminal app (System Settings > Privacy & Security > Local Network)' };
  }
  if (isTlsCode(code) && proxy) {
    // Through a proxy the certificate is often the TLS-inspecting proxy's own, not the server's.
    return {
      kind: 'tls', code, summary: `TLS certificate presented for ${host} through the proxy ${proxyLabel(proxy)} is not trusted (${code})`,
      hint: "a TLS-inspecting proxy presents its own certificate: add its CA with NODE_EXTRA_CA_CERTS=/path/to/ca.pem; otherwise the server's certificate is at fault (serve one from a public CA with the full chain)",
    };
  }
  if (isTlsCode(code)) {
    return {
      kind: 'tls', code, summary: `TLS certificate of ${host} is not trusted (${code})`,
      hint: 'serve a certificate from a public CA with the full chain; hosts reject self-signed and private-CA certificates',
    };
  }
  return { kind: 'other', code, summary: `fetch failed (${code ?? message ?? 'network error'})` };
}

/** The usual Streamable HTTP endpoint next to `url`: /sse → /mcp, anything else → <path>/mcp. */
export function suggestedEndpoint(url: URL): string | undefined {
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/sse$/i.test(path)) return `${url.origin}${path.replace(/\/sse$/i, '/mcp')}`;
  if (/\/mcp$/i.test(path)) return undefined;
  return `${url.origin}${path}/mcp`;
}

export function htmlTitle(body: string | undefined): string | undefined {
  const m = /<title[^<>]{0,200}>([^<]{1,200})<\/title>/i.exec(body ?? '');
  return m ? m[1].replace(/\s+/g, ' ').trim() : undefined;
}

export interface HttpFailure {
  status?: number;
  contentType?: string;
  body?: string;
  /** The cleaned SDK error message. */
  message?: string;
}

const GATEWAY = new Set([502, 503, 504]);
const GATEWAY_TEXT_CAP = 200;
/** The body text in the SDK's handshake error ("... Error POSTing to endpoint: <body>"), one line, capped; '' when none. */
function gatewayText(sdk: string, status: number): string {
  const text = sdk
    .replace(/^HTTP \d+:\s*/, '')
    .replace(/^(?:Streamable HTTP error:\s*)?Error POSTing to endpoint(?: \(HTTP \d+\))?(?::\s*|$)/, '')
    .replace(/\s+/g, ' ').trim();
  if (!text || text === `HTTP ${status}`) return '';
  return text.length > GATEWAY_TEXT_CAP ? `${text.slice(0, GATEWAY_TEXT_CAP)}…` : text;
}
/** A 5xx answer to the handshake: a gateway status names the hop in front of the server (the proxy, when one is used). */
function serverError(url: URL, status: number, title: string | undefined, html: boolean, message: string | undefined): ConnectDiagnosis {
  const proxyUrl = proxyForUrl(url);
  const hostPort = `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;
  // The SDK message ends in ": " when the body was empty ("Error POSTing to endpoint: ").
  const sdk = (message ?? '').replace(/[\s:]+$/, '');
  const page = html ? ` (${title ? `"${title}" ` : ''}HTML page)` : '';
  if (GATEWAY.has(status)) {
    // A SOCKS5 proxy only relays bytes: a gateway status comes from behind it, not from the proxy.
    const httpProxy = proxyUrl && !isSocksProxy(proxyUrl) ? proxyUrl : undefined;
    const via = httpProxy ? `the ${proxyKind(httpProxy)} ${proxyLabel(httpProxy)}` : 'the gateway or proxy in front of the server';
    // A plain-text body ("upstream connect error ...", "no healthy upstream") often names the cause: keep it.
    const said = html ? '' : gatewayText(sdk, status);
    return {
      kind: 'http', status, summary: `HTTP ${status}${page}: ${via} could not reach ${hostPort}${said ? ` (it answered: ${said})` : ''}`,
      hint: httpProxy
        ? 'check that the MCP server is running and that the proxy can reach it; list hosts to reach directly in NO_PROXY'
        : 'check that the MCP server behind it is running; the URL path is not the cause',
    };
  }
  const next = suggestedEndpoint(url);
  return {
    kind: 'http', status, summary: html ? `HTTP ${status}${page}: the server failed to answer the handshake` : sdk || `HTTP ${status}`,
    ...(/\/sse\/?$/i.test(url.pathname) && next ? { hint: `/sse is the deprecated HTTP+SSE path; try ${next}` } : {}),
  };
}

/** The handshake POST got a status that says no MCP endpoint is there: not found, gone, or POST not supported. */
const NOT_MCP_STATUS = new Set([404, 405, 410, 501]);

/** Describe an HTTP-level handshake failure: 404/405/410/501 or a non-5xx HTML page means the URL is not an MCP endpoint. */
export function describeHttpFailure(url: URL, f: HttpFailure): ConnectDiagnosis {
  const html = /text\/html/i.test(f.contentType ?? '') || /<(!doctype|html|head|body)\b/i.test(f.body ?? '');
  const sse = /\/sse\/?$/i.test(url.pathname);
  const next = suggestedEndpoint(url);
  // The SDK reports an unexpected content type as code -1: that is not an HTTP status.
  const status = f.status !== undefined && f.status >= 100 ? f.status : undefined;
  // 407 is the proxy's answer, not the server's.
  // A SOCKS5 proxy answers no HTTP status: a 407 then comes from the server or a gateway behind it.
  const proxy = status === 407 ? proxyForUrl(url) : undefined;
  if (proxy && !isSocksProxy(proxy)) return proxyAuth(url, proxy);
  // 501 (and 405) to the POST: the server does not take POST at that path (a static file server), so the URL is not an
  // MCP endpoint; checked before the 5xx branch (A10-01).
  const notMcpStatus = status !== undefined && NOT_MCP_STATUS.has(status);
  // A 5xx page (a gateway's "502 Bad Gateway", an app's error page) says the server behind the URL failed, not that the path is wrong.
  if (status !== undefined && status >= 500 && !notMcpStatus) return serverError(url, status, html ? htmlTitle(f.body) : undefined, html, f.message);
  if (notMcpStatus || html) {
    const title = html ? htmlTitle(f.body) : undefined;
    const what = `${status !== undefined ? `HTTP ${status}` : 'response'}${html ? ` with an HTML page${title ? ` ("${title}")` : ''}` : ''}`;
    const hint = sse
      ? `/sse is the deprecated HTTP+SSE path; Streamable HTTP servers usually serve ${next}`
      : next ? `try ${next}` : 'check the path the server mounts MCP on';
    return { kind: 'not-mcp', status, summary: `${what}: ${displayUrl(url.href)} is not an MCP endpoint`, hint };
  }
  return { kind: 'http', status, summary: f.message ?? (status !== undefined ? `HTTP ${status}` : 'unknown error'), ...(sse && next ? { hint: `/sse is the deprecated HTTP+SSE path; try ${next}` } : {}) };
}

/** A 403 to initialize: a bot challenge or WAF block names its cause, an HTML page its title. */
export function describeForbidden(f: HttpFailure & { headers?: Record<string, string> }): ConnectDiagnosis {
  const h = f.headers ?? {};
  const title = htmlTitle(f.body);
  const server = (h.server ?? '').toLowerCase();
  const cloudflare = !!h['cf-mitigated'] || server === 'cloudflare' || /^(just a moment|attention required)/i.test(title ?? '');
  const waf = cloudflare ? 'Cloudflare'
    : /akamai/.test(server) || Object.keys(h).some((k) => k.startsWith('akamai-')) ? 'Akamai'
    : Object.keys(h).some((k) => k.startsWith('x-amzn-waf')) || /^awselb|cloudfront/.test(server) ? 'AWS WAF'
    : /incapsula|imperva/i.test(`${server} ${h['x-cdn'] ?? ''}`) || !!h['x-iinfo'] ? 'Imperva'
    : undefined;
  const challenge = h['cf-mitigated'] === 'challenge' || /^just a moment/i.test(title ?? '');
  if (waf) {
    return {
      kind: 'http', status: 403,
      summary: `HTTP 403: blocked by ${challenge ? `a ${waf} bot challenge` : `the ${waf} firewall`}${title ? ` ("${title}")` : ''}`,
      hint: `allow the MCP endpoint through ${waf} (bot protection, challenge and WAF rules): MCP clients cannot solve browser challenges`,
    };
  }
  return { kind: 'http', status: 403, summary: `HTTP 403 (forbidden)${title ? ` with an HTML page ("${title}")` : ''}` };
}

/** The URL opened an HTTP+SSE stream, but the SSE handshake failed (no endpoint event, an endpoint on another origin
 *  behind a proxy, no initialize answer): its error is the cause, not the Streamable HTTP POST's 404 or 405. */
export function describeSseFailure(url: URL, message: string): ConnectDiagnosis {
  return {
    kind: 'http', summary: `${displayUrl(url.href)} serves the deprecated HTTP+SSE transport, but its handshake failed: ${message}`,
    hint: 'serve Streamable HTTP, or fix the SSE endpoint event (it must point to the same origin)',
  };
}

/** What the HTTP connect wait is, for the hints below (src/connect.ts: connectTimeout). */
const CONNECT_WAIT = 'HTTP connect waits min(--timeout, 15000) ms';

/** The SDK initialize got no answer within `ms` although the server answered the raw probes (A02-04): kind `timeout`. */
export function describeInitTimeout(ms: number): ConnectDiagnosis {
  return {
    kind: 'timeout', summary: `initialize got no answer within ${ms} ms`,
    hint: `the server accepted the connection but did not answer; ${CONNECT_WAIT}; a cold-starting server may need a warm-up request first`,
  };
}

/** No request got any answer: the unauthenticated initialize timed out and so did the handshake (A10-03). Through a
 *  proxy the tool cannot tell whether the server accepted the connection, so the message names the proxy instead. */
export function describeNoAnswer(url: URL, ms: number): ConnectDiagnosis {
  const hostPort = `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;
  const proxy = proxyForUrl(url);
  return {
    kind: 'no-answer',
    summary: proxy
      ? `no answer to POST initialize from ${hostPort} through the ${proxyKind(proxy)} ${proxyLabel(proxy)} within ${ms} ms`
      : `the server accepted the connection on ${hostPort} but did not answer POST initialize within ${ms} ms`,
    hint: `check that the process serving this port is the MCP server and is not blocked; ${CONNECT_WAIT}, so raise --timeout for a slow cold start`,
  };
}

/** "summary; hint" for coverage.reason and the fatal message. */
export function diagnosisText(d: ConnectDiagnosis): string {
  return d.hint ? `${d.summary}; ${d.hint}` : d.summary;
}

/** A suggestion for a URL argument without a scheme ("mcp.example.com/mcp" → "https://mcp.example.com/mcp"). */
export function schemeSuggestion(raw: string): string | undefined {
  const t = raw.trim();
  if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /\s/.test(t)) return undefined;
  const hostPort = t.split(/[/?#]/)[0];
  const host = hostPort.replace(/:\d+$/, '').toLowerCase();
  if (!host || !/^[\w.-]+$|^\[[0-9a-f:]+\]$/i.test(host)) return undefined;
  // "mcp:8080/mcp": a name without a dot plus a port is a container or LAN host, checked in local mode.
  const dotless = /^[\w-]+$/.test(host) && /:\d+$/.test(hostPort);
  const local = dotless || host === 'localhost' || host.endsWith('.localhost') || /^127\.|^\[::1\]$|^0\.0\.0\.0$/.test(host);
  if (!local && !host.includes('.')) return undefined;
  return `${local ? 'http' : 'https'}://${t}`;
}
