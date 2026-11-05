import { describe, expect, it } from 'vitest';
import { SRV_015 } from '../src/rules/server.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, snap } from './helpers.js';

const URL_OK = 'https://mcp.acme.test/mcp';
const TASKS = 'io.modelcontextprotocol/tasks';
const modern = (set?: (s: Snapshot) => void) => snap({
  url: URL_OK,
  set: (s) => {
    s.era = 'modern';
    s.protocolVersion = '2026-07-28';
    s.capabilities = { tools: {} };
    s.initializeRaw = undefined;
    s.discoverRaw = { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: s.capabilities, ttlMs: 1000, cacheScope: 'public' };
    s.transport.modernResults = [{ method: 'server/discover', result: s.discoverRaw }];
    set?.(s);
  },
});
const setCaps = (s: Snapshot, caps: Record<string, unknown>) => {
  s.capabilities = caps;
  (s.discoverRaw as Record<string, unknown>).capabilities = caps;
};

describe('A04-05 SRV-015 reads the 2026-07-28 tasks extension', () => {
  it('a modern server that declares io.modelcontextprotocol/tasks gets the "uses tasks" note', () => {
    const f = evaluate(SRV_015, modern((s) => setCaps(s, { tools: {}, extensions: { [TASKS]: {} } })));
    expect(f.map((x) => x.message)).toEqual(['uses tasks']);
  });

  it('a dual-era server that declares the extension only in server/discover is noted too', () => {
    const f = evaluate(SRV_015, modern((s) => {
      s.era = 'dual';
      s.capabilities = { tools: {} };
      s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: s.serverInfo };
      (s.discoverRaw as Record<string, unknown>).capabilities = { tools: {}, extensions: { [TASKS]: {} } };
    }));
    expect(f.map((x) => x.message)).toEqual(['uses tasks']);
  });

  it('the 2025-11-25 capabilities.tasks is still noted; an inherited key or no tasks is not', () => {
    expect(evaluate(SRV_015, snap({ set: (s) => { s.capabilities = { tools: {}, tasks: {} }; } })).map((x) => x.message)).toEqual(['uses tasks']);
    const inherited = Object.create({ [TASKS]: {} }) as Record<string, unknown>;
    expect(evaluate(SRV_015, modern((s) => setCaps(s, { tools: {}, extensions: inherited })))).toEqual([]);
    expect(evaluate(SRV_015, modern())).toEqual([]);
  });
});
