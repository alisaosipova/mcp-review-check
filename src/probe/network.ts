// DNS, TLS, preflight, origin/host probes, and the domain-challenge GET.
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import tls from 'node:tls';
import type { DnsResult, HttpExchange } from '../snapshot.js';
import type { Tracer } from '../protocol/trace.js';
import { CLIENT_CAPABILITIES } from '../protocol/clientCaps.js';
import { isTransient, isTransientCode, timedOut } from '../rules/util/obs.js';
import { VERSION } from '../version.js';

export interface Deps {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  /** The system resolver (dns.lookup), which also sees /etc/hosts and container DNS names. */
  lookup?(host: string): Promise<string[]>;
  tlsCheck(host: string, port: number): Promise<{ ok: boolean; code?: string }>;
  now(): number;
  /** Wait between retries (tests inject a no-op). */
  sleep?(ms: number): Promise<void>;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- transient failures and retries ----------

/** Most attempts per probe; a timed-out attempt is retried only once (it already cost a full timeout). */
export const MAX_ATTEMPTS = 3;
/** Retry-After is honoured up to this wait; a longer one is capped. */
export const MAX_RETRY_AFTER_MS = 5000;

/** Retry-After (seconds or HTTP date, capped) or exponential backoff 250 ms, 750 ms. */
export function retryDelayMs(ex: HttpExchange, attempt: number, nowMs = Date.now()): number {
  const ra = ex.headers?.['retry-after']?.trim();
  if (ra) {
    const ms = /^\d+$/.test(ra) ? Number(ra) * 1000 : Date.parse(ra) - nowMs;
    if (Number.isFinite(ms)) return Math.min(Math.max(0, ms), MAX_RETRY_AFTER_MS);
  }
  return 250 * 3 ** attempt;
}

/** tracer.request with retries on transient failures. Returns every attempt; the last one is the result. */
export async function requestWithRetry(
  tracer: Tracer, label: string, url: string | URL, init: Parameters<Tracer['request']>[2], wait: (ms: number) => Promise<void> = sleep,
): Promise<HttpExchange[]> {
  const out: HttpExchange[] = [];
  for (let i = 0; ; i++) {
    const { exchange } = await tracer.request(i ? `${label} (retry ${i})` : label, url, init);
    out.push(exchange);
    if (!isTransient(exchange) || i + 1 >= MAX_ATTEMPTS || (timedOut(exchange) && i >= 1)) return out;
    await wait(retryDelayMs(exchange, i));
  }
}

/** The last attempt of a retried request. */
export async function requestRetried(tracer: Tracer, label: string, url: string | URL, init: Parameters<Tracer['request']>[2], wait?: (ms: number) => Promise<void>): Promise<HttpExchange> {
  const all = await requestWithRetry(tracer, label, url, init, wait);
  return all[all.length - 1];
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
  lookup: (h) => dns.lookup(h, { all: true }).then((r) => r.map((x) => x.address)),
  tlsCheck: (h, p) => defaultTlsCheck(h, p),
  now: () => performance.now(),
};

export async function lookupHost(host: string, deps: Deps): Promise<DnsResult> {
  const h = host.replace(/^\[|\]$/g, '');
  if (isIP(h) === 4) return { host: h, a: [h], aaaa: [] };
  if (isIP(h) === 6) return { host: h, a: [], aaaa: [h] };
  if (h === 'localhost' || h.endsWith('.localhost')) return { host: h, a: ['127.0.0.1'], aaaa: ['::1'] };
  const [a, aaaa, sys] = await Promise.allSettled([deps.resolve4(h), deps.resolve6(h), deps.lookup?.(h) ?? []]);
  const res: DnsResult = { host: h, a: a.status === 'fulfilled' ? a.value : [], aaaa: aaaa.status === 'fulfilled' ? aaaa.value : [] };
  if (sys.status === 'fulfilled' && sys.value.length) res.lookup = sys.value;
  if (a.status === 'rejected' && aaaa.status === 'rejected') {
    res.error = String((a.reason as Error)?.message ?? a.reason);
    const code = (a.reason as { code?: unknown })?.code;
    if (typeof code === 'string') res.code = code;
  }
  return res;
}

export const LEGACY_VERSION = '2025-11-25';

export function initializeBody(id: number | string = 0, clientName = 'mcp-review-check') {
  return {
    jsonrpc: '2.0', id, method: 'initialize',
    params: { protocolVersion: LEGACY_VERSION, capabilities: CLIENT_CAPABILITIES, clientInfo: { name: clientName, version: VERSION } },
  };
}

export const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

/**
 * Best-effort DELETE of the session a raw initialize probe made the server mint, so a stateful server does not keep
 * one open session per probe. Sent once (no retries) with a short timeout; the answer does not matter.
 */
export async function closeProbeSession(tracer: Tracer, url: string | URL, ex: HttpExchange, headers: Record<string, string>, timeoutMs: number): Promise<void> {
  const id = ex.status !== undefined && ex.status >= 200 && ex.status < 300 ? ex.headers?.['mcp-session-id'] : undefined;
  // A redacted or malformed id (not visible ASCII) cannot name the session.
  if (!id || !/^[\x21-\x7E]+$/.test(id)) return;
  await tracer.request(`${ex.label} (close session)`, url, { method: 'DELETE', headers: { ...headers, 'mcp-session-id': id }, timeoutMs: Math.min(timeoutMs, 5000) });
}

/** Unauthenticated POST initialize with redirect: manual (retried on transient failures). */
export async function preflight(tracer: Tracer, url: URL, timeoutMs: number, wait?: (ms: number) => Promise<void>): Promise<HttpExchange> {
  const ex = await requestRetried(tracer, 'preflight', url, {
    method: 'POST', headers: { ...JSON_HEADERS }, body: JSON.stringify(initializeBody()), timeoutMs,
  }, wait);
  await closeProbeSession(tracer, url, ex, {}, timeoutMs);
  return ex;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The target of a same-host redirect answered to `ex` (such as /mcp -> /mcp/), or undefined.
 * The SDK client follows such a redirect by itself, so raw probes must go to the same final URL or they only see the 3xx.
 * A cross-host redirect, or a downgrade from https to http, is not followed: it would carry the credentials elsewhere.
 */
export function sameHostRedirect(url: URL, ex: HttpExchange | undefined): URL | undefined {
  if (!ex?.status || !REDIRECT_STATUSES.has(ex.status)) return undefined;
  const loc = ex.headers?.location;
  if (!loc) return undefined;
  let target: URL;
  try { target = new URL(loc, url); } catch { return undefined; }
  if (target.host !== url.host || target.href === url.href) return undefined;
  if (target.protocol !== url.protocol && target.protocol !== 'https:') return undefined;
  return target;
}

/** What the Origin probes send: initialize, server/discover (modern-only), or the legacy HTTP+SSE stream GET. */
export type OriginProbeMode = 'initialize' | 'discover' | 'sse';

/**
 * initialize (server/discover for modern-only) with different Origin headers. On a legacy HTTP+SSE endpoint, where a POST
 * means nothing, the same Origins open the event stream with a GET that is cut after the headers.
 */
export async function originProbes(tracer: Tracer, url: URL, headers: Record<string, string>, mode: OriginProbeMode, timeoutMs: number, wait?: (ms: number) => Promise<void>) {
  const init = (origin?: string): Parameters<Tracer['request']>[2] => {
    const o: Record<string, string> = origin ? { origin } : {};
    if (mode === 'sse') return { method: 'GET', headers: { ...headers, accept: 'text/event-stream', ...o }, abortAfterHeaders: true, timeoutMs };
    const body = mode === 'discover'
      ? { jsonrpc: '2.0', id: 0, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }
      : initializeBody();
    const extra: Record<string, string> = mode === 'discover' ? { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' } : {};
    return { method: 'POST', headers: { ...headers, ...JSON_HEADERS, ...extra, ...o }, body: JSON.stringify(body), timeoutMs };
  };
  const send = async (label: string, origin?: string) => {
    const ex = await requestRetried(tracer, label, url, init(origin), wait);
    if (mode === 'initialize') await closeProbeSession(tracer, url, ex, headers, timeoutMs);
    return ex;
  };
  return {
    originNone: await send('origin (none)'),
    originClaude: await send('origin claude.ai', 'https://claude.ai'),
    originChatgpt: await send('origin chatgpt.com', 'https://chatgpt.com'),
    originEvil: await send('origin evil', 'https://evil.mcp-review-check.invalid'),
  };
}

export async function challengeProbe(tracer: Tracer, url: URL, timeoutMs: number, wait?: (ms: number) => Promise<void>): Promise<HttpExchange> {
  return requestRetried(tracer, 'challenge', new URL('/.well-known/openai-apps-challenge', url.origin), { method: 'GET', timeoutMs }, wait);
}

export interface TlsResult {
  ok: boolean;
  code?: string;
  /** Code per attempt when the handshake was retried. */
  attempts?: string[];
  /** Every attempt failed with a network-level code (timeout, reset): certificate trust is unknown. */
  transient?: boolean;
}

/** TLS handshake check that strips IPv6 brackets, never throws, and retries resets (up to 3 attempts) and a timeout (once). */
export async function tlsCheckWithRetry(deps: Deps, hostname: string, port: number): Promise<TlsResult> {
  const codes: string[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let r: { ok: boolean; code?: string };
    try {
      r = await deps.tlsCheck(hostname.replace(/^\[|\]$/g, ''), port);
    } catch (e) {
      r = { ok: false, code: (e as { code?: string }).code ?? (e as Error).message };
    }
    if (r.ok) return codes.length ? { ok: true, attempts: [...codes, 'ok'] } : { ok: true };
    codes.push(r.code ?? 'unknown error');
    if (!isTransientCode(r.code)) return codes.length > 1 ? { ...r, attempts: codes } : r;
    if (r.code === 'ETIMEDOUT' && i >= 1) break; // a timeout already cost the full handshake timeout: retry it once
    if (i + 1 < MAX_ATTEMPTS) await (deps.sleep ?? sleep)(250 * 3 ** i);
  }
  return { ok: false, code: codes[codes.length - 1], attempts: codes, transient: true };
}
