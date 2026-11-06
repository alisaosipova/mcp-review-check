// Minimal manual 2026-07-28 JSON-RPC client (server/discover, lists, read).
import type { HttpExchange } from '../snapshot.js';
import { idMatches, type Tracer } from './trace.js';
import { isObj } from '../rules/util/access.js';
import { VERSION } from '../version.js';
import { CLIENT_CAPABILITIES } from './clientCaps.js';
import { paginate, type Listing } from './legacy.js';
import type { ByteBudget } from '../limits.js';

/** A listing request answered without a JSON-RPC response: a 2xx says what was missing, rather than a bare "HTTP 200". */
const noResponse = (status: number | undefined, method: string) =>
  status !== undefined && status >= 200 && status < 300 ? `HTTP ${status} without a JSON-RPC response to ${method}` : `HTTP ${status}`;

export const MODERN_VERSION = '2026-07-28';
export const CLIENT_INFO = { name: 'mcp-review-check', version: VERSION };

export interface ModernResponse {
  exchange: HttpExchange;
  result?: Record<string, unknown>;
  error?: { code?: unknown; message?: unknown; data?: unknown };
  /** The response answered another request id: its result is not taken (a real client cannot match it). */
  idMismatch?: string;
  /** Size of the response body in bytes. */
  bytes?: number;
}

export interface ModernRequestOptions {
  label?: string;
  version?: string;
  /** undefined → method name; null → omit header; string → send this value. */
  methodHeader?: string | null;
  /** undefined → derived from params (name or uri, see mcpNameOf); null → omit header; string → send this value. */
  nameHeader?: string | null;
  timeoutMs?: number;
  /**
   * Default true: the result is needed, so the body is read up to 64 MiB within the whole timeout. false (a probe that
   * only looks at the status and the error): the probes' 256 KB and 10 s cap, so a server that keeps an SSE stream open
   * without answering costs at most 10 s.
   */
  fullBody?: boolean;
  /** Keep the parsed body on the exchange (a wire probe the rules read through rpcView); default: the tracer's choice. */
  keepJson?: boolean;
  /** Read the status line and headers only, then close (a long-lived stream such as subscriptions/listen). */
  abortAfterHeaders?: boolean;
  /** Client capabilities for this request instead of the client's own. */
  capabilities?: Record<string, unknown>;
  /** More request headers (the Mcp-Param-{Name} headers of a tools/call); the protocol headers above win. */
  extraHeaders?: Record<string, string>;
}

const NAME_PARAM: Record<string, 'name' | 'uri'> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
  'resources/subscribe': 'uri',
  'resources/unsubscribe': 'uri',
};

const SENTINEL_START = '=?base64?';
const SENTINEL_END = '?=';

/**
 * A value for Mcp-Name or Mcp-Param-{Name} (2026-07-28 streamable-http, Value Encoding): sent as is when it is plain
 * visible ASCII and space without leading or trailing whitespace, otherwise (non-ASCII, a control character or tab,
 * edge whitespace, or a plain value that already looks like the sentinel) as `=?base64?{UTF-8 Base64}?=`.
 */
export function encodeHeaderValue(v: string): string {
  const plain = /^[\x20-\x7E]*$/.test(v) && !/^\s|\s$/.test(v) && !(v.startsWith(SENTINEL_START) && v.endsWith(SENTINEL_END));
  return plain ? v : `${SENTINEL_START}${Buffer.from(v, 'utf8').toString('base64')}${SENTINEL_END}`;
}

/** The Mcp-Name header value a 2026-07-28 request must carry (params.name or params.uri), if any, encoded. */
export function mcpNameOf(method: string, params: Record<string, unknown>): string | undefined {
  const key = NAME_PARAM[method];
  const v = key ? params[key] : undefined;
  return typeof v === 'string' ? encodeHeaderValue(v) : undefined;
}

/** Depth cut-off for the properties chain walked for x-mcp-header. */
const MAX_HEADER_DEPTH = 32;

/**
 * The Mcp-Param-{Name} headers of a 2026-07-28 tools/call (streamable-http, Schema Extension and Client Behavior): for
 * each `x-mcp-header` on a plain `properties` chain of the input schema, the argument value at that path as a string
 * (string as is, integer in decimal, boolean lowercase), encoded by encodeHeaderValue. A missing or null value, or a
 * value of another JSON type, sends no header. Header names are lower-case, as Node records them.
 */
export function mcpParamHeaders(inputSchema: unknown, args: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (schema: unknown, value: unknown, depth: number) => {
    if (!isObj(schema) || !isObj(schema.properties) || depth > MAX_HEADER_DEPTH) return;
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (!isObj(sub)) continue;
      const v = isObj(value) && Object.prototype.hasOwnProperty.call(value, k) ? value[k] : undefined;
      const h = sub['x-mcp-header'];
      if (typeof h === 'string' && h) {
        const s = typeof v === 'string' ? v : typeof v === 'boolean' ? String(v) : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;
        if (s !== undefined) out[`mcp-param-${h.toLowerCase()}`] = encodeHeaderValue(s);
      }
      walk(sub, v, depth + 1);
    }
  };
  walk(inputSchema, args, 0);
  return out;
}

export class ModernClient {
  private nextId = 1;
  readonly results: Array<{ method: string; result: unknown }> = [];

  constructor(
    private url: URL, private tracer: Tracer, private headers: Record<string, string>,
    /** The wait for a request without its own `timeoutMs` (the wire probes get a shorter one after a stall). */
    public timeoutMs = 30000,
    private capabilities: Record<string, unknown> = CLIENT_CAPABILITIES,
  ) {}

  async request(method: string, params: Record<string, unknown> = {}, opts: ModernRequestOptions = {}): Promise<ModernResponse> {
    const version = opts.version ?? MODERN_VERSION;
    const id = this.nextId++;
    const meta = isObj(params._meta) ? params._meta : {};
    const body = {
      jsonrpc: '2.0', id, method,
      params: {
        ...params,
        _meta: {
          ...meta,
          'io.modelcontextprotocol/protocolVersion': version,
          'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
          'io.modelcontextprotocol/clientCapabilities': opts.capabilities ?? this.capabilities,
        },
      },
    };
    const headers: Record<string, string> = {
      ...this.headers,
      ...opts.extraHeaders,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': version,
    };
    const mh = opts.methodHeader === undefined ? method : opts.methodHeader;
    if (mh !== null) headers['mcp-method'] = mh;
    const nh = opts.nameHeader === undefined ? mcpNameOf(method, params) : opts.nameHeader;
    if (nh !== null && nh !== undefined) headers['mcp-name'] = nh;
    // The parsed body comes back once (F036): the result goes to the caller and to `results`, not onto the exchange.
    const { exchange, bodyBytes, json } = await this.tracer.request(opts.label ?? `modern ${method}`, this.url, {
      method: 'POST', headers, body: JSON.stringify(body), timeoutMs: opts.timeoutMs ?? this.timeoutMs, fullBody: opts.fullBody ?? true,
      ...(opts.keepJson !== undefined ? { keepJson: opts.keepJson } : {}),
      ...(opts.abortAfterHeaders ? { abortAfterHeaders: true } : {}),
    });
    const msgs = Array.isArray(json) ? json.filter(isObj) : isObj(json) ? [json] : [];
    // The response first: a server-to-client request in the same body may carry the same id (it has a method, no result);
    // a body of notifications alone holds no response (no id to mismatch).
    const isResp = (m: Record<string, unknown>) => 'result' in m || 'error' in m;
    const msg = msgs.find((m) => m.id === id && isResp(m)) ?? msgs.find((m) => idMatches(m.id, id) && isResp(m))
      ?? msgs.find((m) => m.id === id) ?? msgs.find((m) => idMatches(m.id, id)) ?? msgs.find(isResp);
    const res: ModernResponse = { exchange, bytes: bodyBytes };
    if (isObj(msg)) {
      // An error with id null (the request could not be read) answers any request; anything else must echo the id.
      const echoed = idMatches(msg.id, id) || (msg.id === null && isObj(msg.error));
      if (!echoed) res.idMismatch = `response id ${JSON.stringify(msg.id)} does not match request id ${id}`;
      if (echoed && isObj(msg.result)) {
        res.result = msg.result;
        if (exchange.status === 200) this.results.push({ method, result: msg.result });
      }
      if (isObj(msg.error)) res.error = msg.error;
    }
    return res;
  }

  /** Follow nextCursor up to `maxPages` (see paginate: repeated or non-string cursors, non-object entries, the byte
   *  budgets: the listing's and, with `budget`, the run's). Each page waits `timeoutMs` (default: the client's). */
  async listAll(method: string, key: string, maxPages = 100, budget?: ByteBudget, timeoutMs?: number): Promise<Listing> {
    return paginate(async (cursor) => {
      const r = await this.request(method, cursor ? { cursor } : {}, timeoutMs !== undefined ? { timeoutMs } : {});
      if (r.result) return { result: r.result, bytes: r.bytes ?? 0 };
      return { error: r.idMismatch ?? (r.error ? `${String(r.error.code)} ${String(r.error.message)}` : r.exchange.error?.message ?? noResponse(r.exchange.status, method)), bytes: 0 };
    }, method, key, maxPages, budget);
  }
}
