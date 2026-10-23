// B3: the MCP Apps client capability the linter declares (pure parts; R-5). Moved here from limits.test.ts so that
// each test file has one slice that owns it.
import { describe, expect, it } from 'vitest';
import { CLIENT_CAPABILITIES, TEXT_ONLY_CAPABILITIES } from '../src/protocol/clientCaps.js';
import { ModernClient } from '../src/protocol/modern.js';
import type { Tracer } from '../src/protocol/trace.js';
import { initializeBody } from '../src/probe/network.js';
import { exchange } from './helpers.js';

describe('MCP Apps capability (B3)', () => {
  const UI = { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } };

  it('is declared in raw initialize probes and in 2026-07-28 _meta clientCapabilities', async () => {
    expect(CLIENT_CAPABILITIES).toEqual({ extensions: UI });
    expect(initializeBody().params.capabilities).toEqual({ extensions: UI });
    const bodies: any[] = [];
    const tracer = { request: async (_l: string, _u: unknown, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return { exchange: exchange({ status: 200 }) }; } } as unknown as Tracer;
    await new ModernClient(new URL('https://a.test/mcp'), tracer, {}).request('tools/list');
    await new ModernClient(new URL('https://a.test/mcp'), tracer, {}, 1000, TEXT_ONLY_CAPABILITIES).request('tools/list');
    expect(bodies[0].params._meta['io.modelcontextprotocol/clientCapabilities']).toEqual({ extensions: UI });
    expect(bodies[1].params._meta['io.modelcontextprotocol/clientCapabilities']).toEqual({});
  });
});
