// Q4-SESSION (1.1.0): a run stopped by --max-duration or a signal ends the Streamable HTTP sessions the server issued
// (DELETE with the session id), best effort and bounded by SESSION_END_TIMEOUT_MS; a server without a session id gets
// no DELETE, and a regular run still ends each session exactly once.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, endAllNow, SESSION_END_TIMEOUT_MS } from '../src/connect.js';
import { tool } from './helpers.js';

type Seen = { method: string; session?: string; authorization?: string; protocolVersion?: string };
const servers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((c) => c())); });

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

interface Opts {
  /** The session id the server issues on initialize; none for a stateless server. */
  session?: string;
  /** tools/list is never answered (the run is stopped while waiting for it). */
  hangList?: boolean;
  /** The DELETE of an SDK session (one with the protocol version header) is never answered. */
  hangDelete?: boolean;
}

/** A 2025-11-25 Streamable HTTP server on 127.0.0.1 that records every request's method and session headers. */
async function serve(o: Opts): Promise<{ url: string; seen: Seen[]; listed: Promise<void> }> {
  const seen: Seen[] = [];
  let onList: () => void = () => {};
  const listed = new Promise<void>((r) => { onList = r; });
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({
        method: req.method!,
        session: req.headers['mcp-session-id'] as string | undefined,
        authorization: req.headers.authorization,
        protocolVersion: req.headers['mcp-protocol-version'] as string | undefined,
      });
      if (req.method === 'DELETE') { if (!o.hangDelete || !req.headers['mcp-protocol-version']) { res.writeHead(200); res.end(); } return; }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
      let m: { id?: unknown; method?: string } = {};
      try { m = JSON.parse(body); } catch { /* not JSON */ }
      if (m.id === undefined) { res.writeHead(202); res.end(); return; }
      if (m.method === 'server/discover') return json(res, 400, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
      if (m.method === 'initialize') {
        return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'q4', version: '1.0.0' } } },
          o.session ? { 'mcp-session-id': o.session } : {});
      }
      if (m.method === 'tools/list') {
        onList();
        if (o.hangList) return; // left unanswered
        return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { tools: [tool({ name: 'search_notes' })] } });
      }
      return json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`, seen, listed };
}

/** The DELETEs of the SDK connections' sessions. The preflight ends the probe session it opened itself (a DELETE
 *  without the protocol version header, before the handshake): that one is not counted. */
const deletes = (seen: Seen[]) => seen.filter((s) => s.method === 'DELETE' && s.protocolVersion);
const bearer = () => ['tok', 'SYNTH', 'q4session'].join('_');

describe('a --max-duration stop ends the Streamable HTTP session (Q4-SESSION)', () => {
  it('sends DELETE with the session id, the protocol version and the run\'s own credentials', async () => {
    const { url, seen } = await serve({ session: 'sess-q4-1', hangList: true });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, maxDurationMs: 1500, bearer: bearer() });
    expect(snap.limits?.stopped).toMatchObject({ maxDurationMs: 1500 });
    expect(deletes(seen)).toEqual([{ method: 'DELETE', session: 'sess-q4-1', authorization: `Bearer ${bearer()}`, protocolVersion: '2025-11-25' }]);
    // The stop's DELETE is no evidence for the rules: it is not in the snapshot.
    expect(snap.transport.exchanges.filter((e) => e.method === 'DELETE')).toEqual([]);
  }, 30000);

  it('sends no DELETE when the server issued no session id', async () => {
    const { url, seen } = await serve({ hangList: true });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, maxDurationMs: 1500 });
    expect(snap.limits?.stopped).toBeDefined();
    expect(seen.filter((s) => s.method === 'DELETE')).toEqual([]);
  }, 30000);

  it('a DELETE that is never answered holds the stop for at most SESSION_END_TIMEOUT_MS', async () => {
    const { url, seen } = await serve({ session: 'sess-q4-hang', hangList: true, hangDelete: true });
    const t0 = Date.now();
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, maxDurationMs: 1500 });
    const took = Date.now() - t0;
    expect(snap.limits?.stopped).toBeDefined();
    expect(deletes(seen).map((d) => d.session)).toEqual(['sess-q4-hang']);
    expect(took).toBeLessThan(1500 + SESSION_END_TIMEOUT_MS + 3000);
  }, 30000);

  it('a run that finishes ends its session once (the regular path), the stop path sends nothing more', async () => {
    const { url, seen } = await serve({ session: 'sess-q4-done' });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000, maxDurationMs: 60000 });
    expect(snap.limits?.stopped).toBeUndefined();
    const sessionDeletes = deletes(seen).filter((d) => d.session === 'sess-q4-done');
    // Every connection the run opened (main and fresh) got its own session id from this server: one DELETE each, and
    // never more DELETEs than initializes.
    const inits = seen.filter((s) => s.method === 'POST' && s.session === undefined).length;
    expect(sessionDeletes.length).toBeGreaterThanOrEqual(1);
    expect(sessionDeletes.length).toBeLessThanOrEqual(inits);
  }, 30000);
});

// Last in the file: endAllNow marks the process as exiting for the rest of it.
describe('the signal handler ends the open sessions (Q4-SESSION)', () => {
  it('endAllNow sends the DELETE of a session whose run is still waiting', async () => {
    const { url, seen, listed } = await serve({ session: 'sess-q4-signal', hangList: true });
    const run = buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 4000, maxDurationMs: 20000 });
    await listed;
    await endAllNow();
    expect(deletes(seen).map((d) => d.session)).toEqual(['sess-q4-signal']);
    await endAllNow(); // a second signal sends no second DELETE, nor does the run's own close when it gives up
    await run.catch(() => {});
    expect(deletes(seen)).toHaveLength(1);
  }, 30000);
});
