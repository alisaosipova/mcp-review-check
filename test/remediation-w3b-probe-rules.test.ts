// Regression tests for the W3B-probe-rules remediation (review 2026-11-01, wave 3): probes, server/apps rules, locations.
import { describe, expect, it } from 'vitest';
import type { ModernClient, ModernRequestOptions } from '../src/protocol/modern.js';
import { runWireProbes } from '../src/probe/wire.js';
import { capSnapshot, HTML_CAP } from '../src/limits.js';
import { APPS_014 } from '../src/rules/apps.js';
import { SRV_018 } from '../src/rules/server.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, exchange, snap, tool } from './helpers.js';

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

describe('R027: APPS-014 does not claim a missing connect() in a widget cut at HTML_CAP', () => {
  const URI = 'ui://acme/board.html';
  const widget = (html: string): Snapshot => snap({
    tools: [tool({ name: 'show_board', _meta: { ui: { resourceUri: URI } } })],
    resources: [{ uri: URI, name: 'board', mimeType: 'text/html;profile=mcp-app' }],
    set: (s) => { s.resourceReads[URI] = { ok: true, durationMs: 5, raw: { contents: [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: html }] } }; },
  });
  const head = '<!doctype html><script>import { App } from "@modelcontextprotocol/ext-apps"; const app = new App();';

  it('a single-file bundle whose app.connect() lies past the cap gets no "never calls connect()"', () => {
    const s = widget(`${head}${'x'.repeat(HTML_CAP)}app.connect();</script>`);
    capSnapshot(s);
    expect(s.limits?.truncated.map((t) => t.where)).toContain(`UI resource ${URI}`);
    expect(evaluate(APPS_014, s).map((f) => f.message)).toEqual([]);
  });

  it('an uncut widget without connect() is still reported', () => {
    const s = widget(`${head}</script>`);
    capSnapshot(s);
    expect(evaluate(APPS_014, s).map((f) => f.message)).toEqual(['uses the ext-apps App but never calls connect()']);
  });
});

describe('C003-followup: SRV-018 counts every non-JSON-RPC line, not only the kept ones', () => {
  it('uses transport.stdio.nonJsonTotal and names JSON-RPC', () => {
    const kept = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const s = snap({ set: (x) => { x.transport.stdio = { nonJsonStdout: kept, nonJsonTotal: 1200, stderrTail: '' }; } });
    expect(evaluate(SRV_018, s).map((f) => f.message)).toEqual(['1200 non-JSON-RPC line(s) on stdout: "line 0", "line 1", "line 2"']);
  });

  it('falls back to the kept lines when the total is missing (older snapshots)', () => {
    const s = snap({ set: (x) => { x.transport.stdio = { nonJsonStdout: ['banner'], stderrTail: '' }; } });
    expect(evaluate(SRV_018, s).map((f) => f.message)).toEqual(['1 non-JSON-RPC line(s) on stdout: "banner"']);
  });
});
