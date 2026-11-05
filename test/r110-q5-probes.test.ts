// mcp-review-check 1.1.0, package Q5 (probes): after a stall (tools/list timed out after initialize) the wire probes
// wait the short STALLED_TIMEOUT_MS; a timed-out Origin or challenge probe is then not retried, so it costs one short
// wait, not two (review P2 follow-up of A10-02). Without a stall a timed-out attempt is still retried once.
import { describe, expect, it } from 'vitest';
import type { Tracer } from '../src/protocol/trace.js';
import { challengeProbe, requestWithRetry } from '../src/probe/network.js';
import { listingTimedOut, runWireProbes } from '../src/probe/wire.js';
import type { HttpExchange } from '../src/snapshot.js';
import { loadSnapshot } from './helpers.js';

/** A tracer whose every request times out; it records the labels it was asked for. */
function timingOut(): { tracer: Tracer; labels: string[] } {
  const labels: string[] = [];
  const request = async (label: string, url: string | URL, init?: { method?: string }) => {
    labels.push(label);
    const exchange = { label, method: init?.method ?? 'GET', url: String(url), requestHeaders: {}, ms: 2000, error: { name: 'TimeoutError', message: 'timed out' } } as unknown as HttpExchange;
    return { exchange };
  };
  return { tracer: { request, exchanges: [] } as unknown as Tracer, labels };
}
const noWait = async () => {};
const URL_ = new URL('https://mcp.acme.test/mcp');

describe('A10-02 follow-up: a timed-out challenge probe after a stall costs one short wait', () => {
  it('requestWithRetry retries a timeout once by default and not with retryTimeout: false', async () => {
    const a = timingOut();
    expect(await requestWithRetry(a.tracer, 'x', URL_, { method: 'GET', timeoutMs: 2000 }, noWait)).toHaveLength(2);
    const b = timingOut();
    expect(await requestWithRetry(b.tracer, 'x', URL_, { method: 'GET', timeoutMs: 2000 }, noWait, { retryTimeout: false })).toHaveLength(1);
    const c = timingOut();
    await challengeProbe(c.tracer, URL_, 2000, noWait, { retryTimeout: false });
    expect(c.labels).toEqual(['challenge']);
  });

  it('runWireProbes sends the Origin and challenge probes once each after a stall, and retries them without one', async () => {
    const stalled = loadSnapshot('minimal-http');
    stalled.listMeta.tools = { pages: 0, rawPages: [], error: 'MCP error -32001: Request timed out' };
    const s = timingOut();
    await runWireProbes({ snap: stalled, timeoutMs: 2000, now: () => 0, sleep: noWait, http: { tracer: s.tracer, url: URL_, authHeaders: {} } });
    expect(s.labels.filter((l) => l.startsWith('challenge'))).toEqual(['challenge']);
    expect(s.labels.filter((l) => l.startsWith('origin') && !l.includes('close session'))).toEqual(['origin (none)', 'origin claude.ai', 'origin chatgpt.com', 'origin evil']);

    const healthy = timingOut();
    await runWireProbes({ snap: loadSnapshot('minimal-http'), timeoutMs: 2000, now: () => 0, sleep: noWait, http: { tracer: healthy.tracer, url: URL_, authHeaders: {} } });
    expect(healthy.labels.filter((l) => l.startsWith('challenge'))).toEqual(['challenge', 'challenge (retry 1)']);

    // The caller's explicit flag wins over what the snapshot says.
    const told = timingOut();
    await runWireProbes({ snap: loadSnapshot('minimal-http'), timeoutMs: 2000, now: () => 0, sleep: noWait, stalled: true, http: { tracer: told.tracer, url: URL_, authHeaders: {} } });
    expect(told.labels.filter((l) => l.startsWith('challenge'))).toEqual(['challenge']);
  });

  it('listingTimedOut recognises the legacy and the 2026-07-28 listing timeouts only', () => {
    expect(listingTimedOut('MCP error -32001: Request timed out')).toBe(true);
    expect(listingTimedOut('This operation was aborted')).toBe(true);
    expect(listingTimedOut('response body not complete after 2000 ms')).toBe(true);
    expect(listingTimedOut('MCP error -32601: Method not found')).toBe(false);
    expect(listingTimedOut('This operation was aborted early')).toBe(false);
    expect(listingTimedOut(undefined)).toBe(false);
  });
});
