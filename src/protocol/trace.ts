// Tracing fetch wrapper: records every HTTP exchange (redacted) for the rules.
import { createHash } from 'node:crypto';
import type { HttpExchange, JsonRpcSummary, NotificationLog } from '../snapshot.js';
import { budgetLeft, charge, type ByteBudget } from '../limits.js';
import { displayUrl } from '../rules/util/net.js';

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

/**
 * A recorded URL: the known secret values first (as written, before the URL is re-serialised), then what displayUrl
 * masks by form: userinfo, secret-named query and fragment parameters, known-format tokens in any query value or path
 * segment (a PRM, authorization server or redirect URL the run did not get from the user).
 */
export function redactUrl(raw: string, r: Redactor): string {
  return scrub(displayUrl(scrub(raw, r)), r);
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
  /** Bytes read, kept or not. */
  bytes: number;
  /** The snapshot byte budget ran out during this read: `text` holds what fitted, and reading stopped there. */
  budgetExhausted: boolean;
}

/**
 * Read a response body up to `cap` bytes or `timeoutMs`. For an SSE response to a JSON-RPC request
 * (`rpcId` set), stop as soon as the matching response event arrives: some servers keep the stream open.
 * `drainTo`: past `cap`, keep reading (without keeping the bytes) up to this many, to see when the response ends.
 */
async function readBody(res: Response, timeoutMs: number, cap = READ_CAP, rpcId?: unknown, drainTo = cap, budget?: ByteBudget): Promise<BodyRead> {
  const out: BodyRead = { text: '', truncated: false, timedOut: false, stoppedAtResponse: false, done: false, bytes: 0, budgetExhausted: false };
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
      if (!out.truncated) {
        // The kept bytes count against the run's budget (F146): the chunk that crosses it is cut there, and the read ends.
        const left = budgetLeft(budget);
        if (!charge(budget, r.value.byteLength)) {
          if (left > 0) chunks.push(r.value.subarray(0, left));
          size += r.value.byteLength;
          out.budgetExhausted = true;
          break;
        }
        chunks.push(r.value);
      }
      size += r.value.byteLength;
      if (watch?.(decoder.decode(r.value, { stream: true }))) { out.stoppedAtResponse = true; break; }
      if (size >= cap) out.truncated = true;
      if (size >= Math.max(cap, drainTo)) break;
    }
  } catch { /* aborted */ }
  clearTimeout(handle);
  reader.cancel().catch(() => {});
  out.bytes = size;
  out.text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return out;
}

/** Where the last SSE event in a chunk ends (after its blank line), or -1; an event split across chunks is missed, which only delays the reset. */
function lastEventEnd(chunk: Uint8Array): number {
  const b = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return Math.max(...(['\n\n', '\r\r', '\r\n\r\n'] as const).map((sep) => { const i = b.lastIndexOf(sep); return i < 0 ? -1 : i + sep.length; }));
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** The error a request or an SDK response fails with once the snapshot byte budget is spent (F146). */
export const BUDGET_ERROR = 'snapshot budget exhausted';

/**
 * The response handed to the SDK, whose body errors once it passes `cap` bytes (on an SSE stream: within one event),
 * so a hostile server cannot make the SDK buffer and parse an unbounded answer. The SDK reports the error as a failed
 * request. `url` and `redirected` are kept (the SSE client reads them). With `budget`, every chunk the SDK gets counts
 * against the run's byte budget, and the body errors once that runs out (F146).
 */
export function capBody(res: Response, cap: number, budget?: ByteBudget): Response {
  if (!res.body || NULL_BODY_STATUS.has(res.status)) return res;
  const perEvent = /text\/event-stream/i.test(res.headers.get('content-type') ?? '');
  let size = 0;
  const limited = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      size += chunk.byteLength;
      if (perEvent) { const end = lastEventEnd(chunk); if (end >= 0) size = chunk.byteLength - end; }
      if (size > cap) ctrl.error(new Error(`response body exceeded ${cap} bytes`));
      else if (!charge(budget, chunk.byteLength)) ctrl.error(new Error(BUDGET_ERROR));
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

/**
 * The first SNIPPET characters of a body with its secrets masked, scrubbing only a prefix of the body (up to 64 MiB).
 * Masked before the cut, so no secret prefix is left: a secret cut at the end of the scrubbed prefix stays in its last
 * 3 × longest + 13 characters (a 4-character value grows into the 10-character marker), so that much is kept past the
 * snippet, and the prefix doubles while secrets longer than the marker shrink it below that.
 */
export function snippetOf(text: string, r: Redactor): string {
  if (!r.values.size) return text.slice(0, SNIPPET);
  const margin = 3 * Math.max(...[...r.values].map((v) => v.length)) + REDACTED.length + 3;
  for (let len = SNIPPET + margin; ; len *= 2) {
    if (len >= text.length) return scrub(text, r).slice(0, SNIPPET);
    const s = scrub(text.slice(0, len), r);
    if (s.length >= SNIPPET + margin) return s.slice(0, SNIPPET);
  }
}

const ERROR_DATA_CAP = 4096;

/** The JSON-RPC responses (with a result or an error) in a parsed body, without the results: what collectErrors and
 *  the handshake checks read once the body itself is not kept (F036). */
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function summarizeJsonRpc(json: unknown, keepResult = false): JsonRpcSummary[] | undefined {
  const out: JsonRpcSummary[] = [];
  for (const m of Array.isArray(json) ? json : [json]) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const o = m as Record<string, unknown>;
    const err = o.error !== null && typeof o.error === 'object' && !Array.isArray(o.error) ? (o.error as Record<string, unknown>) : undefined;
    if (!err && !('result' in o)) continue;
    const s: JsonRpcSummary = {};
    if ('id' in o) s.id = o.id;
    if ('result' in o) {
      s.result = true;
      // What the rules read of a probe's result, so the result itself need not be kept (rpcView, SPEC-008/009).
      const r = o.result;
      if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
        const ro = r as Record<string, unknown>;
        const info: NonNullable<JsonRpcSummary['resultInfo']> = {};
        if (typeof ro.isError === 'boolean') info.isError = ro.isError;
        if (Array.isArray(ro.contents)) info.contents = ro.contents.length;
        if (Object.keys(info).length) s.resultInfo = info;
      }
      if (keepResult) s.resultValue = o.result;
    }
    if ('method' in o) s.method = true;
    if (err) {
      s.error = { code: err.code, message: err.message };
      // error.data is small in practice (SPEC-001 reads data.supported); an oversized one is not kept.
      if (err.data !== undefined && JSON.stringify(err.data)?.length <= ERROR_DATA_CAP) s.error.data = err.data;
    }
    out.push(s);
  }
  return out.length ? out : undefined;
}

/** SHA-256 of the kept body text; over the masked text when a known secret value occurs in it, so the digest of a
 *  body that is little more than the secret cannot confirm a guess. */
function bodyDigest(text: string, r: Redactor): string {
  const masked = [...r.values].some((v) => text.includes(v)) ? scrub(text, r) : text;
  return createHash('sha256').update(masked, 'utf8').digest('hex');
}

function errorInfo(err: unknown): HttpExchange['error'] {
  const e = err as Error & { code?: string | number; cause?: { code?: string } };
  return { name: e?.name ?? 'Error', code: e?.code, causeCode: e?.cause?.code, message: String(e?.message ?? err) };
}

/** RFC 5424 levels of MCP logging (https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging). */
export const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
const NOTIFICATION_METHOD_CAP = 20;

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
  /**
   * `keepJson`: keep the parsed body on `exchange.json` (default: the tracer's `keepJson`). The parsed body is returned
   * as `json` either way, once: the caller stores what it needs (F036).
   */
  request(label: string, url: string | URL, init?: RequestInit & { timeoutMs?: number; abortAfterHeaders?: boolean; fullBody?: boolean; keepJson?: boolean; keepResult?: boolean }): Promise<{ exchange: HttpExchange; response?: Response; bodyBytes?: number; json?: unknown }>;
  /** Server notifications seen in the bodies read so far (method names and counts, capped, redacted). */
  notifications: NotificationLog;
  flush(): Promise<void>;
  now(): number;
}

export interface TracerOptions {
  /** Keep every parsed body on its exchange (`exchange.json`). Default true, as before 0.4.0; buildSnapshot passes
   *  false and keeps it only where the rules read it (F036). */
  keepJson?: boolean;
  /** The run's byte budget (F146): the bodies read here and the responses handed to the SDK count against it. */
  budget?: ByteBudget;
}

/**
 * `stop` (the --max-duration deadline or the spent byte budget): once it aborts, nothing more is sent and probes in
 * flight are cancelled.
 */
export function createTracer(redactor: Redactor, now: () => number = () => performance.now(), stop?: AbortSignal, opts: TracerOptions = {}): Tracer {
  const keepByDefault = opts.keepJson ?? true;
  const budget = opts.budget;
  const exchanges: HttpExchange[] = [];
  const timings: Record<string, number[]> = {};
  const pending: Promise<unknown>[] = [];
  const notifications: NotificationLog = { methods: {} };

  /** Tally the notifications (messages with a method and no id) of a response body: names and counts only. */
  const noteNotifications = (ex: HttpExchange, text: string) => {
    let msgs: unknown[] = [];
    if (/event-stream/i.test(ex.contentType ?? '')) msgs = parseSseMessages(text);
    else { try { const j = JSON.parse(text.trim()); msgs = Array.isArray(j) ? j : [j]; } catch { /* not JSON */ } }
    const req = (ex.requestJson ?? {}) as { params?: { _meta?: Record<string, unknown> } };
    const meta = req.params?._meta ?? {};
    const modern = meta['io.modelcontextprotocol/protocolVersion'] === '2026-07-28';
    for (const m of msgs) {
      if (!isPlainObject(m) || typeof m.method !== 'string' || 'id' in m) continue;
      const name = scrub(m.method.slice(0, 100), redactor);
      if (name in notifications.methods || Object.keys(notifications.methods).length < NOTIFICATION_METHOD_CAP) notifications.methods[name] = (notifications.methods[name] ?? 0) + 1;
      else notifications.otherMethods = (notifications.otherMethods ?? 0) + 1;
      if (m.method === 'notifications/message') {
        const log = (notifications.message ??= { total: 0, unrequested: 0, invalidLevel: 0 });
        log.total++;
        if (modern && meta['io.modelcontextprotocol/logLevel'] === undefined) log.unrequested++;
        const level = isPlainObject(m.params) ? m.params.level : undefined;
        if (typeof level !== 'string' || !LOG_LEVELS.includes(level)) log.invalidLevel++;
      }
    }
  };

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
  const sample = (ex: HttpExchange, b: BodyRead, json: unknown, lowerBound: boolean) => {
    const { method, id } = (ex.requestJson ?? {}) as { method?: unknown; id?: unknown };
    if (typeof method !== 'string' || id === undefined || ex.bodyMs === undefined) return;
    if (ex.status === undefined || ex.status < 200 || ex.status > 299) return;
    const answered = (b.stoppedAtResponse || b.done) && (hasResultFor(json, id) || (b.done && b.truncated));
    if (answered || (lowerBound && b.timedOut)) (timings[method] ??= []).push(ex.bodyMs);
  };

  /**
   * The exchange keeps the masked snippet, the size, a digest and a summary of the JSON-RPC responses; the parsed body
   * goes back to the caller once and stays on the exchange only with `keep` (F036).
   */
  const finishBody = (ex: HttpExchange, b: BodyRead, keep: boolean, keepResult = false): unknown => {
    ex.bodySnippet = snippetOf(b.text, redactor);
    ex.bodyBytes = b.bytes;
    ex.bodySha256 = bodyDigest(b.text, redactor);
    const json = parseBody(b.text, ex.contentType, ex.requestJson);
    noteNotifications(ex, b.text);
    const rpc = summarizeJsonRpc(json, keepResult);
    if (rpc) ex.jsonRpc = rpc;
    if (json !== undefined) ex.jsonParsed = true;
    // An OAuth error body ({"error": "invalid_grant"}, RFC 6749 5.2), which AUTH-021 reads without the body.
    if (isPlainObject(json) && typeof json.error === 'string') ex.oauthError = json.error.slice(0, 200);
    if (keep) ex.json = json;
    return json;
  };

  const sdkFetch: FetchLike = async (url, init) => {
    const method = (() => { try { return JSON.parse(String(init?.body)).method as string; } catch { return undefined; } })();
    const ex = begin(method ? `sdk ${method}` : `sdk ${(init?.method ?? 'GET').toUpperCase()}`, url, init);
    exchanges.push(ex);
    const started = now();
    try {
      // Past the deadline the SDK sends nothing (a fetch with an aborted signal rejects before it connects); a request
      // already in flight is left to its client (the deadline closes the main one).
      if (budget?.exhausted) throw new Error(BUDGET_ERROR);
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
          sample(ex, b, finishBody(ex, b, keepByDefault), true);
        }));
      }
      // After the clone: the copy for the record is read on its own and not charged (the SDK's copy is).
      return capBody(res, FULL_READ_CAP, budget);
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
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs); // not AbortSignal.timeout: the timeout checks expect an AbortError
    const signal = stop ? AbortSignal.any([ctrl.signal, stop]) : ctrl.signal;
    // Tracer-only options are not passed to fetch.
    const { timeoutMs: _timeoutMs, abortAfterHeaders, fullBody, keepJson, keepResult, ...fetchInit } = init;
    // The byte budget is spent: nothing more is read, so nothing more is sent (F146).
    if (budget?.exhausted) {
      clearTimeout(timeout);
      ex.error = { name: 'SnapshotBudget', message: `${BUDGET_ERROR}: request not sent` };
      return { exchange: ex };
    }
    try {
      const res = await fetch(url, { redirect: 'manual', ...fetchInit, signal });
      finishHeaders(ex, res, started);
      let bodyBytes: number | undefined;
      let json: unknown;
      // A JSON answer is not a stream: read it (capped) so callers can see a JSON-RPC error; only streams are cut after the headers.
      if (abortAfterHeaders && !/^application\/json\b/i.test(res.headers.get('content-type') ?? '')) {
        res.body?.cancel().catch(() => {});
        ctrl.abort();
        ex.bodySnippet = '';
      } else {
        const rpcId = (ex.requestJson as { id?: unknown } | undefined)?.id;
        const body = fullBody
          ? await readBody(res, Math.max(0, timeoutMs - (now() - started)), FULL_READ_CAP, rpcId, FULL_READ_CAP, budget)
          : await readBody(res, Math.min(timeoutMs, BODY_TIMEOUT_MS), READ_CAP, rpcId, READ_CAP, budget);
        ex.bodyMs = now() - started;
        json = finishBody(ex, body, keepJson ?? keepByDefault, keepResult);
        sample(ex, body, json, false);
        bodyBytes = body.bytes;
        if (body.budgetExhausted) ex.error = { name: 'SnapshotBudget', message: `${BUDGET_ERROR}: response body cut after ${Buffer.byteLength(body.text)} bytes` };
        else if (fullBody && body.truncated) ex.error = { name: 'BodyTruncated', message: `response body exceeded ${FULL_READ_CAP} bytes and was truncated` };
        else if (fullBody && (body.timedOut || signal.aborted) && json === undefined) ex.error = { name: 'BodyTimeout', message: `response body not complete after ${timeoutMs} ms` };
      }
      return { exchange: ex, response: res, bodyBytes, json };
    } catch (err) {
      ex.durationMs = now() - started;
      ex.error = errorInfo(err);
      return { exchange: ex };
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    exchanges, timings, redactor, fetch: sdkFetch, request, now, notifications,
    flush: async () => { await Promise.allSettled(pending.splice(0)); },
  };
}
