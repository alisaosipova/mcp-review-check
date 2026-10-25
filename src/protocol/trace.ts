// Tracing fetch wrapper: records every HTTP exchange (redacted) for the rules.
import type { HttpExchange } from '../snapshot.js';
import { isSecretName } from '../rules/util/net.js';

export const REDACTED = '«redacted»';
const SNIPPET = 4096;
/** Body cap for probes and recorded SDK traffic. */
const READ_CAP = 256 * 1024;
/** Body cap for JSON-RPC calls whose result we need (`fullBody`): large tools/list pages and UI resources. */
export const FULL_READ_CAP = 64 * 1024 * 1024;
const BODY_TIMEOUT_MS = 10000;

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface Redactor {
  headerNames: Set<string>; // lowercased header names whose values are secret
  values: Set<string>; // literal secret values to scrub from bodies and URLs
}

export function createRedactor(secretHeaders: string[] = [], secretValues: string[] = []): Redactor {
  // Each secret also in its JSON-escaped and percent-encoded forms; longest first so a secret that contains
  // another one is replaced whole.
  const forms = secretValues.filter((v) => v.length >= 4).flatMap((v) => [v, JSON.stringify(v).slice(1, -1), encodeURIComponent(v)]);
  return {
    headerNames: new Set(['authorization', 'cookie', 'proxy-authorization', ...secretHeaders.map((h) => h.toLowerCase())]),
    values: new Set([...new Set(forms)].sort((a, b) => b.length - a.length)),
  };
}

export function scrub(text: string, r: Redactor): string {
  let out = text;
  for (const v of r.values) if (out.includes(v)) out = out.split(v).join(REDACTED);
  return out;
}

export function redactUrl(raw: string, r: Redactor): string {
  try {
    const u = new URL(raw);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) {
      if (isSecretName(k)) { u.searchParams.set(k, 'REDACTED'); changed = true; }
    }
    return scrub(changed ? u.href.replace(/=REDACTED/g, '=' + REDACTED) : raw, r);
  } catch {
    return scrub(raw, r);
  }
}

export function headersToRecord(h: Headers | Record<string, string> | [string, string][] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  const entries = h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h);
  for (const [k, v] of entries) out[k.toLowerCase()] = String(v);
  return out;
}

function redactHeaders(h: Record<string, string>, r: Redactor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = r.headerNames.has(k) ? REDACTED : scrub(v, r);
  return out;
}

/** Parse `data:` lines of an SSE body into JSON messages. */
export function parseSseMessages(text: string): unknown[] {
  const out: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch { /* not JSON */ }
  }
  return out;
}

const isResponseTo = (m: unknown, id: unknown): boolean =>
  !!m && typeof m === 'object' && (m as { id?: unknown }).id === id && ('result' in (m as object) || 'error' in (m as object));

/** Watches an SSE body for the JSON-RPC response with `id`, parsing only complete events. */
function sseResponseWatcher(id: unknown): (chunk: string) => boolean {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    const blocks = buf.split(/\r?\n\r?\n/);
    buf = blocks.pop() ?? '';
    return blocks.some((b) => parseSseMessages(`${b}\n\n`).some((m) => isResponseTo(m, id)));
  };
}

export interface BodyRead {
  text: string;
  truncated: boolean;
  timedOut: boolean;
  /** Stopped after the SSE response with the request id arrived, before the stream ended. */
  stoppedAtResponse: boolean;
}

/**
 * Read a response body up to `cap` bytes or `timeoutMs`. For an SSE response to a JSON-RPC request
 * (`rpcId` set), stop as soon as the matching response event arrives: some servers keep the stream open.
 */
async function readBody(res: Response, timeoutMs: number, cap = READ_CAP, rpcId?: unknown): Promise<BodyRead> {
  const out: BodyRead = { text: '', truncated: false, timedOut: false, stoppedAtResponse: false };
  if (!res.body) return out;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const watch = rpcId !== undefined && /text\/event-stream/i.test(res.headers.get('content-type') ?? '') ? sseResponseWatcher(rpcId) : undefined;
  const decoder = new TextDecoder();
  let handle: NodeJS.Timeout | undefined;
  const timer = new Promise<'timeout'>((resolve) => { handle = setTimeout(() => resolve('timeout'), timeoutMs); handle.unref?.(); });
  try {
    for (;;) {
      const r = await Promise.race([reader.read(), timer]);
      if (r === 'timeout') { out.timedOut = true; break; }
      if (r.done) break;
      chunks.push(r.value);
      size += r.value.byteLength;
      if (watch?.(decoder.decode(r.value, { stream: true }))) { out.stoppedAtResponse = true; break; }
      if (size >= cap) { out.truncated = true; break; }
    }
  } catch { /* aborted */ }
  clearTimeout(handle);
  reader.cancel().catch(() => {});
  out.text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return out;
}

function parseBody(text: string, contentType: string | undefined, requestJson: unknown): unknown {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/event-stream')) {
    const msgs = parseSseMessages(text);
    const id = (requestJson as { id?: unknown } | undefined)?.id;
    return msgs.find((m) => (m as { id?: unknown })?.id === id && id !== undefined) ?? msgs[0];
  }
  const t = text.trim();
  if (!t || !(t.startsWith('{') || t.startsWith('['))) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

function errorInfo(err: unknown): HttpExchange['error'] {
  const e = err as Error & { code?: string | number; cause?: { code?: string } };
  return { name: e?.name ?? 'Error', code: e?.code, causeCode: e?.cause?.code, message: String(e?.message ?? err) };
}

export interface Tracer {
  exchanges: HttpExchange[];
  timings: Record<string, number[]>;
  redactor: Redactor;
  /** Fetch for the SDK: records traffic in the background. */
  fetch: FetchLike;
  /** Fetch for probes: reads the body and returns the finished exchange. */
  /**
   * `fullBody`: a JSON-RPC call whose result is needed. The body is read up to FULL_READ_CAP within the request's
   * own timeoutMs (probes use a 256 KB cap and at most 10 s), and truncation is reported as `exchange.error`.
   */
  request(label: string, url: string | URL, init?: RequestInit & { timeoutMs?: number; abortAfterHeaders?: boolean; fullBody?: boolean }): Promise<{ exchange: HttpExchange; response?: Response }>;
  flush(): Promise<void>;
  now(): number;
}

/** Abort `ctrl` when `stop` aborts, at once if it already has (by hand: AbortSignal.any is not in Node 18.19); returns the unlink. */
function linkAbort(ctrl: AbortController, stop: AbortSignal | undefined): () => void {
  const abort = () => ctrl.abort();
  if (stop?.aborted) abort();
  else stop?.addEventListener('abort', abort, { once: true });
  return () => stop?.removeEventListener('abort', abort);
}

/** `stop` (the --max-duration deadline): once it aborts, nothing more is sent and probes in flight are cancelled. */
export function createTracer(redactor: Redactor, now: () => number = () => performance.now(), stop?: AbortSignal): Tracer {
  const exchanges: HttpExchange[] = [];
  const timings: Record<string, number[]> = {};
  const pending: Promise<unknown>[] = [];

  const begin = (label: string, url: string | URL, init: RequestInit | undefined): HttpExchange => {
    let requestJson: unknown;
    if (typeof init?.body === 'string') { try { requestJson = JSON.parse(init.body); } catch { /* not JSON */ } }
    return {
      label, method: (init?.method ?? 'GET').toUpperCase(), url: redactUrl(String(url), redactor),
      requestHeaders: redactHeaders(headersToRecord(init?.headers as Record<string, string>), redactor),
      requestJson, durationMs: 0,
    };
  };

  const finishHeaders = (ex: HttpExchange, res: Response, started: number) => {
    ex.durationMs = now() - started;
    ex.status = res.status;
    ex.headers = redactHeaders(headersToRecord(res.headers), redactor);
    ex.contentType = res.headers.get('content-type') ?? undefined;
    const method = (ex.requestJson as { method?: unknown } | undefined)?.method;
    if (typeof method === 'string') (timings[method] ??= []).push(ex.durationMs);
  };

  const finishBody = (ex: HttpExchange, text: string) => {
    ex.bodySnippet = scrub(text, redactor).slice(0, SNIPPET); // masked before the cut: no secret prefix is left
    ex.json = parseBody(text, ex.contentType, ex.requestJson);
  };

  const sdkFetch: FetchLike = async (url, init) => {
    const method = (() => { try { return JSON.parse(String(init?.body)).method as string; } catch { return undefined; } })();
    const ex = begin(method ? `sdk ${method}` : `sdk ${(init?.method ?? 'GET').toUpperCase()}`, url, init);
    exchanges.push(ex);
    const started = now();
    try {
      // Past the deadline the SDK sends nothing (a fetch with an aborted signal rejects before it connects); a request
      // already in flight is left to its client (the deadline closes the main one).
      const res = await fetch(url, stop?.aborted ? { ...init, signal: stop } : init);
      finishHeaders(ex, res, started);
      const isStream = ex.method === 'GET' && /event-stream/i.test(ex.contentType ?? '');
      if (!isStream && res.body) {
        const clone = res.clone();
        const rpcId = (ex.requestJson as { id?: unknown } | undefined)?.id;
        pending.push(readBody(clone, BODY_TIMEOUT_MS, READ_CAP, rpcId).then((b) => { ex.bodyMs = now() - started; finishBody(ex, b.text); }));
      }
      return res;
    } catch (err) {
      ex.durationMs = now() - started;
      ex.error = errorInfo(err);
      throw err;
    }
  };

  const request: Tracer['request'] = async (label, url, init = {}) => {
    const ex = begin(label, url, init);
    exchanges.push(ex);
    const started = now();
    const ctrl = new AbortController();
    const timeoutMs = init.timeoutMs ?? 30000;
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    const unlink = linkAbort(ctrl, stop);
    // Tracer-only options are not passed to fetch.
    const { timeoutMs: _timeoutMs, abortAfterHeaders, fullBody, ...fetchInit } = init;
    try {
      const res = await fetch(url, { redirect: 'manual', ...fetchInit, signal: ctrl.signal });
      finishHeaders(ex, res, started);
      if (abortAfterHeaders) {
        res.body?.cancel().catch(() => {});
        ctrl.abort();
        ex.bodySnippet = '';
      } else {
        const rpcId = (ex.requestJson as { id?: unknown } | undefined)?.id;
        const body = fullBody
          ? await readBody(res, Math.max(0, timeoutMs - (now() - started)), FULL_READ_CAP, rpcId)
          : await readBody(res, Math.min(timeoutMs, BODY_TIMEOUT_MS), READ_CAP, rpcId);
        ex.bodyMs = now() - started;
        finishBody(ex, body.text);
        if (fullBody && body.truncated) ex.error = { name: 'BodyTruncated', message: `response body exceeded ${FULL_READ_CAP} bytes and was truncated` };
        else if (fullBody && (body.timedOut || ctrl.signal.aborted) && ex.json === undefined) ex.error = { name: 'BodyTimeout', message: `response body not complete after ${timeoutMs} ms` };
      }
      return { exchange: ex, response: res };
    } catch (err) {
      ex.durationMs = now() - started;
      ex.error = errorInfo(err);
      return { exchange: ex };
    } finally {
      clearTimeout(timeout);
      unlink();
    }
  };

  return {
    exchanges, timings, redactor, fetch: sdkFetch, request, now,
    flush: async () => { await Promise.allSettled(pending.splice(0)); },
  };
}
