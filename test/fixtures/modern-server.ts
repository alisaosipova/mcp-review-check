// Raw 2026-07-28 ("modern", stateless) MCP server. The good variant follows the Cloudflare shape.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { listen, type Started } from './http-bridge.js';

export interface ModernOptions {
  /** Missing ttlMs, cacheScope differs across pages, sessions minted. */
  bad?: boolean;
  /** Extra tools on the first tools/list page (each about 1 KB) to exceed the 256 KB probe read cap. */
  extraTools?: number;
  /** Dual era: the same endpoint also answers 2025-11-25 clients (initialize, no 2026-07-28 version header). */
  dual?: boolean;
  /** Declare io.modelcontextprotocol/tasks: 'ok' answers tasks/get for an unknown taskId with -32602, 'missing' leaves the method unimplemented (-32601). */
  tasks?: 'ok' | 'missing';
  /** Declare tools.listChanged and answer subscriptions/listen with an open SSE stream ('sse') or a JSON body ('json'). */
  listen?: 'sse' | 'json' | 'rpcerror';
  /** tools/list streams a notifications/message before its result. `declared`: the server declares logging; `level`: the notification's level (default 'info'; null leaves it out). */
  logging?: { declared: boolean; level?: string | null };
  /** List two more read-only tools on the second page: get_forecast, whose `region` parameter has x-mcp-header
   *  "Region" (a tools/call must carry a matching Mcp-Param-Region), and a non-ASCII name (m\u00e9t\u00e9o). */
  headerTools?: boolean;
}

const VERSION = '2026-07-28';
const LEGACY_VERSION = '2025-11-25';
const ALLOWED_ORIGINS = ['https://claude.ai', 'https://chatgpt.com'];

const TOOLS = [
  {
    name: 'search_docs', title: 'Search docs',
    description: 'Search the Acme documentation by keyword and return matching page titles and links.',
    inputSchema: { type: 'object', properties: { keywords: { type: 'string', description: 'Words to search for' }, limit: { type: 'integer', description: 'Max results' } }, required: ['keywords'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_page', title: 'Get page',
    description: 'Get one documentation page by its id and return the page text in Markdown.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string', description: 'Page id' }, fields: { type: 'array', items: { type: 'string' }, description: 'Fields to include' } }, required: ['page_id'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

const HEADER_TOOLS = [
  {
    name: 'get_forecast', description: 'Get the weather forecast for a region and a city.',
    inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' }, city: { type: 'string' } }, required: ['region', 'city'] },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'm\u00e9t\u00e9o', description: 'Get the weather for a city.',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
];

/** A Mcp-Name or Mcp-Param-{Name} value, decoded from the =?base64?...?= form as the 2026-07-28 spec requires. */
function decodeHeader(v: string | string[] | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^=\?base64\?(.*)\?=$/s.exec(v);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startModernServer(opts: ModernOptions = {}): Promise<Started> {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.bad) headers['mcp-session-id'] = randomUUID();
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/mcp') { res.writeHead(404); return res.end(); }
    const origin = req.headers.origin;
    if (opts.dual && origin && !ALLOWED_ORIGINS.includes(origin)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Forbidden origin'); return; }
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(opts.bad ? 200 : 405, opts.bad ? { 'content-type': 'text/plain' } : { allow: 'POST' });
      return res.end();
    }
    let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try { msg = JSON.parse(await readBody(req)); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const id = msg.id ?? null;
    const err = (status: number, code: number, message: string, data?: unknown) => send(status, { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
    const meta = (msg.params?._meta ?? {}) as Record<string, unknown>;
    const version = req.headers['mcp-protocol-version'] ?? meta['io.modelcontextprotocol/protocolVersion'];
    if (opts.dual && (msg.method === 'initialize' || version !== VERSION)) {
      if (msg.method === 'initialize' || version === undefined || version === LEGACY_VERSION) return legacy(msg, res);
      return err(400, -32022, 'Unsupported protocol version', { supported: [VERSION, LEGACY_VERSION] });
    }
    if (msg.method === 'initialize' || version !== VERSION) return err(400, -32022, 'Unsupported protocol version', { supported: [VERSION] });
    const mh = req.headers['mcp-method'];
    if (mh !== msg.method) return err(400, -32020, 'Mcp-Method header does not match the request body');
    // Like Context7 and Hugging Face: requests that name a tool or resource must repeat it in Mcp-Name.
    const named = msg.method === 'tools/call' ? msg.params?.name : msg.method === 'resources/read' ? msg.params?.uri : undefined;
    if (named !== undefined && decodeHeader(req.headers['mcp-name']) !== named) return err(400, -32020, `the body carries ${String(named)} but the required Mcp-Name header is absent or different`);
    const cache = (scope = 'public') => (opts.bad ? { resultType: 'complete', cacheScope: scope } : { resultType: 'complete', ttlMs: 60000, cacheScope: scope });
    // A conforming 2026-07-28 server identifies itself in every result (SPEC-022); opts.bad leaves it out.
    const SERVER_INFO = { 'io.modelcontextprotocol/serverInfo': { name: 'acme-docs', title: 'Acme Docs', version: '2.0.0' } };
    const ok = (result: Record<string, unknown>) => send(200, { jsonrpc: '2.0', id, result: opts.bad ? result : { ...result, _meta: { ...SERVER_INFO, ...(result._meta as object | undefined) } } });
    switch (msg.method) {
      case 'server/discover':
        return ok({
          ...cache(), supportedVersions: opts.dual ? [VERSION, LEGACY_VERSION] : [VERSION], capabilities: {
            tools: opts.listen ? { listChanged: true } : {}, resources: {},
            ...(opts.logging?.declared ? { logging: {} } : {}),
            ...(opts.tasks ? { extensions: { 'io.modelcontextprotocol/tasks': {} } } : {}),
          },
          instructions: 'Search the Acme documentation.',
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'acme-docs', title: 'Acme Docs', version: '2.0.0' } },
        });
      case 'subscriptions/listen': {
        if (!opts.listen) return err(404, -32601, 'Method not found: subscriptions/listen');
        if (opts.listen === 'rpcerror') return err(200, -32601, 'Method not found: subscriptions/listen');
        if (opts.listen === 'json') return ok({ resultType: 'complete' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { _meta: { 'io.modelcontextprotocol/subscriptionId': id }, notifications: { toolsListChanged: true } } })}\n\n`);
        return; // stays open until the client closes it
      }
      case 'tasks/get':
        if (opts.tasks !== 'ok') return err(404, -32601, 'Method not found: tasks/get');
        return err(200, -32602, `Unknown taskId: ${String(msg.params?.taskId)}`);
      case 'tools/list': {
        if (opts.logging && msg.params?.cursor === undefined) {
          const level = opts.logging.level === undefined ? 'info' : opts.logging.level;
          const note = { jsonrpc: '2.0', method: 'notifications/message', params: { ...(level === null ? {} : { level }), data: 'hello' } };
          const result = { jsonrpc: '2.0', id, result: { ...cache(), tools: [TOOLS[0]], nextCursor: 'p2', _meta: SERVER_INFO } };
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          return void res.end(`data: ${JSON.stringify(note)}\n\ndata: ${JSON.stringify(result)}\n\n`);
        }
        const page = msg.params?.cursor === 'p2' ? 1 : 0;
        const extra = page === 0 ? Array.from({ length: opts.extraTools ?? 0 }, (_, i) => ({ ...TOOLS[0], name: `search_docs_${i}`, description: `${TOOLS[0].description} `.repeat(10).trim() })) : [];
        const more = page === 1 && opts.headerTools ? HEADER_TOOLS : [];
        return ok({ ...cache(opts.bad && page === 1 ? 'private' : 'public'), tools: [TOOLS[page], ...extra, ...more], ...(page === 0 ? { nextCursor: 'p2' } : {}) });
      }
      case 'resources/list':
        return ok({ ...cache(), resources: [] });
      case 'resources/templates/list':
        return ok({ ...cache(), resourceTemplates: [] });
      case 'resources/read':
        return err(200, -32602, `Resource not found: ${String(msg.params?.uri)}`);
      case 'tools/call': {
        const name = msg.params?.name;
        const def = [...TOOLS, ...(opts.headerTools ? HEADER_TOOLS : [])].find((t) => t.name === name);
        if (!def) return err(200, -32602, `Unknown tool: ${String(name)}`);
        // Mcp-Param-{Name} must match the argument it mirrors (the header is absent when the argument is).
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        for (const [k, p] of Object.entries(def.inputSchema.properties as Record<string, Record<string, unknown>>)) {
          const h = p['x-mcp-header'];
          if (typeof h !== 'string') continue;
          const v = args[k];
          const sent = decodeHeader(req.headers[`mcp-param-${h.toLowerCase()}`]);
          if ((v === undefined || v === null) ? sent !== undefined : sent !== String(v)) return err(400, -32020, `Mcp-Param-${h} does not match argument ${k}`);
        }
        // The header tools validate their arguments and answer bad input with isError (the original tools do not).
        const missing = HEADER_TOOLS.some((t) => t === def) ? def.inputSchema.required.filter((r) => typeof args[r] !== 'string') : [];
        if (missing.length) return ok({ resultType: 'complete', content: [{ type: 'text', text: `invalid arguments: ${missing.join(', ')}` }], isError: true });
        return ok({ resultType: 'complete', content: [{ type: 'text', text: 'ok' }] });
      }
      default:
        return err(404, -32601, `Method not found: ${String(msg.method)}`);
    }
  };
  return listen(handler);
}

/** The 2025-11-25 side of a dual-era server: stateless JSON responses, same tools, no 2026-07-28 cache fields. */
function legacy(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }, res: ServerResponse): void {
  if (msg.id === undefined) { res.writeHead(202); return void res.end(); } // notifications
  const id = msg.id;
  const send = (body: Record<string, unknown>) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, ...body }));
  };
  switch (msg.method) {
    case 'initialize':
      return send({ result: {
        protocolVersion: LEGACY_VERSION, capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'acme-docs', title: 'Acme Docs', version: '2.0.0' }, instructions: 'Search the Acme documentation.',
      } });
    case 'ping':
      return send({ result: {} });
    case 'tools/list':
      return send({ result: { tools: TOOLS } });
    case 'resources/list':
      return send({ result: { resources: [] } });
    case 'resources/templates/list':
      return send({ result: { resourceTemplates: [] } });
    case 'resources/read':
      return send({ error: { code: -32602, message: `Resource not found: ${String(msg.params?.uri)}` } });
    case 'tools/call': {
      const name = msg.params?.name;
      if (!TOOLS.some((t) => t.name === name)) return send({ error: { code: -32602, message: `Unknown tool: ${String(name)}` } });
      return send({ result: { content: [{ type: 'text', text: 'ok' }] } });
    }
    default:
      return send({ error: { code: -32601, message: `Method not found: ${String(msg.method)}` } });
  }
}
