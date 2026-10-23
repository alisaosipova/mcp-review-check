// Connection diagnostics (B7): turn "fetch failed" and HTML error pages into a cause and a next step.
import type { ConnectDiagnosis } from './snapshot.js';
import { displayUrl } from './rules/util/net.js';

const TLS_CODE = /^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(GET|VERIFY)|ERR_TLS_|ERR_SSL_|HOSTNAME_MISMATCH)/;

/** The network cause of a failed fetch: undici puts the system error on `cause`. */
export function networkCause(e: unknown): { code?: string; message?: string } | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown; message?: unknown } } | undefined;
  const code = typeof err?.cause?.code === 'string' ? err.cause.code : typeof err?.code === 'string' && /^[A-Z_]+$/.test(err.code) ? err.code : undefined;
  const message = typeof err?.cause?.message === 'string' ? err.cause.message : undefined;
  return code || message ? { code, message } : undefined;
}

export function isTlsCode(code: string | undefined): boolean {
  return !!code && TLS_CODE.test(code);
}

/** Describe a network-level failure for `url` by its error code (falls back to the cause message). */
export function describeCause(url: URL, cause: { code?: string; message?: string }): ConnectDiagnosis {
  const { code, message } = cause;
  const host = url.hostname;
  const hostPort = `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;
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

/** Describe an HTTP-level handshake failure: 404/405/410 or an HTML page means the URL is not an MCP endpoint. */
export function describeHttpFailure(url: URL, f: HttpFailure): ConnectDiagnosis {
  const html = /text\/html/i.test(f.contentType ?? '') || /<(!doctype|html|head|body)\b/i.test(f.body ?? '');
  const sse = /\/sse\/?$/i.test(url.pathname);
  const next = suggestedEndpoint(url);
  // The SDK reports an unexpected content type as code -1: that is not an HTTP status.
  const status = f.status !== undefined && f.status >= 100 ? f.status : undefined;
  if ((status !== undefined && [404, 405, 410].includes(status)) || html) {
    const title = html ? htmlTitle(f.body) : undefined;
    const what = `${status !== undefined ? `HTTP ${status}` : 'response'}${html ? ` with an HTML page${title ? ` ("${title}")` : ''}` : ''}`;
    const hint = sse
      ? `/sse is the deprecated HTTP+SSE path; Streamable HTTP servers usually serve ${next}`
      : next ? `try ${next}` : 'check the path the server mounts MCP on';
    return { kind: 'not-mcp', status, summary: `${what}: ${displayUrl(url.href)} is not an MCP endpoint`, hint };
  }
  return { kind: 'http', status, summary: f.message ?? (status !== undefined ? `HTTP ${status}` : 'unknown error'), ...(sse && next ? { hint: `/sse is the deprecated HTTP+SSE path; try ${next}` } : {}) };
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
  // "mcp:8080/mcp": a name without a dot plus a port is a container or LAN host, checked in local mode (R-19, R-35).
  const dotless = /^[\w-]+$/.test(host) && /:\d+$/.test(hostPort);
  const local = dotless || host === 'localhost' || host.endsWith('.localhost') || /^127\.|^\[::1\]$|^0\.0\.0\.0$/.test(host);
  if (!local && !host.includes('.')) return undefined;
  return `${local ? 'http' : 'https'}://${t}`;
}
