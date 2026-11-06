// DNS, TLS, preflight, origin/host probes, and the domain-challenge GET.
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import tls from 'node:tls';
import { proxyForUrl, proxyLabel } from '../proxy.js';
import type { DnsResult, HttpExchange, ProbeObservation } from '../snapshot.js';
import type { Tracer } from '../protocol/trace.js';
import { CLIENT_CAPABILITIES } from '../protocol/clientCaps.js';
import { isTransient, isTransientCode, timedOut } from '../rules/util/obs.js';
import { VERSION } from '../version.js';

/** Limits of one TLS handshake check: its timeout and the run's --max-duration deadline. */
export interface TlsCheckOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Longest TLS handshake wait; a lower --timeout lowers it. */
export const TLS_TIMEOUT_MS = 10000;

export interface Deps {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  /** The system resolver (dns.lookup), which also sees /etc/hosts and container DNS names. */
  lookup?(host: string): Promise<string[]>;
  tlsCheck(host: string, port: number, opts?: TlsCheckOptions): Promise<{ ok: boolean; code?: string }>;
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

/** How a request is retried. */
export interface RetryOptions {
  /** Retry a timed-out attempt once (default true). False after a stall: each attempt already waits the short
   *  STALLED_TIMEOUT_MS for a server that stopped answering, and a second wait would only double it. */
  retryTimeout?: boolean;
}

/** tracer.request with retries on transient failures. Returns every attempt; the last one is the result. */
export async function requestWithRetry(
  tracer: Tracer, label: string, url: string | URL, init: Parameters<Tracer['request']>[2], wait: (ms: number) => Promise<void> = sleep,
  opts: RetryOptions = {},
): Promise<HttpExchange[]> {
  const out: HttpExchange[] = [];
  const timeoutRetries = opts.retryTimeout === false ? 0 : 1;
  for (let i = 0; ; i++) {
    const { exchange } = await tracer.request(i ? `${label} (retry ${i})` : label, url, init);
    out.push(exchange);
    if (!isTransient(exchange) || i + 1 >= MAX_ATTEMPTS || (timedOut(exchange) && i >= timeoutRetries)) return out;
    await wait(retryDelayMs(exchange, i));
  }
}

/** The last attempt of a retried request. */
export async function requestRetried(
  tracer: Tracer, label: string, url: string | URL, init: Parameters<Tracer['request']>[2], wait?: (ms: number) => Promise<void>, opts?: RetryOptions,
): Promise<HttpExchange> {
  const all = await requestWithRetry(tracer, label, url, init, wait, opts);
  return all[all.length - 1];
}

export function defaultTlsCheck(host: string, port: number, timeoutMs = TLS_TIMEOUT_MS, signal?: AbortSignal): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve({ ok: false, code: 'ABORT_ERR' }); return; }
    const socket = tls.connect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: true });
    const onAbort = () => done({ ok: false, code: 'ABORT_ERR' });
    const done = (r: { ok: boolean; code?: string }) => { signal?.removeEventListener('abort', onAbort); socket.destroy(); resolve(r); };
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs, () => done({ ok: false, code: 'ETIMEDOUT' }));
    socket.once('secureConnect', () => done({ ok: true }));
    socket.once('error', (e: Error & { code?: string }) => done({ ok: false, code: e.code ?? e.message }));
  });
}

export const defaultDeps: Deps = {
  resolve4: (h) => dns.resolve4(h),
  resolve6: (h) => dns.resolve6(h),
  lookup: (h) => dns.lookup(h, { all: true }).then((r) => r.map((x) => x.address)),
  tlsCheck: (h, p, o) => defaultTlsCheck(h, p, o?.timeoutMs, o?.signal),
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

/** Bound on each session-ending DELETE (A02-05, Q4-SESSION): one attempt, its answer ignored. connect.ts re-exports it. */
export const SESSION_END_TIMEOUT_MS = 1500;

/** The session-ending DELETEs of each run (by its tracer) still in flight: sent without waiting, settled once at the end. */
const pendingEnds = new WeakMap<Tracer, Set<Promise<unknown>>>();

/** Track a session end that runs in the background; it must settle on its own within SESSION_END_TIMEOUT_MS. */
export function deferSessionEnd(tracer: Tracer, p: Promise<unknown>): void {
  let set = pendingEnds.get(tracer);
  if (!set) pendingEnds.set(tracer, (set = new Set()));
  const tracked = p.catch(() => {}).finally(() => set!.delete(tracked));
  set.add(tracked);
}

/** Wait for every session end of the run still in flight (each is bounded by SESSION_END_TIMEOUT_MS, so all of them
 *  together add at most that much to the run): the end of the run, and a stop. */
export async function settleSessionEnds(tracer: Tracer | undefined): Promise<void> {
  const set = tracer && pendingEnds.get(tracer);
  while (set?.size) await Promise.allSettled([...set]);
}

/**
 * Best-effort DELETE of the session a raw initialize probe made the server mint, so a stateful server does not keep
 * one open session per probe. Sent once (no retries) within SESSION_END_TIMEOUT_MS, and not waited for (A02-05): a
 * server that holds DELETE open would otherwise add the wait to the run once per probe. The answer does not matter;
 * settleSessionEnds waits for the ones still in flight at the end of the run.
 */
export function closeProbeSession(tracer: Tracer, url: string | URL, ex: HttpExchange, headers: Record<string, string>, timeoutMs: number): void {
  const id = ex.status !== undefined && ex.status >= 200 && ex.status < 300 ? ex.headers?.['mcp-session-id'] : undefined;
  // A redacted or malformed id (not visible ASCII) cannot name the session.
  if (!id || !/^[\x21-\x7E]+$/.test(id)) return;
  deferSessionEnd(tracer, tracer.request(`${ex.label} (close session)`, url, { method: 'DELETE', headers: { ...headers, 'mcp-session-id': id }, timeoutMs: Math.min(timeoutMs, SESSION_END_TIMEOUT_MS) }));
}

/** Unauthenticated POST initialize with redirect: manual. Resets and 5xx are retried; a timeout is not (A10-03): a
 *  server that accepted the connection and said nothing within the connect wait would only cost a second full wait. */
export async function preflight(tracer: Tracer, url: URL, timeoutMs: number, wait?: (ms: number) => Promise<void>): Promise<HttpExchange> {
  const ex = await requestRetried(tracer, 'preflight', url, {
    method: 'POST', headers: { ...JSON_HEADERS }, body: JSON.stringify(initializeBody()), timeoutMs,
  }, wait, { retryTimeout: false });
  closeProbeSession(tracer, url, ex, {}, timeoutMs);
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

/** The four Origin probes, in the order they are sent. */
export type OriginProbeName = 'originNone' | 'originClaude' | 'originChatgpt' | 'originEvil';

/**
 * initialize (server/discover for modern-only) with different Origin headers. On a legacy HTTP+SSE endpoint, where a POST
 * means nothing, the same Origins open the event stream with a GET that is cut after the headers.
 * Each probe lands in `out` as soon as it finishes (and `out` is returned), so a --max-duration stop between two of them
 * keeps the ones already made. Default: a new object.
 */
export async function originProbes(
  tracer: Tracer, url: URL, headers: Record<string, string>, mode: OriginProbeMode, timeoutMs: number, wait?: (ms: number) => Promise<void>,
  out: Partial<Record<OriginProbeName, ProbeObservation>> = {}, retry?: RetryOptions,
): Promise<Partial<Record<OriginProbeName, ProbeObservation>>> {
  const init = (origin?: string): Parameters<Tracer['request']>[2] => {
    const o: Record<string, string> = origin ? { origin } : {};
    if (mode === 'sse') return { method: 'GET', headers: { ...headers, accept: 'text/event-stream', ...o }, abortAfterHeaders: true, timeoutMs };
    const body = mode === 'discover'
      ? { jsonrpc: '2.0', id: 0, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }
      : initializeBody();
    const extra: Record<string, string> = mode === 'discover' ? { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' } : {};
    return { method: 'POST', headers: { ...headers, ...JSON_HEADERS, ...extra, ...o }, body: JSON.stringify(body), timeoutMs };
  };
  const send = async (name: OriginProbeName, label: string, origin?: string) => {
    const ex = await requestRetried(tracer, label, url, init(origin), wait, retry);
    out[name] = ex; // published before the session close: the probe itself is done
    if (mode === 'initialize') closeProbeSession(tracer, url, ex, headers, timeoutMs);
  };
  await send('originNone', 'origin (none)');
  await send('originClaude', 'origin claude.ai', 'https://claude.ai');
  await send('originChatgpt', 'origin chatgpt.com', 'https://chatgpt.com');
  await send('originEvil', 'origin evil', 'https://evil.mcp-review-check.invalid');
  return out;
}

/** The domain-challenge GET. `retry.retryTimeout: false` after a stall: one short wait, not two. */
export async function challengeProbe(tracer: Tracer, url: URL, timeoutMs: number, wait?: (ms: number) => Promise<void>, retry?: RetryOptions): Promise<HttpExchange> {
  return requestRetried(tracer, 'challenge', new URL('/.well-known/openai-apps-challenge', url.origin), { method: 'GET', timeoutMs }, wait, retry);
}

export interface TlsResult {
  ok: boolean;
  code?: string;
  /** Code per attempt when the handshake was retried. */
  attempts?: string[];
  /** Every attempt failed with a network-level code (timeout, reset): certificate trust is unknown. */
  transient?: boolean;
}

/**
 * TLS handshake check that strips IPv6 brackets, never throws, and retries resets (up to 3 attempts) and a timeout (once).
 * Each handshake waits at most `opts.timeoutMs` (capped at TLS_TIMEOUT_MS); once `opts.signal` aborts, nothing is retried.
 */
export async function tlsCheckWithRetry(deps: Deps, hostname: string, port: number, opts: TlsCheckOptions = {}): Promise<TlsResult> {
  // The handshake is a raw socket: it cannot go through an HTTP proxy, and a direct one would fail or hit another route.
  const proxy = proxyForUrl(new URL(`https://${hostname.includes(':') ? `[${hostname.replace(/^\[|\]$/g, '')}]` : hostname}:${port}`));
  if (proxy) {
    const code = `not checked: the direct TLS handshake cannot go through the proxy ${proxyLabel(proxy)} (list the host in NO_PROXY to check it)`;
    return { ok: false, code, attempts: [code], transient: true };
  }
  const codes: string[] = [];
  const timeoutMs = Math.min(opts.timeoutMs ?? TLS_TIMEOUT_MS, TLS_TIMEOUT_MS);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let r: { ok: boolean; code?: string };
    try {
      r = await deps.tlsCheck(hostname.replace(/^\[|\]$/g, ''), port, { timeoutMs, signal: opts.signal });
    } catch (e) {
      r = { ok: false, code: (e as { code?: string }).code ?? (e as Error).message };
    }
    if (r.ok) return codes.length ? { ok: true, attempts: [...codes, 'ok'] } : { ok: true };
    codes.push(r.code ?? 'unknown error');
    if (opts.signal?.aborted) break; // cut off by the --max-duration deadline: certificate trust is unknown, not failed
    if (!isTransientCode(r.code)) return codes.length > 1 ? { ...r, attempts: codes } : r;
    if (r.code === 'ETIMEDOUT' && i >= 1) break; // a timeout already cost the full handshake timeout: retry it once
    if (i + 1 < MAX_ATTEMPTS) await (deps.sleep ?? sleep)(250 * 3 ** i);
  }
  return { ok: false, code: codes[codes.length - 1], attempts: codes, transient: true };
}
