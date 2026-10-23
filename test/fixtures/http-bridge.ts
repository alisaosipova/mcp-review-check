// In-process node:http server bridging Streamable HTTP (or legacy SSE) to an SDK server through
// InMemoryTransport. Switches let tests produce specific wire-level defects.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

type AnyServer = { connect(t: InMemoryTransport): Promise<void> };
type Msg = Record<string, unknown> & { id?: string | number; method?: string };

export interface BridgeOptions {
  path?: string;
  wrongContentType?: boolean;
  notification200?: boolean;
  redirectTo?: string;
  invalidHost?: boolean;
  /** 403 for Origin https://claude.ai and https://chatgpt.com (overly strict). */
  strictOrigin?: boolean;
  /** 403 for any Origin not in the allowlist (the correct behavior). */
  rejectForeignOrigin?: boolean;
  sessionId?: () => string;
  sseOnly?: boolean;
  /** Require `Authorization: Bearer <token>`; otherwise 401 with `challenge`. */
  bearer?: string;
  challenge?: string;
}

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26'];
const ALLOWED_ORIGINS = ['https://claude.ai', 'https://chatgpt.com'];

interface Session {
  client: InMemoryTransport;
  waiters: Map<unknown, (m: Msg) => void>;
  sse?: ServerResponse;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export function createBridgeHandler(factory: () => AnyServer, opts: BridgeOptions = {}) {
  const path = opts.path ?? '/mcp';
  const sessions = new Map<string, Session>();

  const open = async (id: string): Promise<Session> => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    const s: Session = { client, waiters: new Map() };
    client.onmessage = (m) => {
      const msg = m as unknown as Msg;
      if (s.sse) { s.sse.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`); return; }
      if (msg.id !== undefined && !msg.method) s.waiters.get(msg.id)?.(msg);
    };
    await factory().connect(server);
    await client.start();
    sessions.set(id, s);
    return s;
  };

  const forward = (s: Session, msg: Msg): Promise<Msg> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('bridge timeout')), 10000);
      s.waiters.set(msg.id, (m) => { clearTimeout(t); s.waiters.delete(msg.id); resolve(m); });
      void s.client.send(msg as never);
    });

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (opts.invalidHost) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Invalid Host header'); return; }
    if (url.pathname === path && opts.redirectTo) { res.writeHead(301, { location: opts.redirectTo }); res.end(); return; }
    const origin = req.headers.origin;
    if (origin && opts.strictOrigin) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Forbidden origin'); return; }
    if (origin && opts.rejectForeignOrigin && !ALLOWED_ORIGINS.includes(origin)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Forbidden origin'); return; }
    if (opts.bearer && req.headers.authorization !== `Bearer ${opts.bearer}` && (url.pathname === path || url.pathname === '/messages')) {
      json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, opts.challenge ? { 'www-authenticate': opts.challenge } : {});
      return;
    }

    // Legacy HTTP+SSE mode
    if (opts.sseOnly) {
      if (url.pathname === path && req.method === 'GET') {
        const id = randomUUID();
        const s = await open(id);
        s.sse = res;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`event: endpoint\ndata: /messages?sessionId=${id}\n\n`);
        req.on('close', () => sessions.delete(id));
        return;
      }
      if (url.pathname === '/messages' && req.method === 'POST') {
        const s = sessions.get(url.searchParams.get('sessionId') ?? '');
        if (!s) { res.writeHead(404); res.end(); return; }
        await s.client.send(JSON.parse(await readBody(req)));
        res.writeHead(202); res.end('Accepted');
        return;
      }
      res.writeHead(url.pathname === path ? 405 : 404); res.end();
      return;
    }

    if (url.pathname !== path) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    if (req.method === 'GET') { res.writeHead(405, { allow: 'POST, DELETE' }); res.end(); return; }
    if (req.method === 'DELETE') { sessions.delete(String(req.headers['mcp-session-id'])); res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    let msg: Msg;
    try { msg = JSON.parse(await readBody(req)); } catch { json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const pv = req.headers['mcp-protocol-version'];
    if (typeof pv === 'string' && !SUPPORTED.includes(pv)) {
      json(res, 400, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32000, message: `Unsupported protocol version: ${pv}` } });
      return;
    }
    let sid = req.headers['mcp-session-id'] as string | undefined;
    let s = sid ? sessions.get(sid) : undefined;
    if (msg.method === 'initialize' && !sid) {
      sid = opts.sessionId ? opts.sessionId() : randomUUID();
      s = await open(sid);
    }
    if (!s) { json(res, sid ? 404 : 400, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32000, message: 'Bad Request: No valid session ID provided' } }); return; }
    const headers = { 'mcp-session-id': sid! };
    if (msg.id === undefined || msg.method === undefined) {
      await s.client.send(msg as never);
      if (opts.notification200) json(res, 200, { ok: true }, headers);
      else { res.writeHead(202, headers); res.end(); }
      return;
    }
    const reply = await forward(s, msg);
    if (opts.wrongContentType) { res.writeHead(200, { ...headers, 'content-type': 'text/plain' }); res.end(JSON.stringify(reply)); return; }
    json(res, 200, reply, headers);
  };
}

export interface Started {
  url: string;
  base: string;
  port: number;
  close(): Promise<void>;
}

export async function listen(handler: (req: IncomingMessage, res: ServerResponse) => unknown, path = '/mcp'): Promise<Started> {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((e) => { if (!res.headersSent) res.writeHead(500); res.end(String(e)); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  return {
    url: `${base}${path}`, base, port,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

export async function startBridge(factory: () => AnyServer, opts: BridgeOptions = {}): Promise<Started> {
  return listen(createBridgeHandler(factory, opts), opts.path ?? '/mcp');
}
