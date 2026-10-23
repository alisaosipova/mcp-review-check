// Side-effect-free protocol probes (§4.3).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ProbeObservation, Snapshot, WireProbeName } from '../snapshot.js';
import type { ModernClient } from '../protocol/modern.js';
import { rpc } from '../protocol/legacy.js';
import type { Tracer } from '../protocol/trace.js';
import { challengeProbe, JSON_HEADERS, originProbes } from './network.js';

export const UNKNOWN_METHOD = 'mcp-review-check/nonexistent';
export const UNKNOWN_TOOL = 'mcp_review_check_nonexistent_tool';
export const MISSING_RESOURCE = 'mcp-review-check://does-not-exist';

export interface WireContext {
  snap: Snapshot;
  timeoutMs: number;
  now: () => number;
  client?: Client; // legacy SDK client (any transport)
  modern?: ModernClient; // when era is modern or dual
  http?: {
    tracer: Tracer;
    url: URL;
    authHeaders: Record<string, string>;
    sessionId?: string;
    protocolVersion?: string;
  };
}

type Probes = Partial<Record<WireProbeName, ProbeObservation>>;

export async function runWireProbes(ctx: WireContext): Promise<Probes> {
  const { snap, timeoutMs, client, modern, http } = ctx;
  const p: Probes = {};
  const hasTools = snap.capabilities?.tools !== undefined || snap.tools.length > 0;
  const hasResources = snap.capabilities?.resources !== undefined;
  const modernOnly = snap.era === 'modern';

  if (client) {
    p.unknownMethod = await rpc(client, 'unknownMethod', UNKNOWN_METHOD, {}, timeoutMs, ctx.now);
    if (hasTools) p.unknownTool = await rpc(client, 'unknownTool', 'tools/call', { name: UNKNOWN_TOOL, arguments: {} }, timeoutMs, ctx.now);
    if (hasResources) p.resourceMissing = await rpc(client, 'resourceMissing', 'resources/read', { uri: MISSING_RESOURCE }, timeoutMs, ctx.now);
  }

  if (modern) {
    p.badVersionModern = (await modern.request('server/discover', {}, { version: '1900-01-01', label: 'badVersion (modern)' })).exchange;
    p.unknownMethodModern = (await modern.request(UNKNOWN_METHOD, {}, { label: 'unknownMethod (modern)' })).exchange;
    if (hasResources) p.resourceMissingModern = (await modern.request('resources/read', { uri: MISSING_RESOURCE }, { label: 'resourceMissing (modern)' })).exchange;
    p.headerMismatchNone = (await modern.request('tools/list', {}, { methodHeader: null, label: 'headerMismatch (none)' })).exchange;
    p.headerMismatchWrong = (await modern.request('tools/list', {}, { methodHeader: 'prompts/list', label: 'headerMismatch (wrong)' })).exchange;
    if (modernOnly && hasTools) p.unknownTool = (await modern.request('tools/call', { name: UNKNOWN_TOOL, arguments: {} }, { label: 'unknownTool (modern)' })).exchange;
  }

  if (http) {
    const { tracer, url, authHeaders } = http;
    const session: Record<string, string> = {};
    if (http.sessionId) session['mcp-session-id'] = http.sessionId;
    if (http.protocolVersion && !modernOnly) session['mcp-protocol-version'] = http.protocolVersion;
    if (snap.transport.kind === 'streamable-http') {
      p.get = (await tracer.request('get', url, {
        method: 'GET', headers: { ...authHeaders, ...session, accept: 'text/event-stream' }, abortAfterHeaders: true, timeoutMs: 5000,
      })).exchange;
    }
    if (snap.transport.kind === 'streamable-http' && !modernOnly) {
      p.badVersion = (await tracer.request('badVersion', url, {
        method: 'POST', headers: { ...authHeaders, ...JSON_HEADERS, ...session, 'mcp-protocol-version': '1900-01-01' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9001, method: 'tools/list', params: {} }), timeoutMs,
      })).exchange;
    }
    if (modernOnly) {
      p.delete = (await tracer.request('delete', url, { method: 'DELETE', headers: { ...authHeaders }, timeoutMs })).exchange;
    }
    if (snap.transport.kind !== 'sse') Object.assign(p, await originProbes(tracer, url, authHeaders, modernOnly, timeoutMs));
    p.challenge = await challengeProbe(tracer, url, timeoutMs);
  }
  return p;
}
