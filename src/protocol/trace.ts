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

/** Values shorter than this are masked only as whole tokens: "test" stays in "attestation", "latest" and "run_tests". */
const SHORT_SECRET = 8;
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = new WeakMap<Redactor, { size: number; re: RegExp }>();

/** One pattern for all values, longest first; a short value must not touch a letter, digit, "_" or "-" on either side. */
function patternOf(r: Redactor): RegExp {
  const cached = patterns.get(r);
  if (cached && cached.size === r.values.size) return cached.re;
  const alts = [...r.values].sort((a, b) => b.length - a.length)
    .map((v) => (v.length < SHORT_SECRET ? `(?<![\\w-])${escapeRe(v)}(?![\\w-])` : escapeRe(v)));
  const re = new RegExp(alts.join('|'), 'g');
  patterns.set(r, { size: r.values.size, re });
  return re;
}

/**
 * Replace every secret value with the marker in one pass, so a secret that is part of the marker ("redact") does not
 * break a marker already put in for a longer one.
 */
export function scrub(text: string, r: Redactor): string {
  if (!r.values.size || !text) return text;
  return text.replace(patternOf(r), REDACTED);
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

/** Parse `data:` lines of an SSE body into JSON messages; lines end in CRLF, LF or a lone CR (the SSE grammar). */
export function parseSseMessages(text: string): unknown[] {
  const out: unknown[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch { /* not JSON */ }
  }
  return out;
}

/**
 * Whether a response id answers request id `id`: the same value, or the same number written as a string, which the SDK
 * client also accepts (it matches responses by Number(id)).
 */
export function idMatches(responseId: unknown, id: unknown): boolean {
  if (responseId === id) return true;
  return typeof id === 'number' && typeof responseId === 'string' && responseId.trim() !== '' && Number(responseId) === id;
}

const isResponseTo = (m: unknown, id: unknown): boolean =>
  !!m && typeof m === 'object' && idMatches((m as { id?: unknown }).id, id) && ('result' in (m as object) || 'error' in (m as object));

/**
 * Watches an SSE body for the JSON-RPC response with `id`, parsing only complete events. Line ends are normalised as
 * they arrive (a CR that ends a chunk may be the first half of a CRLF), and only the new text is searched for an event
 * end, so a large event split over many chunks is not rescanned on every chunk.
 */
function sseResponseWatcher(id: unknown): (chunk: string) => boolean {
  let buf = '';
  let skipLf = false;
  return (chunk) => {
    let c = skipLf && chunk.startsWith('\n') ? chunk.slice(1) : chunk;
    skipLf = c.endsWith('\r');
    c = c.replace(/\r\n?/g, '\n');
    let from = Math.max(0, buf.length - 1);
    buf += c;
    let hit = false;
    for (let end = buf.indexOf('\n\n', from); end >= 0; end = buf.indexOf('\n\n', from)) {
      if (!hit && parseSseMessages(buf.slice(0, end)).some((m) => isResponseTo(m, id))) hit = true;
      buf = buf.slice(end + 2);
      from = 0;
    }
    return hit;
  };
}

export interface BodyRead {
  text: string;
  /** More than `cap` bytes arrived; `text` holds the first `cap` (or a little more). */
  truncated: boolean;
  timedOut: boolean;
  /** Stopped after the SSE response with the request id arrived, before the stream ended. */
  stoppedAtResponse: boolean;
  /** The body ended. */
  done: boolean;
}

/**
 * Read a response body up to `cap` bytes or `timeoutMs`. For an SSE response to a JSON-RPC request
 * (`rpcId` set), stop as soon as the matching response event arrives: some servers keep the stream open.
 * `drainTo`: past `cap`, keep reading (without keeping the bytes) up to this many, to see when the response ends.
 */
async function readBody(res: Response, timeoutMs: number, cap = READ_CAP, rpcId?: unknown, drainTo = cap): Promise<BodyRead> {
  const out: BodyRead = { text: '', truncated: false, timedOut: false, stoppedAtResponse: false, done: false };
  if (!res.body) { out.done = true; return out; }
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
      if (r.done) { out.done = true; break; }
      if (!out.truncated) chunks.push(r.value);
      size += r.value.byteLength;
      if (watch?.(decoder.decode(r.value, { stream: true }))) { out.stoppedAtResponse = true; break; }
      if (size >= cap) out.truncated = true;
      if (size >= Math.max(cap, drainTo)) break;
    }
  } catch { /* aborted */ }
  clearTimeout(handle);
  reader.cancel().catch(() => {});
  out.text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return out;
}

/** Where the last SSE event in a chunk ends (after its blank line), or -1; an event split across chunks is missed, which only delays the reset. */
function lastEventEnd(chunk: Uint8Array): number {
  const b = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return Math.max(...(['\n\n', '\r\r', '\r\n\r\n'] as const).map((sep) => { const i = b.lastIndexOf(sep); return i < 0 ? -1 : i + sep.length; }));
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * The response handed to the SDK, whose body errors once it passes `cap` bytes (on an SSE stream: within one event),
 * so a hostile server cannot make the SDK buffer and parse an unbounded answer. The SDK reports the error as a failed
 * request. `url` and `redirected` are kept (the SSE client reads them).
 */
export function capBody(res: Response, cap: number): Response {
  if (!res.body || NULL_BODY_STATUS.has(res.status)) return res;
  const perEvent = /text\/event-stream/i.test(res.headers.get('content-type') ?? '');
  let size = 0;
  const limited = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      size += chunk.byteLength;
      if (perEvent) { const end = lastEventEnd(chunk); if (end >= 0) size = chunk.byteLength - end; }
      if (size > cap) ctrl.error(new Error(`response body exceeded ${cap} bytes`));
      else ctrl.enqueue(chunk);
    },
  }));
  const out = new Response(limited, { status: res.status, statusText: res.statusText, headers: res.headers });
  Object.defineProperties(out, { url: { value: res.url }, redirected: { value: res.redirected } });
  return out;
}

/** A parsed body (one message or a batch) holds a result for request `id`. */
function hasResultFor(json: unknown, id: unknown): boolean {
  return (Array.isArray(json) ? json : [json]).some((m) => !!m && typeof m === 'object' && idMatches((m as { id?: unknown }).id, id) && 'result' in m);
}

function parseBody(text: string, contentType: string | undefined, requestJson: unknown): unknown {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/event-stream')) {
    const msgs = parseSseMessages(text);
    const id = (requestJson as { id?: unknown } | undefined)?.id;
    const idOf = (m: unknown) => (m as { id?: unknown } | null)?.id;
    if (id === undefined) return msgs[0];
    return msgs.find((m) => idOf(m) === id) ?? msgs.find((m) => idMatches(idOf(m), id)) ?? msgs[0];
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
  };

  /**
   * SRV-010's sample: the time until the response to a JSON-RPC request arrived (not until its headers: an SSE answer
   * sends them at once), for a 2xx response that holds a result. A probe answered with an error or a redirect is not
   * a handshake or listing latency. `lowerBound`: a real call whose answer did not come within the read's own timeout
   * counts with the time waited.
   */
  const sample = (ex: HttpExchange, b: BodyRead, lowerBound: boolean) => {
    const { method, id } = (ex.requestJson ?? {}) as { method?: unknown; id?: unknown };
    if (typeof method !== 'string' || id === undefined || ex.bodyMs === undefined) return;
    if (ex.status === undefined || ex.status < 200 || ex.status > 299) return;
    const answered = (b.stoppedAtResponse || b.done) && (hasResultFor(ex.json, id) || (b.done && b.truncated));
    if (answered || (lowerBound && b.timedOut)) (timings[method] ??= []).push(ex.bodyMs);
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
      if (!res.body) return res;
      if (!isStream) {
        const clone = res.clone();
        const rpcId = (ex.requestJson as { id?: unknown } | undefined)?.id;
        // Past READ_CAP the copy is still read (not kept) to see when the response ends, for the latency sample.
        pending.push(readBody(clone, BODY_TIMEOUT_MS, READ_CAP, rpcId, rpcId === undefined ? READ_CAP : FULL_READ_CAP).then((b) => {
          ex.bodyMs = now() - started;
          finishBody(ex, b.text);
          sample(ex, b, true);
        }));
      }
      return capBody(res, FULL_READ_CAP); // after the clone: the copy for the record is read on its own
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
        sample(ex, body, false);
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
