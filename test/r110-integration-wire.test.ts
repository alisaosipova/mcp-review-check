// 1.1.0 integration (Q5 note 1): connect.ts tells runWireProbes whether the server stalled (`stalled` in the context)
// instead of leaving wire.ts to work it out again, on stdio and on HTTP, and decides it with wire.ts's listingTimedOut
// rather than its own copy of the timeout regexes.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WireContext } from '../src/probe/wire.js';
import { tool } from './helpers.js';

const contexts: WireContext[] = [];
vi.mock('../src/probe/wire.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/probe/wire.js')>();
  return { ...real, runWireProbes: (ctx: WireContext) => { contexts.push(ctx); return real.runWireProbes(ctx); } };
});
const { buildSnapshot, stalled } = await import('../src/connect.js');

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { contexts.length = 0; await Promise.all(closers.splice(0).map((c) => c())); });

/** A stateless 2025-11-25 Streamable HTTP server on 127.0.0.1 with one tool. */
async function serve(): Promise<string> {
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status: number, payload?: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(payload === undefined ? '' : JSON.stringify(payload)); };
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
      let m: { id?: unknown; method?: string } = {};
      try { m = JSON.parse(body); } catch { /* not JSON */ }
      if (m.id === undefined) { res.writeHead(202); res.end(); return; }
      if (m.method === 'initialize') return send(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'wire', version: '1.0.0' } } });
      if (m.method === 'tools/list') return send(200, { jsonrpc: '2.0', id: m.id, result: { tools: [tool({ name: 'search_notes' })] } });
      return send(200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
}

describe('connect.ts passes `stalled` to runWireProbes', () => {
  it('stdio, a server that answers: stalled is false and given', async () => {
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: [fixture('good-server.mjs')] }, timeoutMs: 20000 });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toHaveProperty('stalled', false);
    expect(stalled(snap)).toBe(false);
  }, 60000);

  it('stdio, a server that stops answering after initialize: stalled is true and given', async () => {
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: [fixture('hang-server.mjs')] }, timeoutMs: 1000 });
    expect(stalled(snap)).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toHaveProperty('stalled', true);
  }, 60000);

  it('Streamable HTTP: stalled is given', async () => {
    const url = await serve();
    await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 20000 });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toHaveProperty('stalled', false);
  }, 60000);
});

describe('one copy of the listing-timeout regexes', () => {
  it('connect.ts imports listingTimedOut from probe/wire.ts and defines no timeout regex of its own', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/connect.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/import \{[^}]*\blistingTimedOut\b[^}]*\} from '\.\/probe\/wire\.js'/);
    expect(src).not.toMatch(/Request timed out\\b/);
    expect(src).not.toMatch(/This operation was aborted/);
  });
});
