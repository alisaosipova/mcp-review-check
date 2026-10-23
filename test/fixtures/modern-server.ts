// Raw 2026-07-28 ("modern", stateless) MCP server. The good variant follows the Cloudflare shape.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { listen, type Started } from './http-bridge.js';

export interface ModernOptions {
  /** Missing ttlMs, cacheScope differs across pages, sessions minted. */
  bad?: boolean;
  /** Extra tools on the first tools/list page (each about 1 KB) to exceed the 256 KB probe read cap. */
  extraTools?: number;
}

const VERSION = '2026-07-28';

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
    if (msg.method === 'initialize' || version !== VERSION) return err(400, -32022, 'Unsupported protocol version', { supported: [VERSION] });
    const mh = req.headers['mcp-method'];
    if (mh !== msg.method) return err(400, -32020, 'Mcp-Method header does not match the request body');
    // Like Context7 and Hugging Face: requests that name a tool or resource must repeat it in Mcp-Name.
    const named = msg.method === 'tools/call' ? msg.params?.name : msg.method === 'resources/read' ? msg.params?.uri : undefined;
    if (named !== undefined && req.headers['mcp-name'] !== named) return err(400, -32020, `the body carries ${String(named)} but the required Mcp-Name header is absent or different`);
    const cache = (scope = 'public') => (opts.bad ? { resultType: 'complete', cacheScope: scope } : { resultType: 'complete', ttlMs: 60000, cacheScope: scope });
    const ok = (result: Record<string, unknown>) => send(200, { jsonrpc: '2.0', id, result });
    switch (msg.method) {
      case 'server/discover':
        return ok({
          ...cache(), supportedVersions: [VERSION], capabilities: { tools: {}, resources: {} },
          instructions: 'Search the Acme documentation.',
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'acme-docs', title: 'Acme Docs', version: '2.0.0' } },
        });
      case 'tools/list': {
        const page = msg.params?.cursor === 'p2' ? 1 : 0;
        const extra = page === 0 ? Array.from({ length: opts.extraTools ?? 0 }, (_, i) => ({ ...TOOLS[0], name: `search_docs_${i}`, description: `${TOOLS[0].description} `.repeat(10).trim() })) : [];
        return ok({ ...cache(opts.bad && page === 1 ? 'private' : 'public'), tools: [TOOLS[page], ...extra], ...(page === 0 ? { nextCursor: 'p2' } : {}) });
      }
      case 'resources/list':
        return ok({ ...cache(), resources: [] });
      case 'resources/templates/list':
        return ok({ ...cache(), resourceTemplates: [] });
      case 'resources/read':
        return err(200, -32602, `Resource not found: ${String(msg.params?.uri)}`);
      case 'tools/call': {
        const name = msg.params?.name;
        if (!TOOLS.some((t) => t.name === name)) return err(200, -32602, `Unknown tool: ${String(name)}`);
        return ok({ resultType: 'complete', content: [{ type: 'text', text: 'ok' }] });
      }
      default:
        return err(404, -32601, `Method not found: ${String(msg.method)}`);
    }
  };
  return listen(handler);
}
