// Unit tests for src/protocol/legacy.ts: listAll and rpc over a fake SDK client, no process or network (F156).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { listAll, rpc } from '../src/protocol/legacy.js';

type Req = { method: string; params: Record<string, unknown> };
const fake = (answer: (r: Req) => unknown) => {
  const calls: Req[] = [];
  const client = { request: async (r: Req) => { calls.push(r); return answer(r); } } as unknown as Client;
  return { client, calls };
};

describe('listAll', () => {
  it('follows nextCursor, sends the cursor back as params.cursor and collects every page', async () => {
    const pages: Record<string, unknown> = { '': { tools: [{ name: 'a' }], nextCursor: 'c1' }, c1: { tools: [{ name: 'b' }] } };
    const { client, calls } = fake((r) => pages[(r.params.cursor as string) ?? '']);
    const l = await listAll(client, 'tools/list', 'tools', 1000);
    expect(l).toEqual({ items: [{ name: 'a' }, { name: 'b' }], pages: [pages[''], pages.c1] });
    expect(calls.map((c) => c.params)).toEqual([{}, { cursor: 'c1' }]);
  });

  it('a request that throws ends the listing with its message and keeps the pages read before', async () => {
    const { client } = fake((r) => {
      if (r.params.cursor) throw new Error('connection closed');
      return { prompts: [{ name: 'p' }], nextCursor: 'next' };
    });
    expect(await listAll(client, 'prompts/list', 'prompts', 1000)).toMatchObject({ items: [{ name: 'p' }], error: 'connection closed' });
  });

  it('a server that cycles its cursor or never stops is cut off', async () => {
    expect((await listAll(fake(() => ({ tools: [], nextCursor: 'same' })).client, 'tools/list', 'tools', 1000)).error).toBe('repeated cursor');
    let n = 0;
    const endless = fake(() => ({ tools: [], nextCursor: `c${n++}` })).client;
    expect((await listAll(endless, 'tools/list', 'tools', 1000, 3)).error).toBe('more than 3 pages');
  });
});

describe('rpc', () => {
  const clock = () => { let t = 0; return () => (t += 5); };

  it('a JSON-RPC error is kept with its code, without the SDK "MCP error -N:" prefix', async () => {
    const { client } = fake(() => { throw new McpError(-32601, 'Method not found'); });
    const o = await rpc(client, 'unknownMethod', 'x/y', {}, 1000, clock());
    expect(o).toMatchObject({ kind: 'jsonrpc', label: 'unknownMethod', error: { code: -32601, message: 'Method not found' }, durationMs: 5 });
    expect(o.transportError).toBeUndefined();
  });

  it('an SDK request timeout and a non-MCP exception are transport errors', async () => {
    const timeout = await rpc(fake(() => { throw new McpError(-32001, 'Request timed out'); }).client, 't', 'x', {}, 1000, clock());
    expect(timeout.transportError).toMatch(/timed out/);
    const closed = await rpc(fake(() => { throw new TypeError('socket hang up'); }).client, 't', 'x', {}, 1000, clock());
    expect(closed).toMatchObject({ transportError: 'TypeError: socket hang up' });
    expect(closed.error).toBeUndefined();
  });

  it('a result is recorded as is', async () => {
    expect((await rpc(fake(() => ({ ok: true })).client, 't', 'x', {}, 1000, clock())).result).toEqual({ ok: true });
  });
});
