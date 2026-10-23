// Helpers for raw JSON-RPC calls through the SDK Client (legacy 2025-11-25 era, stdio, SSE).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import type { JsonRpcObservation } from '../snapshot.js';
import { isObj } from '../rules/util/access.js';

export const LooseResult = z.looseObject({});

export async function rpc(client: Client, label: string, method: string, params: Record<string, unknown>, timeoutMs: number, now: () => number): Promise<JsonRpcObservation> {
  const started = now();
  const obs: JsonRpcObservation = { kind: 'jsonrpc', label, durationMs: 0 };
  try {
    obs.result = await client.request({ method, params } as never, LooseResult, { timeout: timeoutMs });
  } catch (e) {
    const err = e as Error & { code?: unknown; data?: unknown };
    if (e instanceof McpError) {
      obs.error = { code: err.code, message: err.message.replace(/^MCP error -?\d+: /, ''), data: err.data };
      if (err.code === -32001 && /timed out/i.test(err.message)) obs.transportError = err.message; // RequestTimeout
    } else {
      obs.transportError = `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`;
    }
  }
  obs.durationMs = now() - started;
  return obs;
}

export async function listAll(client: Client, method: string, key: string, timeoutMs: number, maxPages = 100): Promise<{ items: Record<string, unknown>[]; pages: unknown[]; error?: string }> {
  const items: Record<string, unknown>[] = [];
  const pages: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    let res: Record<string, unknown>;
    try {
      res = await client.request({ method, params: cursor ? { cursor } : {} } as never, LooseResult, { timeout: timeoutMs });
    } catch (e) {
      return { items, pages, error: (e as Error).message };
    }
    pages.push(res);
    const list = res[key];
    if (Array.isArray(list)) items.push(...list.map((x) => (isObj(x) ? x : { name: x })));
    const next = res.nextCursor;
    if (typeof next !== 'string' || !next) return { items, pages };
    if (seen.has(next)) return { items, pages, error: 'repeated cursor' };
    seen.add(next);
    cursor = next;
  }
  return { items, pages, error: `more than ${maxPages} pages` };
}
