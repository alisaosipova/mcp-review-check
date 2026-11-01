// Unit tests for src/probe/wire.ts: which side-effect-free probes run for which snapshot, over fake clients (F156).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import type { ModernClient } from '../src/protocol/modern.js';
import { MISSING_RESOURCE, runWireProbes, sdkSessionGet, UNKNOWN_METHOD, UNKNOWN_TOOL } from '../src/probe/wire.js';
import { exchange, snap } from './helpers.js';

const now = () => 0;

function legacyClient() {
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = {
    request: async (r: { method: string; params: Record<string, unknown> }) => {
      sent.push(r);
      throw new McpError(r.method === UNKNOWN_METHOD ? -32601 : -32602, 'nope');
    },
  } as unknown as Client;
  return { client, sent };
}

function modernClient() {
  const sent: Array<{ method: string; opts: Record<string, unknown> }> = [];
  const modern = {
    request: async (method: string, _params: unknown, opts: Record<string, unknown>) => {
      sent.push({ method, opts });
      return { exchange: exchange({ label: String(opts.label) }) };
    },
  } as unknown as ModernClient;
  return { modern, sent };
}

describe('runWireProbes', () => {
  it('legacy client: unknown method and unknown tool; resources/read only when resources are advertised', async () => {
    const { client, sent } = legacyClient();
    const p = await runWireProbes({ snap: snap(), timeoutMs: 1000, now, client });
    expect(sent.map((r) => r.method)).toEqual([UNKNOWN_METHOD, 'tools/call']);
    expect(sent[1].params).toEqual({ name: UNKNOWN_TOOL, arguments: {} });
    expect(p.unknownMethod).toMatchObject({ error: { code: -32601 } });
    expect(p.resourceMissing).toBeUndefined();

    const withRes = legacyClient();
    const q = await runWireProbes({ snap: snap({ resources: [] }), timeoutMs: 1000, now, client: withRes.client });
    expect(withRes.sent.at(-1)).toEqual({ method: 'resources/read', params: { uri: MISSING_RESOURCE } });
    expect(q.resourceMissing).toMatchObject({ error: { code: -32602 } });
  });

  it('modern only: the header and version probes, and the unknown tool over the modern client', async () => {
    const { modern, sent } = modernClient();
    const p = await runWireProbes({ snap: snap({ set: (s) => { s.era = 'modern'; } }), timeoutMs: 1000, now, modern });
    expect(sent.map((r) => r.opts.label)).toEqual([
      'badVersion (modern)', 'unknownMethod (modern)', 'headerMismatch (none)', 'headerMismatch (wrong)', 'unknownTool (modern)',
    ]);
    expect(sent[0].opts.version).toBe('1900-01-01');
    expect(sent[2].opts.methodHeader).toBeNull();
    expect(sent[3].opts.methodHeader).toBe('prompts/list');
    expect(p.unknownTool).toMatchObject({ label: 'unknownTool (modern)' });
  });

  it('dual era: the legacy client keeps the unknown-tool probe', async () => {
    const legacy = legacyClient();
    const { modern, sent } = modernClient();
    const p = await runWireProbes({ snap: snap({ set: (s) => { s.era = 'dual'; } }), timeoutMs: 1000, now, client: legacy.client, modern });
    expect(sent.map((r) => r.method)).not.toContain('tools/call');
    expect(p.unknownTool).toMatchObject({ kind: 'jsonrpc' });
  });
});

describe('sdkSessionGet', () => {
  it('finds only the answered SDK GET of the same session', () => {
    const get = (over: Parameters<typeof exchange>[0]) => exchange({ label: 'sdk GET', method: 'GET', status: 200, requestHeaders: { 'mcp-session-id': 's1' }, ...over });
    const hit = get({});
    expect(sdkSessionGet([get({ status: undefined }), get({ requestHeaders: { 'mcp-session-id': 's2' } }), get({ label: 'get' }), hit], 's1')).toBe(hit);
    expect(sdkSessionGet([get({ status: undefined })], 's1')).toBeUndefined();
  });
});
