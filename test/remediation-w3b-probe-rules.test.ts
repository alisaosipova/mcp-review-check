// Regression tests for the W3B-probe-rules remediation (review 2026-11-01, wave 3): probes, server/apps rules, locations.
import { describe, expect, it } from 'vitest';
import type { ModernClient, ModernRequestOptions } from '../src/protocol/modern.js';
import { runWireProbes } from '../src/probe/wire.js';
import { exchange, snap } from './helpers.js';

describe('F025-wiring: the modern wire probes read the body under the probe cap', () => {
  it('passes fullBody: false to every modern.request probe', async () => {
    const seen: { method: string; opts?: ModernRequestOptions }[] = [];
    const modern = {
      async request(method: string, _params: unknown, opts?: ModernRequestOptions) {
        seen.push({ method, opts });
        return { exchange: exchange({ label: opts?.label ?? method, status: 400 }) };
      },
    } as unknown as ModernClient;
    const s = snap({ resources: [{ uri: 'file:///a', name: 'a' }], set: (x) => { x.era = 'modern'; } });
    await runWireProbes({ snap: s, timeoutMs: 1000, now: () => 0, modern });
    expect(seen.map((c) => c.opts?.label)).toEqual([
      'badVersion (modern)', 'unknownMethod (modern)', 'resourceMissing (modern)',
      'headerMismatch (none)', 'headerMismatch (wrong)', 'unknownTool (modern)',
    ]);
    for (const c of seen) expect(c.opts?.fullBody, c.opts?.label).toBe(false);
  });
});
