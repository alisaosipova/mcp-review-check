// Minimal manual 2026-07-28 JSON-RPC client (server/discover, lists, read).
import type { HttpExchange } from '../snapshot.js';
import type { Tracer } from './trace.js';
import { isObj } from '../rules/util/access.js';
import { VERSION } from '../version.js';
import { CLIENT_CAPABILITIES } from './clientCaps.js';

export const MODERN_VERSION = '2026-07-28';
export const CLIENT_INFO = { name: 'mcp-review-check', version: VERSION };

export interface ModernResponse {
  exchange: HttpExchange;
  result?: Record<string, unknown>;
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

export interface ModernRequestOptions {
  label?: string;
  version?: string;
  /** undefined → method name; null → omit header; string → send this value. */
  methodHeader?: string | null;
  /** undefined → derived from params (name or uri, see mcpNameOf); null → omit header; string → send this value. */
  nameHeader?: string | null;
  timeoutMs?: number;
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
          'io.modelcontextprotocol/clientCapabilities': this.capabilities,
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
    const { exchange } = await this.tracer.request(opts.label ?? `modern ${method}`, this.url, {
      method: 'POST', headers, body: JSON.stringify(body), timeoutMs: opts.timeoutMs ?? this.timeoutMs, fullBody: true,
    });
    const msg = Array.isArray(exchange.json) ? exchange.json.find((m) => isObj(m) && m.id === id) : exchange.json;
    const res: ModernResponse = { exchange };
    if (isObj(msg)) {
      if (isObj(msg.result)) {
        res.result = msg.result;
        if (exchange.status === 200) this.results.push({ method, result: msg.result });
      }
      if (isObj(msg.error)) res.error = msg.error;
    }
    return res;
  }

  /** Follow nextCursor up to `maxPages`; detects repeated cursors. */
  async listAll(method: string, key: string, maxPages = 100): Promise<{ items: Record<string, unknown>[]; pages: unknown[]; error?: string }> {
    const items: Record<string, unknown>[] = [];
    const pages: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const r = await this.request(method, cursor ? { cursor } : {});
      if (!r.result) return { items, pages, error: r.error ? `${String(r.error.code)} ${String(r.error.message)}` : r.exchange.error?.message ?? `HTTP ${r.exchange.status}` };
      pages.push(r.result);
      const list = r.result[key];
      if (Array.isArray(list)) items.push(...list.filter(isObj));
      const next = r.result.nextCursor;
      if (typeof next !== 'string' || !next) return { items, pages };
      if (seen.has(next)) return { items, pages, error: 'repeated cursor' };
      seen.add(next);
      cursor = next;
    }
    return { items, pages, error: `more than ${maxPages} pages` };
  }
}
