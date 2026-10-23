// DNS, TLS, preflight, origin/host probes, and the domain-challenge GET.
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import tls from 'node:tls';
import type { DnsResult, HttpExchange } from '../snapshot.js';
import type { Tracer } from '../protocol/trace.js';

export interface Deps {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  tlsCheck(host: string, port: number): Promise<{ ok: boolean; code?: string }>;
  now(): number;
}

export function defaultTlsCheck(host: string, port: number, timeoutMs = 10000): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: true });
    const done = (r: { ok: boolean; code?: string }) => { socket.destroy(); resolve(r); };
    socket.setTimeout(timeoutMs, () => done({ ok: false, code: 'ETIMEDOUT' }));
    socket.once('secureConnect', () => done({ ok: true }));
    socket.once('error', (e: Error & { code?: string }) => done({ ok: false, code: e.code ?? e.message }));
  });
}

export const defaultDeps: Deps = {
  resolve4: (h) => dns.resolve4(h),
  resolve6: (h) => dns.resolve6(h),
  tlsCheck: (h, p) => defaultTlsCheck(h, p),
  now: () => performance.now(),
};

export async function lookupHost(host: string, deps: Deps): Promise<DnsResult> {
  const h = host.replace(/^\[|\]$/g, '');
  if (isIP(h) === 4) return { host: h, a: [h], aaaa: [] };
  if (isIP(h) === 6) return { host: h, a: [], aaaa: [h] };
  if (h === 'localhost' || h.endsWith('.localhost')) return { host: h, a: ['127.0.0.1'], aaaa: ['::1'] };
  const [a, aaaa] = await Promise.allSettled([deps.resolve4(h), deps.resolve6(h)]);
  const res: DnsResult = { host: h, a: a.status === 'fulfilled' ? a.value : [], aaaa: aaaa.status === 'fulfilled' ? aaaa.value : [] };
  if (a.status === 'rejected' && aaaa.status === 'rejected') res.error = String((a.reason as Error)?.message ?? a.reason);
  return res;
}

export const LEGACY_VERSION = '2025-11-25';

export function initializeBody(id: number | string = 0, clientName = 'mcp-review-check') {
  return {
    jsonrpc: '2.0', id, method: 'initialize',
    params: { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: clientName, version: '0.1.0' } },
  };
}

export const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

/** Unauthenticated POST initialize with redirect: manual. */
export async function preflight(tracer: Tracer, url: URL, timeoutMs: number): Promise<HttpExchange> {
  const { exchange } = await tracer.request('preflight', url, {
    method: 'POST', headers: { ...JSON_HEADERS }, body: JSON.stringify(initializeBody()), timeoutMs,
  });
  return exchange;
}

/** initialize (or server/discover for modern-only) with different Origin headers. */
export async function originProbes(tracer: Tracer, url: URL, headers: Record<string, string>, modernOnly: boolean, timeoutMs: number) {
  const body = modernOnly
    ? { jsonrpc: '2.0', id: 0, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }
    : initializeBody();
  const extra: Record<string, string> = modernOnly ? { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' } : {};
  const send = async (label: string, origin?: string) =>
    (await tracer.request(label, url, {
      method: 'POST', headers: { ...headers, ...JSON_HEADERS, ...extra, ...(origin ? { origin } : {}) }, body: JSON.stringify(body), timeoutMs,
    })).exchange;
  return {
    originNone: await send('origin (none)'),
    originClaude: await send('origin claude.ai', 'https://claude.ai'),
    originChatgpt: await send('origin chatgpt.com', 'https://chatgpt.com'),
    originEvil: await send('origin evil', 'https://evil.mcp-review-check.invalid'),
  };
}

export async function challengeProbe(tracer: Tracer, url: URL, timeoutMs: number): Promise<HttpExchange> {
  return (await tracer.request('challenge', new URL('/.well-known/openai-apps-challenge', url.origin), { method: 'GET', timeoutMs })).exchange;
}
