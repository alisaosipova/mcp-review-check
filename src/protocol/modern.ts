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
}

const NAME_PARAM: Record<string, 'name' | 'uri'> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
  'resources/subscribe': 'uri',
  'resources/unsubscribe': 'uri',
};

/** The Mcp-Name header value a 2026-07-28 request must carry (params.name or params.uri), if any. */
export function mcpNameOf(method: string, params: Record<string, unknown>): string | undefined {
  const key = NAME_PARAM[method];
  const v = key ? params[key] : undefined;
  if (typeof v !== 'string') return undefined;
  // Header values must be ByteStrings: percent-encode anything outside visible ASCII and space.
  return v.replace(/[^\x20-\x7E]/gu, (c) => encodeURIComponent(c));
}

export class ModernClient {
  private nextId = 1;
  readonly results: Array<{ method: string; result: unknown }> = [];

  constructor(
    private url: URL, private tracer: Tracer, private headers: Record<string, string>, private timeoutMs = 30000,
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
   *  budgets: the listing's and, with `budget`, the run's). */
  async listAll(method: string, key: string, maxPages = 100, budget?: ByteBudget): Promise<Listing> {
    return paginate(async (cursor) => {
      const r = await this.request(method, cursor ? { cursor } : {});
      if (r.result) return { result: r.result, bytes: r.bytes ?? 0 };
      return { error: r.idMismatch ?? (r.error ? `${String(r.error.code)} ${String(r.error.message)}` : r.exchange.error?.message ?? noResponse(r.exchange.status, method)), bytes: 0 };
    }, method, key, maxPages, budget);
  }
}
