// Helpers for raw JSON-RPC calls through the SDK Client (legacy 2025-11-25 era, stdio, SSE).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import type { JsonRpcObservation } from '../snapshot.js';
import { isObj } from '../rules/util/access.js';
import type { ByteBudget } from '../limits.js';
import { BUDGET_ERROR } from './trace.js';

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

export interface Listing { items: Record<string, unknown>[]; pages: unknown[]; error?: string }

/** One page of a list method: the result, or why there is none; `bytes`: the page's size, for the listing budget. */
export interface ListPage { result?: Record<string, unknown>; error?: string; bytes: number }

/** Bytes one listing may take over all its pages (one page alone may be as large): past it the listing stops with an error. */
export const LIST_BYTE_BUDGET = 64 * 1024 * 1024;

/**
 * Follow nextCursor up to `maxPages` (both eras). A listing fails, keeping what it read, on a repeated cursor, a
 * nextCursor that is not a string, entries that are not objects (a host's schema check rejects such a result, so it
 * cannot list either) and past LIST_BYTE_BUDGET bytes, so a hostile server cannot fill the memory page by page.
 * With the run's `budget` (F146): no page is asked for once it is spent, and a page fetched while it ran out (its read
 * cut, so no result) ends the listing with that reason.
 */
export async function paginate(fetchPage: (cursor: string | undefined) => Promise<ListPage>, method: string, key: string, maxPages = 100, budget?: ByteBudget): Promise<Listing> {
  const items: Record<string, unknown>[] = [];
  const pages: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let bytes = 0;
  let nonObjects = 0;
  const done = (error?: string): Listing => {
    const bad = nonObjects ? `${nonObjects} ${key} ${nonObjects === 1 ? 'entry is' : 'entries are'} not objects` : undefined;
    const e = [error, bad].filter(Boolean).join('; ');
    return e ? { items, pages, error: e } : { items, pages };
  };
  for (let i = 0; i < maxPages; i++) {
    if (budget?.exhausted) return done(BUDGET_ERROR);
    const page = await fetchPage(cursor);
    if (!page.result) return done(budget?.exhausted ? BUDGET_ERROR : page.error ?? `${method} returned no result`);
    bytes += page.bytes;
    if (bytes > LIST_BYTE_BUDGET) return done(`listing exceeded ${LIST_BYTE_BUDGET} bytes`);
    pages.push(page.result);
    const list = page.result[key];
    // One push per entry: spreading a page of 100k+ entries into push() overflows the call stack.
    if (Array.isArray(list)) for (const x of list) { if (isObj(x)) items.push(x); else nonObjects++; }
    const next = page.result.nextCursor;
    if (next === undefined || next === null || next === '') return done();
    if (typeof next !== 'string') return done(`nextCursor is not a string (got ${Array.isArray(next) ? 'array' : typeof next})`);
    if (seen.has(next)) return done('repeated cursor');
    seen.add(next);
    cursor = next;
  }
  return done(`more than ${maxPages} pages`);
}

/** A list method through the SDK client; a page's size is measured as its JSON text. The SDK's transport charges the
 *  pages to the run's `budget` as it reads them (capBody, the stdio reader); here a spent budget ends the listing. */
export async function listAll(client: Client, method: string, key: string, timeoutMs: number, maxPages = 100, budget?: ByteBudget): Promise<Listing> {
  return paginate(async (cursor) => {
    try {
      const result = await client.request({ method, params: cursor ? { cursor } : {} } as never, LooseResult, { timeout: timeoutMs });
      return { result, bytes: JSON.stringify(result).length };
    } catch (e) {
      return { error: (e as Error).message, bytes: 0 };
    }
  }, method, key, maxPages, budget);
}
