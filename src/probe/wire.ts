// Side-effect-free protocol probes (§4.3).
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { HttpExchange, ProbeObservation, Snapshot, WireProbeName } from '../snapshot.js';
import type { ModernClient } from '../protocol/modern.js';
import { rpc } from '../protocol/legacy.js';
import type { Tracer } from '../protocol/trace.js';
import { CLIENT_CAPABILITIES } from '../protocol/clientCaps.js';
import { challengeProbe, JSON_HEADERS, originProbes, sameHostRedirect } from './network.js';

export const UNKNOWN_METHOD = 'mcp-review-check/nonexistent';
export const UNKNOWN_TOOL = 'mcp_review_check_nonexistent_tool';
export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
export const MISSING_RESOURCE = 'mcp-review-check://does-not-exist';
/** Longest wait for the status line of a stream probe (GET, subscriptions/listen); a lower --timeout lowers it. */
export const STREAM_PROBE_MS = 5000;

export interface WireContext {
  snap: Snapshot;
  timeoutMs: number;
  now: () => number;
  client?: Client; // legacy SDK client (any transport)
  modern?: ModernClient; // when era is modern or dual
  /** Wait between retries of the HTTP probes (tests inject a no-op). */
  sleep?: (ms: number) => Promise<void>;
  http?: {
    tracer: Tracer;
    url: URL;
    authHeaders: Record<string, string>;
    sessionId?: string;
    protocolVersion?: string;
  };
  /** Where each probe lands as soon as it finishes (and the return value): a --max-duration stop keeps the finished
   *  probes. Default: a new object. */
  out?: Probes;
}

type Probes = Partial<Record<WireProbeName, ProbeObservation>>;

/** The answered GET the SDK client sent in session `sessionId` (its standalone SSE stream), if any. */
export function sdkSessionGet(exchanges: readonly HttpExchange[], sessionId: string): HttpExchange | undefined {
  return exchanges.find((e) => e.label === 'sdk GET' && e.method === 'GET' && e.status !== undefined && e.requestHeaders['mcp-session-id'] === sessionId);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** True when the initialize or the server/discover capabilities satisfy `test`. */
function declares(snap: Snapshot, test: (caps: Obj) => boolean): boolean {
  const sources = [snap.capabilities, isObj(snap.discoverRaw) ? snap.discoverRaw.capabilities : undefined];
  return sources.some((c) => isObj(c) && test(c));
}
/** A capability that makes subscriptions/listen worth opening: list_changed or resource subscriptions. */
const listens = (c: Obj) => ['tools', 'prompts', 'resources'].some((k) => isObj(c[k]) && (c[k] as Obj).listChanged === true) || (isObj(c.resources) && c.resources.subscribe === true);

export async function runWireProbes(ctx: WireContext): Promise<Probes> {
  const { snap, timeoutMs, client, modern, http } = ctx;
  const p: Probes = ctx.out ?? {};
  const hasTools = snap.capabilities?.tools !== undefined || snap.tools.length > 0;
  const hasResources = snap.capabilities?.resources !== undefined;
  const modernOnly = snap.era === 'modern';

  if (client) {
    p.unknownMethod = await rpc(client, 'unknownMethod', UNKNOWN_METHOD, {}, timeoutMs, ctx.now);
    if (hasTools) p.unknownTool = await rpc(client, 'unknownTool', 'tools/call', { name: UNKNOWN_TOOL, arguments: {} }, timeoutMs, ctx.now);
    if (hasResources) p.resourceMissing = await rpc(client, 'resourceMissing', 'resources/read', { uri: MISSING_RESOURCE }, timeoutMs, ctx.now);
  }

  if (modern) {
    // Only the status and the error object matter: read the body under the probes' 256 KB / 10 s cap (F025).
    // keepJson: SPEC rules read these probes through rpcView (src/rules/util/obs.ts), which parses exchange.json (F036).
    p.badVersionModern = (await modern.request('server/discover', {}, { version: '1900-01-01', label: 'badVersion (modern)', fullBody: false, keepJson: true })).exchange;
    p.unknownMethodModern = (await modern.request(UNKNOWN_METHOD, {}, { label: 'unknownMethod (modern)', fullBody: false, keepJson: true })).exchange;
    if (hasResources) p.resourceMissingModern = (await modern.request('resources/read', { uri: MISSING_RESOURCE }, { label: 'resourceMissing (modern)', fullBody: false, keepJson: true })).exchange;
    p.headerMismatchNone = (await modern.request('tools/list', {}, { methodHeader: null, label: 'headerMismatch (none)', fullBody: false, keepJson: true })).exchange;
    p.headerMismatchWrong = (await modern.request('tools/list', {}, { methodHeader: 'prompts/list', label: 'headerMismatch (wrong)', fullBody: false, keepJson: true })).exchange;
    // Read-only tasks probe: tasks/get with a random taskId that cannot exist changes nothing on the server. The client
    // declares the tasks extension for it, since a server answers a non-declaring client with -32021 (missing capability).
    if (declares(snap, (c) => isObj(c.extensions) && c.extensions[TASKS_EXTENSION] !== undefined)) {
      const caps = { ...CLIENT_CAPABILITIES, extensions: { ...CLIENT_CAPABILITIES.extensions, [TASKS_EXTENSION]: {} } };
      const taskId = `mcp-review-check-${randomUUID()}`;
      p.tasksGet = (await modern.request('tasks/get', { taskId }, { label: 'tasks/get (nonexistent)', fullBody: false, keepJson: true, capabilities: caps })).exchange;
    }
    // subscriptions/listen is the 2026-07-28 replacement for the GET stream: open it, read the status line and headers, close.
    if (declares(snap, listens)) {
      p.subscriptionsListen = (await modern.request('subscriptions/listen', { notifications: { toolsListChanged: true } }, { label: 'subscriptions/listen', abortAfterHeaders: true, fullBody: false, keepJson: true, timeoutMs: Math.min(timeoutMs, STREAM_PROBE_MS) })).exchange;
    }
    if (modernOnly && hasTools) p.unknownTool = (await modern.request('tools/call', { name: UNKNOWN_TOOL, arguments: {} }, { label: 'unknownTool (modern)', fullBody: false, keepJson: true })).exchange;
  }

  if (http) {
    const { tracer, authHeaders } = http;
    // The SDK client followed a same-host redirect of the entered URL; probe the URL it actually talks to.
    // SRV-006 still reports the redirect from the preflight exchange.
    const url = sameHostRedirect(http.url, snap.transport.preflight) ?? http.url;
    const session: Record<string, string> = {};
    if (http.sessionId) session['mcp-session-id'] = http.sessionId;
    if (http.protocolVersion && !modernOnly) session['mcp-protocol-version'] = http.protocolVersion;
    if (snap.transport.kind === 'streamable-http') {
      // The SDK client opens the session's standalone GET stream right after initialization, and a server may allow only
      // one per session (the TypeScript SDK answers a second one with 409). That GET is the observation: reuse it.
      const sdkGet = http.sessionId ? sdkSessionGet(tracer.exchanges, http.sessionId) : undefined;
      p.get = sdkGet ?? (await tracer.request('get', url, {
        method: 'GET', headers: { ...authHeaders, ...session, accept: 'text/event-stream' }, abortAfterHeaders: true, timeoutMs: Math.min(timeoutMs, STREAM_PROBE_MS),
      })).exchange;
    }
    if (snap.transport.kind === 'streamable-http' && !modernOnly) {
      p.badVersion = (await tracer.request('badVersion', url, {
        method: 'POST', headers: { ...authHeaders, ...JSON_HEADERS, ...session, 'mcp-protocol-version': '1900-01-01' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9001, method: 'tools/list', params: {} }), timeoutMs, keepJson: true,
      })).exchange;
    }
    if (modernOnly) {
      p.delete = (await tracer.request('delete', url, { method: 'DELETE', headers: { ...authHeaders }, timeoutMs })).exchange;
    }
    const originMode = snap.transport.kind === 'sse' ? 'sse' : modernOnly ? 'discover' : 'initialize';
    // Into `p` probe by probe: a stop between two Origin probes keeps the ones already made.
    await originProbes(tracer, url, authHeaders, originMode, timeoutMs, ctx.sleep, p);
    p.challenge = await challengeProbe(tracer, url, timeoutMs, ctx.sleep);
  }
  return p;
}
