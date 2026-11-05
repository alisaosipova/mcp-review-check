// buildSnapshot: preflight → auth probe → era → connect/fallback → listing → wire probes → active.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { emptySnapshot, PHASES, type AuthProbe, type HttpExchange, type ObservedError, type Snapshot, type TargetOpt, type TlsObservation } from './snapshot.js';
import { describeCause, describeForbidden, describeHttpFailure, describeSseFailure, diagnosisText, networkCause } from './diagnose.js';
import { capSnapshot, charge, createBudget, ERROR_BODY_CAP, SNAPSHOT_BUDGET, UI_READS_CAP, type ByteBudget } from './limits.js';
import { CLIENT_CAPABILITIES, TEXT_ONLY_CAPABILITIES } from './protocol/clientCaps.js';
import { listAll, LooseResult } from './protocol/legacy.js';
import { ModernClient, MODERN_VERSION } from './protocol/modern.js';
import { RecordingTransport } from './protocol/recording.js';
import { BUDGET_ERROR, createRedactor, createTracer, FULL_READ_CAP, scrub, summarizeJsonRpc, type Redactor, type Tracer } from './protocol/trace.js';
import { runActive } from './probe/active.js';
import { runAuthProbe } from './probe/auth.js';
import { defaultDeps, lookupHost, preflight, sameHostRedirect, tlsCheckWithRetry, type Deps } from './probe/network.js';
import { runWireProbes } from './probe/wire.js';
import { buildRedactor, redactDeep } from './redact.js';
import { isObj, isStr, toolName, uiUriOf } from './rules/util/access.js';
import { isLocalTarget } from './rules/util/net.js';

export { VERSION } from './version.js';
import { VERSION } from './version.js';

export type TargetSpec =
  | { kind: 'http'; url: string }
  | { kind: 'stdio'; command: string; args: string[]; env?: Record<string, string>; cwd?: string };

export interface BuildOptions {
  target: TargetSpec;
  headers?: Record<string, string>;
  bearer?: string;
  timeoutMs?: number;
  platforms?: TargetOpt;
  active?: boolean;
  activeAuth?: boolean;
  toolArgs?: Record<string, unknown>;
  /** The run's strong Redactor, applied before the rules (runCli passes it); built from these options when absent. */
  redactor?: Redactor;
  /** Overall deadline for the whole check (--max-duration); checks still pending then are skipped. */
  maxDurationMs?: number;
  /** --local (true) or --no-local (false); unset: detected from the host. */
  local?: boolean;
  /** Bytes of server data the run may read (default SNAPSHOT_BUDGET); not a CLI option, tests lower it. */
  snapshotBudget?: number;
  /** Called once when tools/list times out after a successful initialize (the CLI can say so on stderr); the text holds no server data. */
  onStall?: (message: string) => void;
  /** Called with each phase the run moves on to (connect.ts PHASES, then "closing"); the CLI's phase line shows it. */
  onPhase?: (phase: string) => void;
}

/** The redactor for these options; before the rules only strong values, `all` adds --env values under a plain name. */
export function redactorFor(opts: BuildOptions, all = false): Redactor {
  const t = opts.target;
  // The Basic credential made from user:pass@ is a secret value too: a server may echo the header it got.
  const basic = t.kind === 'http' ? urlBasicAuth(t.url) : undefined;
  return (all ? undefined : opts.redactor) ?? buildRedactor({
    bearer: opts.bearer, headers: basic ? { authorization: basic, ...opts.headers } : opts.headers,
    ...(t.kind === 'http' ? { url: t.url } : { argv: [t.command, ...t.args], env: t.env }),
  }, !all);
}

const decodeUserinfo = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };

/** `Basic <base64(user:pass)>` for a URL with user:pass@ (fetch refuses such a URL), decoded as RFC 7617 sends it. */
export function urlBasicAuth(raw: string): string | undefined {
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  if (!u.username && !u.password) return undefined;
  return `Basic ${Buffer.from(`${decodeUserinfo(u.username)}:${decodeUserinfo(u.password)}`, 'utf8').toString('base64')}`;
}

/** Where a run is; --max-duration reports the phase and stops at the next checkpoint. */
interface Progress {
  phase: string;
  /** The phases that ran to their end, in order (a phase is done when the run moves on to the next one). */
  completed?: string[];
  stopped?: boolean;
  tracer?: Tracer;
  stderrTail?: () => string;
  nonJsonStdout?: NonJsonStdout;
  /** Close open clients (and the stdio child) when the deadline hits. */
  close?: () => Promise<void>;
  /** Every stdio server process still running (main and fresh connections), ended at the deadline and after every run. */
  children?: Set<ChildProcess>;
  /** Aborted at the deadline or when the byte budget runs out: the tracer then sends no more HTTP requests and cancels
   *  its probes in flight. */
  abort: AbortController;
  /** BuildOptions.onPhase. */
  onPhase?: (phase: string) => void;
  /** The run's byte budget (F146), charged by the tracer, the SDK's HTTP responses and the stdio reader. */
  budget?: ByteBudget;
  /** What the run has observed so far that it otherwise stores only at its end (modern results, observed errors).
   *  The wire probes and the active calls need none: they publish each finished probe or call into the live snapshot
   *  (runWireProbes' `out`, runActive's `into`), which stoppedSnapshot copies. */
  collect?: () => Partial<Snapshot['transport']>;
}

class Stopped extends Error {}

/** The phase after the last check: closing connections and waiting for servers to exit. */
const CLOSING = 'closing';

/** Move on to `phase`: the one before it ran to its end (a checkpoint repeated within a phase moves nowhere). */
function advance(p: Progress, phase: string): void {
  if (p.phase === phase) return;
  (p.completed ??= []).push(p.phase);
  p.phase = phase;
  try { p.onPhase?.(phase); } catch { /* a status line never fails the run */ }
}

function checkpoint(p: Progress | undefined, phase: string): void {
  if (!p) return;
  if (p.stopped) throw new Stopped(phase);
  advance(p, phase);
}

/** The phases a finished run went through: the ones it moved on from, and the one it returned in unless that is closing
 *  (a run that ends early, as on a failed connect, returns in the phase it ended). */
function ranPhases(p: Progress): string[] {
  return [...(p.completed ?? []), ...(p.phase === CLOSING ? [] : [p.phase])].filter((x) => x !== CLOSING);
}

/** Every check has run; a deadline from here on finds a complete snapshot. */
function closing(p: Progress | undefined): void {
  if (p && !p.stopped) advance(p, CLOSING);
}

export interface BuildResult {
  snap: Snapshot;
  stderrTail?: string;
  tracer?: Tracer;
  /** The phases this run went through to their end, in order (a run skips the ones it does not need); set when no
   *  deadline or budget stopped it. A --max-duration stop during the rules reports them as limits.stopped.completed. */
  completed?: string[];
}

type Lister = (method: string, key: string) => Promise<{ items: Record<string, unknown>[]; pages: unknown[]; error?: string }>;
type Reader = (uri: string) => Promise<{ ok: boolean; raw?: unknown; error?: unknown }>;

function newClient(name = 'mcp-review-check', capabilities: Record<string, unknown> = CLIENT_CAPABILITIES): Client {
  return new Client({ name, version: VERSION }, { capabilities });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); }),
  ]);
}

// ---------- shared listing ----------

const NETWORK_ERROR = /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|UND_ERR/i;
/** The request got no answer from the server (the SDK's closed connection or timeout, or a network error). */
const TRANSPORT_ERROR = new RegExp(`Connection closed|Not connected|Request timed out|timed out after|${NETWORK_ERROR.source}`, 'i');

/** The SDK's own request timeout (McpError RequestTimeout): the request got no answer within its wait. */
const TIMED_OUT = /^MCP error -32001: Request timed out\b/;
/** The same on the 2026-07-28 client: fetch aborted by the tracer's timer, or a body still incomplete at the deadline. */
const MODERN_TIMED_OUT = /^(This operation was aborted|response body not complete after \d+ ms)$/;
const timedOutListing = (error: string | undefined) => !!error && (TIMED_OUT.test(error) || MODERN_TIMED_OUT.test(error));
/** The wait for each later request once the server has stopped answering (at most --timeout). */
export const STALLED_TIMEOUT_MS = 2000;
const stalledTimeout = (timeoutMs: number) => Math.min(timeoutMs, STALLED_TIMEOUT_MS);

interface StallPlan { list: Lister; timeoutMs: number; onStall?: (message: string) => void }

/** The server answered initialize but tools/list timed out: later requests get a short wait instead of the full --timeout. */
export function stalled(snap: Snapshot): boolean {
  return timedOutListing(snap.listMeta.tools?.error);
}

/**
 * The listings, tools/list first. When tools/list times out, the server has stopped answering after initialize: each
 * later listing waits at most STALLED_TIMEOUT_MS through `short` (when given) instead of the full --timeout, and one that
 * gets no answer in that time is not recorded as a failure (the short wait is ours, not the server's), so a run
 * reports nothing it would not have reported with the full wait. `onStall` hears about it once.
 */
async function listEverything(snap: Snapshot, list: Lister, short?: StallPlan): Promise<void> {
  const caps = snap.capabilities ?? {};
  const plan: Array<[string, string, string, keyof Pick<Snapshot, 'tools' | 'resources' | 'resourceTemplates' | 'prompts'>]> = [['tools/list', 'tools', 'tools', 'tools']];
  if (caps.resources !== undefined) plan.push(['resources/list', 'resources', 'resources', 'resources'], ['resources/templates/list', 'resourceTemplates', 'resourceTemplates', 'resourceTemplates']);
  if (caps.prompts !== undefined) plan.push(['prompts/list', 'prompts', 'prompts', 'prompts']);
  const unanswered: string[] = [];
  for (const [method, key, metaKey, field] of plan) {
    const quick = method !== 'tools/list' && short && stalled(snap);
    const ls = quick ? short.list : list;
    let r = await ls(method, key);
    // A dropped connection is the network's fault, not the server's: retry once before SPEC-020 can report it.
    if (r.error && NETWORK_ERROR.test(r.error)) r = await ls(method, key);
    if (method === 'tools/list' && short?.onStall && timedOutListing(r.error)) {
      short.onStall(`tools/list got no answer within --timeout; the server answered initialize, then stopped answering: each later request waits at most ${short.timeoutMs} ms`);
    }
    if (quick && timedOutListing(r.error)) { unanswered.push(method); continue; }
    snap[field] = r.items;
    snap.listMeta[metaKey] = { pages: r.pages.length, rawPages: r.pages, error: r.error };
  }
  // A declared (or, on 2026-07-28, implied) tools capability whose list fails means nothing could be checked:
  // say so instead of reporting a clean run (SPEC-020 reports the failure itself).
  // So does a transport failure without the capability: a server that dies after initialize has not answered
  // "no tools" (only a JSON-RPC error such as -32601 does).
  const toolsErr = snap.listMeta.tools?.error;
  if (toolsErr && (caps.tools !== undefined || snap.era === 'modern' || TRANSPORT_ERROR.test(toolsErr)) && snap.coverage.toolLevel === 'ok') {
    const skipped = unanswered.length ? `; the server stopped answering after initialize: ${unanswered.join(', ')} got no answer within ${short!.timeoutMs} ms either` : '';
    snap.coverage = { toolLevel: 'list-failed', reason: `tools/list failed: ${toolsErr}${skipped}` };
  }
}

async function readUiResources(snap: Snapshot, read: Reader, now: () => number): Promise<void> {
  const uris = new Set<string>();
  for (const t of snap.tools) { const u = uiUriOf(t); if (isStr(u) && u.startsWith('ui://')) uris.add(u); }
  for (const r of snap.resources) if (isStr(r.uri) && r.uri.startsWith('ui://')) uris.add(r.uri);
  // Each read can hold up to 64 MB until the input caps: a listing with thousands of UI URIs reads only the first ones.
  if (uris.size > UI_READS_CAP) (snap.limits ??= { truncated: [] }).truncated.push({ where: 'UI resources read', length: uris.size, cap: UI_READS_CAP, unit: 'items' });
  for (const uri of [...uris].slice(0, UI_READS_CAP)) {
    const started = now();
    const r = await read(uri);
    snap.resourceReads[uri] = { ...r, durationMs: now() - started };
  }
}

function adoptInitialize(snap: Snapshot, raw: unknown): void {
  snap.initializeRaw = raw;
  if (!isObj(raw)) return;
  if (isObj(raw.serverInfo)) snap.serverInfo = raw.serverInfo;
  if (isObj(raw.capabilities)) snap.capabilities = raw.capabilities;
  snap.instructions = raw.instructions;
  if (isStr(raw.protocolVersion)) snap.protocolVersion = raw.protocolVersion;
}

function adoptDiscover(snap: Snapshot, raw: Record<string, unknown>): void {
  const meta = isObj(raw._meta) ? raw._meta : {};
  const si = meta['io.modelcontextprotocol/serverInfo'];
  if (isObj(si)) snap.serverInfo = si;
  if (isObj(raw.capabilities)) snap.capabilities = raw.capabilities;
  snap.instructions = raw.instructions;
  snap.protocolVersion = Array.isArray(raw.supportedVersions) && isStr(raw.supportedVersions[0]) ? raw.supportedVersions.find((v) => v === '2026-07-28') ?? raw.supportedVersions[0] : '2026-07-28';
}

const legacyLister = (client: Client, timeoutMs: number, budget?: ByteBudget): Lister => (m, k) => listAll(client, m, k, timeoutMs, 100, budget);
const legacyReader = (client: Client, timeoutMs: number, budget?: ByteBudget): Reader => async (uri) => {
  if (budget?.exhausted) return { ok: false, error: BUDGET_ERROR }; // nothing more is read (F146)
  try {
    return { ok: true, raw: await client.request({ method: 'resources/read', params: { uri } } as never, LooseResult, { timeout: timeoutMs }) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};
const modernReader = (modern: ModernClient): Reader => async (uri) => {
  const r = await modern.request('resources/read', { uri });
  return r.result ? { ok: true, raw: r.result } : { ok: false, error: r.error ?? r.exchange.error?.message ?? `HTTP ${r.exchange.status}` };
};

// ---------- HTTP ----------

interface LegacyConn {
  ok: boolean;
  client?: Client;
  rec?: RecordingTransport;
  kind?: 'streamable-http' | 'sse';
  sessionId?: string;
  protocolVersion?: string;
  status?: number;
  message?: string;
  /** Network cause of a failed fetch (ENOTFOUND, ECONNREFUSED, CERT_*, ...). */
  cause?: { code?: string; message?: string };
  /** The failing initialize response (for the connection diagnostics). */
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
  /** The HTTP+SSE fallback after a 400/404/405 also failed: its HTTP status (401 on a GET-only auth route), its error,
   *  and whether its GET opened a stream (the URL is a legacy SSE endpoint). */
  sse?: { status?: number; message: string; reached: boolean };
}

const MODERN_CODES = [-32020, -32021, -32022];
/** A --header that carries credentials (an API key, a token, a cookie). */
const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie)$|api[-_]?key|token|secret|auth|password|credential/i;

function modernErrorBody(tracer: Tracer): boolean {
  const last = [...tracer.exchanges].reverse().find((e) => e.label === 'sdk initialize');
  // The SDK traffic keeps no parsed body (F036): its JSON-RPC summary has the error code.
  const msgs = last?.jsonRpc ?? (isObj(last?.json) ? summarizeJsonRpc(last!.json) : undefined);
  const err = msgs?.length === 1 ? msgs[0].error : undefined;
  return !!err && MODERN_CODES.includes(Number(err.code));
}

interface ClientVariant {
  clientName?: string;
  capabilities?: Record<string, unknown>;
}

async function connectLegacyHttp(url: URL, headers: Record<string, string>, tracer: Tracer, timeoutMs: number, variant: ClientVariant = {}, allowSse = true): Promise<LegacyConn> {
  let last: LegacyConn = { ok: false, message: 'not attempted' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = newClient(variant.clientName, variant.capabilities);
    const inner = new StreamableHTTPClientTransport(url, { requestInit: { headers }, fetch: tracer.fetch });
    const rec = new RecordingTransport(inner);
    try {
      await withTimeout(client.connect(rec, { timeout: timeoutMs }), timeoutMs + 1000, 'initialize');
      return { ok: true, client, rec, kind: 'streamable-http', sessionId: inner.sessionId, protocolVersion: inner.protocolVersion };
    } catch (e) {
      await client.close().catch(() => {});
      await tracer.flush();
      if (e instanceof TypeError && attempt === 0) continue; // network error: retry once
      const status = e instanceof StreamableHTTPError ? (e as StreamableHTTPError).code : undefined;
      const failed = [...tracer.exchanges].reverse().find((x) => x.label === 'sdk initialize');
      last = {
        ok: false, status, message: cleanErrorMessage((e as Error).message, status, tracer.redactor), // masked before its cuts
        cause: status === undefined ? networkCause(e) : undefined, contentType: failed?.contentType, body: failed?.bodySnippet, headers: failed?.headers,
      };
      if (allowSse && status !== undefined && [400, 404, 405].includes(status) && !modernErrorBody(tracer)) {
        const before = tracer.exchanges.length;
        const sse = await connectSse(url, headers, tracer, timeoutMs, variant);
        if (sse.ok) return sse;
        await tracer.flush();
        // The SSE stream's GET answered: the URL is a legacy HTTP+SSE endpoint, so its failure is the one to report.
        const get = tracer.exchanges.slice(before).reverse().find((x) => x.label === 'sdk GET');
        last.sse = { status: sse.status ?? get?.status, message: sse.message ?? 'SSE fallback failed', reached: get?.status === 200 };
      }
      return last;
    }
  }
  return last;
}

/** Mask secrets first (a cut leaves a prefix no scrub recognises), then replace an HTML page in an SDK error message by its title, cap the length and show the HTTP status. */
export function cleanErrorMessage(message: string, status: number | undefined, r: Redactor): string {
  let m = scrub(message, r);
  if (m.length > ERROR_BODY_CAP) m = m.slice(0, ERROR_BODY_CAP);
  const html = /<(!doctype|html|head|body)\b/i.exec(m);
  if (html) {
    const title = /<title[^<>]{0,200}>([^<]{1,200})<\/title>/i.exec(m)?.[1].replace(/\s+/g, ' ').trim();
    m = `${m.slice(0, html.index).trim()} HTML page${title ? ` ("${title}")` : ''}`.trim();
  }
  if (m.length > 200) m = `${m.slice(0, 200)}…`;
  return status !== undefined && status >= 100 && !m.includes(`HTTP ${status}`) ? `HTTP ${status}: ${m}` : m; // the SDK's -1 is no HTTP status
}

async function connectSse(url: URL, headers: Record<string, string>, tracer: Tracer, timeoutMs: number, variant: ClientVariant = {}): Promise<LegacyConn> {
  const client = newClient(variant.clientName, variant.capabilities);
  const inner = new SSEClientTransport(url, { requestInit: { headers }, fetch: tracer.fetch });
  const rec = new RecordingTransport(inner);
  rec.now = () => tracer.now(); // the run's clock, as for the tracer's own samples
  try {
    await withTimeout(client.connect(rec, { timeout: timeoutMs }), timeoutMs + 1000, 'SSE connect');
    return { ok: true, client, rec, kind: 'sse', protocolVersion: (rec.initializeRaw as { protocolVersion?: string })?.protocolVersion };
  } catch (e) {
    await client.close().catch(() => {});
    const code = (e as { code?: unknown }).code;
    const status = e instanceof SseError && typeof code === 'number' && code >= 100 ? code : undefined;
    return { ok: false, status, message: cleanErrorMessage(`SSE fallback: ${(e as Error).message}`, status, tracer.redactor) };
  }
}

/**
 * The JSON-RPC errors the run's own requests got (and the SDK connection's), plus every successful response whose id
 * is not the request's (`result: true`, no code): a real client cannot match such a result to its request (SPEC-016).
 * A message with a `method` is a request or notification from the server, not a response. Read from each exchange's
 * JSON-RPC summary (`jsonRpc`, F036), or its parsed body where an exchange carries only that.
 */
export function collectErrors(tracer: Pick<Tracer, 'exchanges'> | undefined, rec: Pick<RecordingTransport, 'errors'> | undefined): ObservedError[] {
  const out: ObservedError[] = [...(rec?.errors ?? [])];
  for (const e of tracer?.exchanges ?? []) {
    if (e.label.startsWith('sdk ') || !isObj(e.requestJson) || e.requestJson.jsonrpc !== '2.0') continue;
    const req = e.requestJson;
    const modern = e.requestHeaders['mcp-protocol-version'] === MODERN_VERSION;
    for (const m of e.jsonRpc ?? summarizeJsonRpc(e.json) ?? []) {
      if (m.error) {
        out.push({ source: e.label, requestId: req.id, responseId: m.id, code: m.error.code, message: m.error.message, modern });
      } else if (m.result && !m.method && req.id !== undefined && m.id !== req.id) {
        out.push({ source: e.label, requestId: req.id, responseId: m.id, modern, result: true, ...(isStr(req.method) ? { method: req.method } : {}) });
      }
    }
  }
  return out;
}

/**
 * After a stall, an HTTP wire probe the short wait cut off is our wait running out, not the server's answer: it is left
 * out of the snapshot (its rule is skipped), so the short wait reports nothing the full wait would not have. Cut off:
 * no status (the fetch timed out), or a status but no JSON-RPC response once the body read reached the short wait.
 * Only probes made in this phase (not in `before`, such as the discover probe) are dropped.
 */
function dropCutOffProbes(snap: Snapshot, before: Set<string>, waitMs: number): void {
  const probes = snap.transport.probes as Record<string, unknown>;
  for (const [name, o] of Object.entries(probes)) {
    if (before.has(name) || !isObj(o) || typeof o.url !== 'string') continue;
    const ex = o as unknown as HttpExchange;
    const err = ex.error?.name;
    const noStatus = ex.status === undefined && (err === 'AbortError' || err === 'TimeoutError');
    const rpcRequest = isObj(ex.requestJson) && ex.requestJson.id !== undefined;
    const bodyCut = ex.status !== undefined && rpcRequest && !ex.jsonRpc?.length && (err === 'BodyTimeout' || (ex.bodyMs ?? 0) >= waitMs);
    if (noStatus || bodyCut) delete probes[name];
  }
}

async function buildHttp(snap: Snapshot, urlAsEntered: string, opts: BuildOptions, deps: Deps, progress?: Progress): Promise<BuildResult> {
  const url = new URL(urlAsEntered);
  // fetch rejects a URL with user:pass@; its credentials go in an Authorization: Basic header instead (the rules
  // still see the URL as entered). --bearer or an Authorization --header wins over them.
  const basic = urlBasicAuth(urlAsEntered);
  url.username = ''; url.password = '';
  const timeoutMs = opts.timeoutMs ?? 30000;
  const connectTimeout = Math.min(timeoutMs, 15000);
  const headers = { ...(opts.headers ?? {}) };
  // The parsed bodies stay on the exchanges only where the rules read them (keepJson on the probes, F036).
  const tracer = createTracer(redactorFor(opts), deps.now, progress?.abort.signal, { keepJson: false, budget: progress?.budget });
  const budget = progress?.budget;
  if (progress) progress.tracer = tracer;
  const authHeaders: Record<string, string> = { ...headers };
  if (opts.bearer) authHeaders.authorization = `Bearer ${opts.bearer}`;
  else if (basic && !Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')) authHeaders.authorization = basic;

  snap.transport.dns = await lookupHost(url.hostname, deps);
  snap.localMode = opts.local ?? isLocalTarget(snap.transport.dns);
  const tls: TlsObservation[] = [];
  snap.transport.tls = tls;
  // The handshake obeys --timeout (capped at 10 s) and stops at the --max-duration deadline instead of retrying.
  const tlsOpts = { timeoutMs: connectTimeout, signal: progress?.abort.signal };
  if (url.protocol === 'https:') tls.push({ host: url.host, role: 'mcp', ...(await tlsCheckWithRetry(deps, url.hostname, Number(url.port || 443), tlsOpts)) });

  // 1. preflight
  const pf = await preflight(tracer, url, connectTimeout, deps.sleep);
  snap.transport.preflight = pf;
  // The SDK client follows a same-host redirect (/mcp -> /mcp/) by itself; the raw requests (server/discover, the
  // unauthenticated initialize that decides on the auth probe, and the auth probe) go to its target too, or they would
  // see only the 3xx. SRV-006 still reports the redirect from the preflight to the URL as entered.
  const target = sameHostRedirect(url, pf) ?? url;
  const authPf = target === url ? pf : await preflight(tracer, target, connectTimeout, deps.sleep);
  let trigger: AuthProbe['trigger'] | undefined = authPf.status === 401 ? 'preflight-401' : authPf.status === 403 && authPf.headers?.['www-authenticate'] ? 'preflight-403' : undefined;

  // 2. era detection
  const modern = new ModernClient(target, tracer, authHeaders, timeoutMs);
  const disc = await modern.request('server/discover', {}, { label: 'discover', timeoutMs: connectTimeout, keepJson: true }); // a probe (SPEC-019)
  snap.transport.probes.discover = disc.exchange;
  const discOk = disc.exchange.status === 200 && !!disc.result && Array.isArray(disc.result.supportedVersions);
  const discSignal = disc.exchange.status === 400 && MODERN_CODES.includes(Number(disc.error?.code));
  if (disc.result && disc.exchange.status === 200) snap.discoverRaw = disc.result;

  // 3. legacy connect (with SSE fallback)
  const conn = await connectLegacyHttp(url, authHeaders, tracer, connectTimeout, {}, !discOk && !discSignal);
  if (progress) progress.close = async () => { await conn.client?.close().catch(() => {}); };
  await tracer.flush();
  // A legacy SSE server can guard only its GET /sse route: the POST gets 404 or 405, the SSE fallback's GET the 401.
  const authFailed = conn.status === 401 || conn.sse?.status === 401 || (!conn.ok && !discOk && disc.exchange.status === 401);
  if (!conn.ok && (conn.sse?.reached || conn.sse?.status === 401)) snap.transport.kind = 'sse';
  if (conn.ok) {
    snap.transport.kind = conn.kind!;
    snap.transport.sessionId = conn.sessionId;
    snap.era = conn.kind === 'sse' ? 'sse-legacy' : discOk ? 'dual' : 'legacy';
    adoptInitialize(snap, conn.rec!.initializeRaw);
    if (conn.protocolVersion) snap.protocolVersion = conn.protocolVersion;
  } else if (discOk || discSignal) {
    snap.era = 'modern';
    if (snap.discoverRaw && isObj(snap.discoverRaw)) adoptDiscover(snap, snap.discoverRaw as Record<string, unknown>);
  }

  if (progress) progress.collect = () => ({ modernResults: [...modern.results], observedErrors: collectErrors(tracer, conn.rec), timings: httpTimings(tracer, conn), notifications: structuredClone(tracer.notifications) });
  const finishHttp = async (): Promise<BuildResult> => {
    await tracer.flush();
    snap.transport.exchanges = ruleExchanges(tracer);
    snap.transport.timings = httpTimings(tracer, conn);
    snap.transport.modernResults = modern.results;
    snap.transport.observedErrors = collectErrors(tracer, conn.rec);
    if (Object.keys(tracer.notifications.methods).length) snap.transport.notifications = tracer.notifications;
    closing(progress);
    await endSession(conn, tracer);
    return { snap, tracer };
  };

  // 4. auth probe
  // Credentials sent with --header (an API key, an Authorization header) that get a 401 were rejected too.
  const credentials = !!opts.bearer || !!basic || Object.keys(headers).some((h) => CREDENTIAL_HEADER.test(h));
  const rejected = () => {
    snap.coverage = credentials ? { toolLevel: 'token-rejected', reason: opts.bearer ? 'token rejected (401)' : 'supplied credentials rejected (401)' } : { toolLevel: 'auth-required', reason: 'server requires OAuth' };
    trigger ??= credentials ? 'bearer-rejected' : 'preflight-401';
  };
  const probeAuth = async () => {
    checkpoint(progress, 'auth probe');
    // The unauthenticated preflight holds the challenge only when it started the probe (a 401, or a 403 with
    // WWW-Authenticate); otherwise the latest 401, preferably one with a challenge, from the requests that carried credentials.
    const last401 = [...tracer.exchanges].reverse().filter((e) => e.status === 401);
    const challengeExchange = trigger?.startsWith('preflight-') && (authPf.status === 401 || (authPf.status === 403 && authPf.headers?.['www-authenticate']))
      ? authPf : last401.find((e) => e.headers?.['www-authenticate']) ?? last401[0] ?? authPf;
    const { probe, tlsHosts } = await runAuthProbe({ tracer, url: target, trigger: trigger!, challengeExchange, deps, timeoutMs, activeAuth: !!opts.activeAuth });
    snap.authProbe = probe;
    for (const h of tlsHosts) {
      checkpoint(progress, 'auth probe'); // each AS host can take up to three handshakes
      tls.push({ host: h.host, role: 'as', ...(await tlsCheckWithRetry(deps, h.hostname, h.port, tlsOpts)) });
    }
  };
  if (authFailed) rejected();
  if (trigger) await probeAuth();

  const connected = conn.ok || snap.era === 'modern';
  if (!connected && !authFailed) {
    const d = conn.status === 403
      ? describeForbidden(conn)
      : conn.cause ? describeCause(url, conn.cause)
      : conn.sse?.reached ? describeSseFailure(url, conn.sse.message)
      : describeHttpFailure(url, { status: conn.status, contentType: conn.contentType, body: conn.body, message: conn.message });
    snap.connectDiagnosis = d;
    snap.fatal = `could not complete a handshake: ${diagnosisText(d)}`;
    snap.coverage = { toolLevel: 'connect-failed', reason: diagnosisText(d) };
  }

  if (connected && !authFailed) {
    const lister: Lister = conn.ok ? legacyLister(conn.client!, timeoutMs, budget) : (m, k) => modern.listAll(m, k, 100, budget);
    const reader: Reader = conn.ok ? legacyReader(conn.client!, timeoutMs, budget) : modernReader(modern);
    checkpoint(progress, 'listing');
    const shortWait = stalledTimeout(timeoutMs);
    const shortLister: Lister = conn.ok ? legacyLister(conn.client!, shortWait, budget) : (m, k) => modern.listAll(m, k, 100, budget, shortWait);
    await listEverything(snap, lister, { list: shortLister, timeoutMs: shortWait, onStall: opts.onStall });
    await tracer.flush();
    // initialize (or server/discover) can be public while the methods behind it need a token: a 401 on tools/list
    // asks for auth as much as one on initialize, and the wire probes would only collect more 401s.
    if (snap.listMeta.tools?.error && tracer.exchanges.some((e) => e.status === 401 && isObj(e.requestJson) && e.requestJson.method === 'tools/list')) {
      rejected();
      snap.tools = []; snap.resources = []; snap.resourceTemplates = []; snap.prompts = []; snap.listMeta = {};
      await probeAuth();
      return finishHttp();
    }
    checkpoint(progress, 'UI resource reads');
    await readUiResources(snap, reader, deps.now);
    const useModern = snap.era === 'modern' || snap.era === 'dual';
    checkpoint(progress, 'wire probes');
    // A server that stopped answering after initialize: the probes wait briefly, as on stdio. The SDK probes and the
    // legacy HTTP ones without an answer are no finding; a 2026-07-28 probe the short wait cut off is dropped below.
    const stall = stalled(snap);
    const probeTimeout = stall ? shortWait : timeoutMs;
    const probesBefore = new Set(Object.keys(snap.transport.probes));
    modern.timeoutMs = probeTimeout;
    // Each probe lands in the snapshot as it finishes (next to the discover probe), so a deadline keeps the finished ones.
    try {
      await runWireProbes({
        snap, timeoutMs: probeTimeout, now: deps.now, client: conn.client, modern: useModern ? modern : undefined, sleep: deps.sleep,
        http: { tracer, url, authHeaders, sessionId: conn.sessionId, protocolVersion: conn.protocolVersion }, out: snap.transport.probes,
      });
    } finally { modern.timeoutMs = timeoutMs; }
    if (stall) dropCutOffProbes(snap, probesBefore, probeTimeout);
    const fresh = (variant: ClientVariant = {}) => freshTools(conn.ok ? url : target, authHeaders, tracer, connectTimeout, timeoutMs, conn.ok ? conn.kind : undefined, variant, budget);
    if (!snap.listMeta.tools?.error) {
      checkpoint(progress, 'tools re-list');
      const relist = await lister('tools/list', 'tools');
      if (!relist.error) snap.toolsRelist = relist.items.map(toolName); // a failed re-list (rate limit) is not a different set
      snap.toolsFreshConnection = (await fresh())?.map(toolName);
      checkpoint(progress, 'text-only tools/list');
      if (linksUi(snap)) snap.toolsWithoutUi = await fresh({ capabilities: TEXT_ONLY_CAPABILITIES });
    }
    if (opts.active && !snap.listMeta.tools?.error) {
      checkpoint(progress, 'active tool calls');
      // Each call lands in snap.active as it finishes, so a deadline keeps the finished ones.
      await runActive({
        snap, toolArgs: opts.toolArgs, timeoutMs, now: deps.now, client: conn.client, modern: conn.ok ? undefined : modern, into: snap.active = { calls: [] },
        listWithClientName: conn.ok && conn.kind === 'streamable-http' ? async (name) => (await fresh({ clientName: name }))?.map(toolName) : undefined,
      });
    }
  }
  return finishHttp();
}

/** SRV-010's samples: the tracer's, plus on legacy HTTP+SSE the SDK connection's time from send to result (its POSTs
 *  get 202 and the result comes on the GET stream, which the tracer does not time). */
function httpTimings(tracer: Tracer, conn: LegacyConn): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(tracer.timings)) out[k] = [...v];
  if (conn.ok && conn.kind === 'sse' && conn.rec) for (const [k, v] of Object.entries(conn.rec.latencies)) (out[k] ??= []).push(...v);
  return out;
}

/** Some listed tool links a UI resource (the text-only re-list for APPS-019 is needed). */
function linksUi(snap: Snapshot): boolean {
  return snap.tools.some((t) => isStr(uiUriOf(t)));
}

/** tools/list on a new connection, optionally with another clientInfo.name or without the UI extension. */
async function freshTools(url: URL, headers: Record<string, string>, tracer: Tracer, connectTimeout: number, timeoutMs: number, kind: 'streamable-http' | 'sse' | undefined, variant: ClientVariant = {}, budget?: ByteBudget): Promise<Record<string, unknown>[] | undefined> {
  if (budget?.exhausted) return undefined;
  if (!kind) {
    const fresh = new ModernClient(url, tracer, headers, timeoutMs, variant.capabilities);
    const r = await fresh.listAll('tools/list', 'tools', 100, budget);
    return r.error ? undefined : r.items;
  }
  const conn = kind === 'sse' ? await connectSse(url, headers, tracer, connectTimeout, variant) : await connectLegacyHttp(url, headers, tracer, connectTimeout, variant, false);
  if (!conn.ok) return undefined;
  try {
    const r = await listAll(conn.client!, 'tools/list', 'tools', timeoutMs, 100, budget);
    return r.error ? undefined : r.items;
  } finally {
    await endSession(conn, tracer);
  }
}

/** The DELETE requests that ended the check's own sessions: kept in the trace, but not evidence for the rules. */
const sessionEnds = new WeakSet<HttpExchange>();

/** The run's HTTP exchanges for the snapshot (without the session-ending DELETEs: the SDK connections' and the
 *  raw probes' "(close session)" requests alike, since both end sessions the check itself opened). */
function ruleExchanges(tracer: Tracer): HttpExchange[] {
  return tracer.exchanges.filter((e) => !sessionEnds.has(e) && !(e.method === 'DELETE' && e.label.endsWith('(close session)')));
}

/** Close a connection; a Streamable HTTP session is ended with DELETE first (the spec's SHOULD for a client that no
 *  longer needs it), so repeated checks leave no sessions behind on a stateful server. 405 means it does not support that. */
async function endSession(conn: LegacyConn, tracer: Tracer): Promise<void> {
  const inner = conn.rec?.inner;
  if (conn.ok && conn.kind === 'streamable-http' && inner instanceof StreamableHTTPClientTransport && inner.sessionId) {
    const before = tracer.exchanges.length;
    await withTimeout(inner.terminateSession(), 5000, 'session DELETE').catch(() => {});
    await tracer.flush();
    for (const e of tracer.exchanges.slice(before)) if (e.method === 'DELETE') sessionEnds.add(e);
  }
  await conn.client?.close().catch(() => {});
}

// ---------- stdio ----------

interface StdioConn {
  client: Client;
  rec: RecordingTransport;
  nonJson: NonJsonStdout;
  stderr: () => string;
}

/** stdout lines that are not JSON-RPC messages (SRV-018): the first NON_JSON_KEPT lines, each cut to
 *  NON_JSON_LINE_CAP characters after masking, and the count of all of them. */
export interface NonJsonStdout {
  lines: string[];
  total: number;
}

export const NON_JSON_KEPT = 50;
export const NON_JSON_LINE_CAP = 1024;
/** Raw bytes kept from the start of a non-JSON line before masking and the NON_JSON_LINE_CAP cut. */
const NON_JSON_HEAD = 4 * NON_JSON_LINE_CAP;
/** The SDK's stdio read buffer (default 10 MB), raised to what an HTTP response body may be. */
export const STDIO_MAX_MESSAGE = FULL_READ_CAP;

/** A line the SDK accepts as a JSON-RPC message: a JSON object (or a batch of them) with jsonrpc "2.0".
 *  A JSON log line ({"level":30,"msg":...} from pino, winston, bunyan) is not one; the SDK rejects it too. */
export function isJsonRpcLine(line: string): boolean {
  const t = line.trimStart();
  if (t[0] !== '{' && t[0] !== '[') return false; // most log lines: no JSON.parse needed
  let v: unknown;
  try { v = JSON.parse(t); } catch { return false; }
  const one = (m: unknown) => isObj(m) && m.jsonrpc === '2.0';
  return Array.isArray(v) ? v.length > 0 && v.every(one) : one(v);
}

function stdioObservation(nonJson: NonJsonStdout | undefined, stderrTail: string): NonNullable<Snapshot['transport']['stdio']> {
  return { nonJsonStdout: [...(nonJson?.lines ?? [])], nonJsonTotal: nonJson?.total ?? 0, stderrTail };
}

/** Collect the non-JSON-RPC lines of a stdio server's stdout. Lines are split as bytes and decoded afterwards (the SDK
 *  reads the same stream as Buffers, and a chunk can end inside a UTF-8 character); chunks are joined once per line,
 *  a non-JSON line keeps only its head, and a line over STDIO_MAX_MESSAGE is dropped (the SDK fails on it).
 *  `onMessage`: the size of each JSON-RPC message line, which the SDK parses and the run keeps (the byte budget, F146). */
export function stdoutTap(r: Redactor, onMessage?: (bytes: number) => void): { out: NonJsonStdout; push(chunk: Buffer): void } {
  const out: NonJsonStdout = { lines: [], total: 0 };
  let parts: Buffer[] = [];
  let size = 0;
  /** Past NON_JSON_HEAD bytes a line is either a JSON message (kept whole up to STDIO_MAX_MESSAGE, then dropped:
   *  the SDK fails on it) or not JSON (kept as its head only). */
  let mode: 'line' | 'json' | 'head' | 'drop' = 'line';
  const add = (raw: Buffer) => {
    const line = raw.toString('utf8').replace(/\r$/, '');
    if (!line.trim()) return;
    if (isJsonRpcLine(line)) { onMessage?.(raw.length); return; }
    out.total++;
    if (out.lines.length < NON_JSON_KEPT) {
      const masked = scrub(line, r); // masked before the cut
      out.lines.push(masked.length > NON_JSON_LINE_CAP ? `${masked.slice(0, NON_JSON_LINE_CAP)}…` : masked);
    }
  };
  const end = () => {
    if (mode !== 'drop') add(Buffer.concat(parts, size));
    parts = []; size = 0; mode = 'line';
  };
  const take = (b: Buffer) => {
    if (mode === 'drop' || !b.length) return;
    if (mode === 'head') {
      if (size < NON_JSON_HEAD) { const k = b.subarray(0, NON_JSON_HEAD - size); parts.push(k); size += k.length; }
      return;
    }
    parts.push(b); size += b.length;
    if (mode === 'json') {
      if (size > STDIO_MAX_MESSAGE) { mode = 'drop'; parts = []; size = 0; }
    } else if (size > NON_JSON_HEAD) {
      const head = Buffer.concat(parts, size);
      const first = head.toString('utf8', 0, 64).trimStart()[0];
      if (first === '{' || first === '[') { mode = 'json'; parts = [head]; }
      else { mode = 'head'; parts = [head.subarray(0, NON_JSON_HEAD)]; size = NON_JSON_HEAD; }
    }
  };
  return {
    out,
    push(chunk: Buffer) {
      let i;
      while ((i = chunk.indexOf(10)) >= 0) {
        take(chunk.subarray(0, i));
        end();
        chunk = chunk.subarray(i + 1);
      }
      take(chunk);
    },
  };
}

/** The first error-looking stderr line (the cause in a stack trace) plus the last line, masked before the 200-character cut. */
export function stderrSummary(tail: string, r: Redactor): string {
  const lines = scrub(tail, r).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  const isFrame = (l: string) => /^\s*at\s/.test(l);
  const first = lines.find((l) => !isFrame(l) && /(error|exception|cannot|failed|not found|unsupported|requires?)\b/i.test(l)) ?? lines.find((l) => !isFrame(l));
  const last = lines[lines.length - 1];
  const picked = [...new Set([first, last].filter((l): l is string => !!l))].map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l.trim()));
  return picked.join(' | ');
}

async function connectStdio(t: Extract<TargetSpec, { kind: 'stdio' }>, timeoutMs: number, r: Redactor, variant: ClientVariant = {}, progress?: Progress): Promise<StdioConn> {
  const inner = new GroupStdioTransport({ command: t.command, args: t.args, env: { ...getDefaultEnvironment(), ...(t.env ?? {}) }, cwd: t.cwd, stderr: 'pipe', maxBufferSize: STDIO_MAX_MESSAGE });
  let stderrTail = '';
  // Masked before the 4096-character tail and the 200-character summary lines cut it.
  // Decoded as a stream, so an echo split inside a UTF-8 character between two chunks is still one string to mask.
  (inner.stderr as NodeJS.ReadableStream | null)?.setEncoding('utf8').on('data', (c: string) => { stderrTail = scrub(stderrTail + c, r).slice(-4096); });
  // Every message line of every connection to the server counts against the run's byte budget (F146); a line the SDK
  // drops (over STDIO_MAX_MESSAGE) is not kept and not counted.
  const stdout = stdoutTap(r, (n) => { charge(progress?.budget, n); });
  const nonJson = stdout.out;
  // Kept here because the transport forgets its process on close: a failed handshake still reports how it ended (A10-06).
  let child: ChildProcess | undefined;
  const tap = () => {
    const proc = child = (inner as unknown as { _process?: ChildProcess })._process;
    if (proc && progress?.children) {
      if (progress.stopped || ending) endTree(proc, 'SIGKILL'); // spawned while the deadline or a signal was ending the others
      // On POSIX the entry stays while the server's process group outlives its wrapper.
      else for (const set of [progress.children, everyChild]) { set.add(proc); proc.once('exit', () => { if (!running(proc)) set.delete(proc); }); }
    }
    proc?.stdout?.on('data', (c: Buffer) => stdout.push(c));
  };
  const rec = new RecordingTransport(inner as Transport, tap);
  const client = newClient(variant.clientName, variant.capabilities);
  // The main connection's output is visible before the handshake: --max-duration can stop the run during it.
  if (progress && !progress.stderrTail) { progress.stderrTail = () => stderrTail; progress.nonJsonStdout = nonJson; }
  try {
    await withTimeout(client.connect(rec, { timeout: timeoutMs }), timeoutMs + 1000, 'initialize');
  } catch (e) {
    // Read before client.close(), which ends a process that is still running (a timeout is not an exit).
    const ended = exitNote(child);
    await client.close().catch(() => {});
    const err = e as Error;
    throw Object.assign(new Error(`${err.message}${rec.overflow ? ` (${rec.overflow})` : ''}${ended}${startupOutput(stderrTail, nonJson, r)}`), { stderrTail, nonJson });
  }
  return { client, rec, nonJson, stderr: () => stderrTail };
}

/** A stdio message over STDIO_MAX_MESSAGE makes the SDK close the connection: name that cause on the requests that
 *  then failed with "Connection closed" or "Not connected" (listings, UI reads, the coverage reason). */
function explainOverflow(snap: Snapshot, rec: RecordingTransport): void {
  if (!rec.overflow) return;
  const why = (e: string) => (/Connection closed|Not connected/i.test(e) ? `${e} (a server message exceeded the ${STDIO_MAX_MESSAGE / (1024 * 1024)} MB stdio read buffer: ${rec.overflow})` : e);
  for (const m of Object.values(snap.listMeta)) if (m.error) m.error = why(m.error);
  for (const r of Object.values(snap.resourceReads)) if (typeof r.error === 'string') r.error = why(r.error);
  if (snap.coverage.reason) snap.coverage.reason = why(snap.coverage.reason);
}

/** " (the server process exited with code 1 before answering initialize)" when the child has ended, else "". */
export function exitNote(proc: Pick<ChildProcess, 'exitCode' | 'signalCode'> | undefined): string {
  // A spawn that failed (ENOENT) leaves a negative errno in exitCode: that process never ran.
  if (!proc || (proc.signalCode === null && (proc.exitCode === null || proc.exitCode < 0))) return '';
  return ` (the server process exited with ${proc.signalCode ? `signal ${proc.signalCode}` : `code ${proc.exitCode}`} before answering initialize)`;
}

/** What a stdio server printed before a failed or stopped handshake: "; stderr: <summary>; stdout: <first non-JSON-RPC
 *  line>", plus a pointer to HTTP when stdout announces a URL (an HTTP server started with --stdio). */
export function startupOutput(stderrTail: string, nonJson: NonJsonStdout | undefined, r: Redactor): string {
  let out = stderrTail ? `; stderr: ${stderrSummary(stderrTail, r)}` : '';
  const first = nonJson?.lines[0];
  if (first !== undefined) {
    const line = scrub(first, r).trim();
    out += `; stdout: ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`;
    const url = /\b(?:listen|running|started|serving|available)\w*\b.*?(https?:\/\/[^\s"'<>]+)/i.exec(line)?.[1];
    if (url) out += `; the server announces ${url}: check it over HTTP (mcp-review-check ${url}) instead of --stdio`;
  }
  return out;
}

async function buildStdio(snap: Snapshot, t: Extract<TargetSpec, { kind: 'stdio' }>, opts: BuildOptions, deps: Deps, progress?: Progress): Promise<BuildResult> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  // A stdio start can include an `npx -y` download, so it gets the full --timeout rather than the 15 s HTTP connect cap.
  const connectTimeout = timeoutMs;
  snap.localMode = opts.local ?? true;
  let conn: StdioConn;
  try {
    conn = await connectStdio(t, connectTimeout, redactorFor(opts), {}, progress);
  } catch (e) {
    const { stderrTail, nonJson } = e as { stderrTail?: string; nonJson?: NonJsonStdout };
    snap.fatal = `could not start or initialize the stdio server: ${(e as Error).message}`;
    snap.coverage = { toolLevel: 'connect-failed', reason: (e as Error).message };
    // SRV-018 still reads what the server wrote to stdout instead of answering.
    snap.transport.stdio = stdioObservation(nonJson, stderrTail ?? '');
    return { snap, stderrTail };
  }
  if (progress) {
    progress.close = async () => { await conn.client.close().catch(() => {}); };
    progress.collect = () => ({ observedErrors: collectErrors(undefined, conn.rec) });
  }
  snap.era = 'legacy';
  adoptInitialize(snap, conn.rec.initializeRaw);
  const budget = progress?.budget;
  const lister = legacyLister(conn.client, timeoutMs, budget);
  checkpoint(progress, 'listing');
  await listEverything(snap, lister, { list: legacyLister(conn.client, stalledTimeout(timeoutMs), budget), timeoutMs: stalledTimeout(timeoutMs), onStall: opts.onStall });
  // A server that stopped answering after initialize: the probes wait briefly (a probe without an answer is no finding).
  const probeTimeout = stalled(snap) ? stalledTimeout(timeoutMs) : timeoutMs;
  checkpoint(progress, 'UI resource reads');
  await readUiResources(snap, legacyReader(conn.client, timeoutMs, budget), deps.now); // a read cut short could fail a UI rule
  checkpoint(progress, 'wire probes');
  await runWireProbes({ snap, timeoutMs: probeTimeout, now: deps.now, client: conn.client, out: snap.transport.probes });
  const fresh = async (variant: ClientVariant = {}) => {
    if (budget?.exhausted) return undefined;
    try {
      const c = await connectStdio(t, connectTimeout, redactorFor(opts), variant, progress);
      try { const r = await listAll(c.client, 'tools/list', 'tools', timeoutMs, 100, budget); return r.error ? undefined : r.items; }
      finally { await c.client.close().catch(() => {}); }
    } catch { return undefined; }
  };
  if (!snap.listMeta.tools?.error) {
    checkpoint(progress, 'tools re-list');
    const relist = await lister('tools/list', 'tools');
    if (!relist.error) snap.toolsRelist = relist.items.map(toolName);
    snap.toolsFreshConnection = (await fresh())?.map(toolName);
    checkpoint(progress, 'text-only tools/list');
    if (linksUi(snap)) snap.toolsWithoutUi = await fresh({ capabilities: TEXT_ONLY_CAPABILITIES });
    if (opts.active) {
      checkpoint(progress, 'active tool calls');
      await runActive({
        snap, toolArgs: opts.toolArgs, timeoutMs, now: deps.now, client: conn.client, into: snap.active = { calls: [] },
        listWithClientName: async (name) => (await fresh({ clientName: name }))?.map(toolName),
      });
    }
  }
  await new Promise((r) => setTimeout(r, 50)); // let trailing stdout/stderr arrive
  explainOverflow(snap, conn.rec);
  snap.transport.stdio = stdioObservation(conn.nonJson, conn.stderr());
  snap.transport.observedErrors = collectErrors(undefined, conn.rec);
  // Every check has run: a deadline while the server takes its time to exit (up to 2 s after stdin EOF) stops nothing.
  closing(progress);
  await conn.client.close().catch(() => {});
  return { snap, stderrTail: conn.stderr() };
}

// ---------- entry ----------

export async function buildSnapshot(opts: BuildOptions, deps: Deps = defaultDeps): Promise<BuildResult> {
  const t = opts.target;
  const options: Snapshot['options'] = {
    target: opts.platforms ?? 'all', active: !!opts.active, activeAuth: !!opts.activeAuth,
    authenticated: !!opts.bearer || Object.keys(opts.headers ?? {}).length > 0 || (t.kind === 'http' && !!urlBasicAuth(t.url)),
  };
  const snap = t.kind === 'http'
    ? emptySnapshot({ kind: 'http', urlAsEntered: t.url, url: new URL(t.url) }, options)
    : emptySnapshot({ kind: 'stdio', command: t.command, args: t.args }, options);
  if (t.kind === 'http') snap.env = { nodeExtraCaCerts: !!process.env.NODE_EXTRA_CA_CERTS };
  const progress: Progress = { phase: 'connect', children: new Set(), abort: new AbortController(), onPhase: opts.onPhase, budget: createBudget(opts.snapshotBudget ?? SNAPSHOT_BUDGET) };
  const run = t.kind === 'http' ? buildHttp(snap, t.url, opts, deps, progress) : buildStdio(snap, t, opts, deps, progress);
  let result: BuildResult;
  try {
    result = await withStops(run, snap, progress, opts.maxDurationMs);
  } catch (e) {
    await progress.close?.(); // the check threw after the handshake (a TypeError on odd server data): its client is still open
    throw e;
  } finally {
    await endChildren(progress.children); // a failed initialize leaves its child to the SDK's unawaited close()
  }
  if (!progress.stopped) result = { ...result, completed: ranPhases(progress) };
  dropExchangeBodies(result.snap);
  // Secrets are masked before the input caps: a cut through an echoed secret leaves a prefix no scrub recognises.
  // The target stays as entered (rules parse and hash it).
  const masked = { ...redactDeep(result.snap, redactorFor(opts)), target: result.snap.target };
  capSnapshot(masked);
  return { ...result, snap: masked };
}

/**
 * No exchange keeps the full parsed body once the probes are done: rpcView and AUTH-021 read the summary the tracer
 * stored (jsonRpc, jsonParsed, oauthError). The PRM and AS metadata exchanges are not touched: `prm.json` and
 * `as[].json` are the same objects and are snapshot fields (F036).
 */
export function dropExchangeBodies(snap: Snapshot): void {
  const drop = (e: unknown) => {
    const x = e as HttpExchange | undefined;
    if (x && x.json !== undefined && (x.jsonParsed || x.jsonRpc)) delete x.json;
  };
  // The discover probe's result stays in its summary (SPEC-019 falls back to it): the same object as snap.discoverRaw.
  const disc = snap.transport.probes.discover as HttpExchange | undefined;
  if (disc && (disc as { kind?: string }).kind !== 'jsonrpc' && disc.json !== undefined) disc.jsonRpc = summarizeJsonRpc(disc.json, true) ?? disc.jsonRpc;
  for (const o of Object.values(snap.transport.probes)) if (o && (o as { kind?: string }).kind !== 'jsonrpc') drop(o);
  for (const e of snap.authProbe?.active?.token ?? []) drop(e);
}

/** Why a run stopped early: the --max-duration deadline, or the snapshot byte budget ran out (F146). */
type StopCause = { kind: 'deadline'; ms: number } | { kind: 'budget'; budget: ByteBudget };

/**
 * Resolve with whatever was observed when --max-duration runs out or the byte budget is spent; the rest of the run is
 * abandoned. Without either the run's own result.
 */
async function withStops(run: Promise<BuildResult>, snap: Snapshot, progress: Progress, ms?: number): Promise<BuildResult> {
  let timer: NodeJS.Timeout | undefined;
  let ending: Promise<void> | undefined;
  let fire: (cause: StopCause) => void = () => {};
  const stop = new Promise<BuildResult>((resolve) => {
    fire = (cause) => {
      if (progress.stopped) return;
      progress.stopped = true;
      progress.abort.abort();
      void progress.close?.();
      const stopped = { snap: stoppedSnapshot(snap, cause, progress), tracer: progress.tracer, stderrTail: progress.stderrTail?.() };
      ending = endChildren(progress.children);
      void ending.then(() => resolve(stopped));
    };
  });
  if (ms) timer = setTimeout(() => fire({ kind: 'deadline', ms }), ms);
  // At once, from inside the read that spent the budget (it has stopped at it): the copy holds what was read before.
  const budget = progress.budget;
  if (budget) budget.onExhausted = () => fire({ kind: 'budget', budget });
  run.catch(() => {}); // a Stopped checkpoint (or a closed client) after the deadline is expected
  try {
    // Past the deadline the run is abandoned however it settles ('Not connected' calls are no finished run).
    const r = await Promise.race([run, stop]);
    return progress.stopped ? stop : r;
  } catch (e) {
    if (e instanceof Stopped || progress.stopped) return stop;
    throw e;
  } finally {
    clearTimeout(timer);
    await ending; // the run can still finish while the servers are being ended: the CLI exits only after them
  }
}

/** End the stdio servers still running so none outlives the CLI: SIGTERM, then SIGKILL, each with a bounded wait;
 *  SIGKILL again while the set still holds a live one, up to 3 rounds, as a server can join it during a wait. */
async function endChildren(children: Set<ChildProcess> | undefined, graceMs = 1000): Promise<void> {
  for (const signal of ['SIGTERM', 'SIGKILL', 'SIGKILL', 'SIGKILL'] as const) {
    const live = [...(children ?? [])].filter(running); // a process leaves the set on 'exit' unless its group lives on
    if (!live.length) return;
    for (const c of live) endTree(c, signal);
    for (const until = Date.now() + graceMs; live.some(running) && Date.now() < until;) await new Promise((done) => setTimeout(done, 25));
  }
}

/** Every stdio server of every run in this process, for the CLI's signal handler (endAllNow). */
const everyChild = new Set<ChildProcess>();
/** Set by endAllNow: the CLI is exiting on a signal, so a server the check starts after it is killed at once. */
let ending = false;

/** A stdio server still running: the process itself or, on POSIX, anything left in its process group. */
function running(c: ChildProcess): boolean {
  if (c.exitCode === null && c.signalCode === null) return true;
  try { return process.platform !== 'win32' && !!c.pid && process.kill(-c.pid, 0); } catch { return false; }
}

/** Send `signal` to a stdio server and everything it started: its process group on POSIX, its tree on Windows. */
function endTree(c: ChildProcess, signal: NodeJS.Signals): void {
  // Windows: before the wrapper (cmd.exe for npx, .cmd and .bat) dies, as /T finds only the children of a live pid.
  if (process.platform === 'win32') { if (c.pid) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }
  else if (c.pid) { try { process.kill(-c.pid, signal); return; } catch { /* no group (any more): the process alone */ } }
  c.kill(signal);
}

/** End every stdio server this process started that is still running; the CLI calls it on SIGINT, SIGTERM, SIGHUP and
 *  SIGQUIT, with `kill` on a second signal: SIGKILL to every group (Windows: tree) at once, without a wait. */
export function endAllNow(kill = false): Promise<void> {
  ending = true;
  if (kill) for (const c of everyChild) endTree(c, 'SIGKILL');
  return endChildren(everyChild);
}

/** The SDK 1.32.1 transport's private state that GroupStdioTransport works on (client/stdio.js). */
type SdkStdio = { _process?: ChildProcess; _serverParams: ConstructorParameters<typeof StdioClientTransport>[0]; _readBuffer: { append(chunk: Buffer): void }; _stderrStream: NodeJS.WritableStream | null; processReadBuffer(): void };

/** The transport still has the private state GroupStdioTransport relies on (a test pins it for SDK bumps). */
export function sdkStdioShape(t: object): boolean {
  const s = t as Partial<SdkStdio>;
  return isObj(s._serverParams) && typeof s._readBuffer?.append === 'function' && typeof s.processReadBuffer === 'function' && '_stderrStream' in s;
}

/** The SDK's stdio transport, but a server started through a wrapper (npx, .cmd, .bat, sh -c) ends with everything it
 *  started: on POSIX it leads its own process group; close() ends the group (Windows: the tree) before the wrapper. */
export class GroupStdioTransport extends StdioClientTransport {
  /** The SDK's start (client/stdio.js:60-107) with detached: true; Windows keeps it as is (no groups there). */
  override async start(): Promise<void> {
    const self = this as unknown as SdkStdio;
    // An SDK whose private state differs (renamed in a release) keeps its own start: no process group, but a working check.
    if (process.platform === 'win32' || !sdkStdioShape(self)) return super.start();
    if (self._process) throw new Error('StdioClientTransport already started!');
    const p = self._serverParams;
    let overflowed = false; // the SDK closes the transport on a read-buffer overflow; later chunks are not parsed again
    return new Promise((resolve, reject) => {
      const proc = self._process = spawn(p.command, p.args ?? [], { env: { ...getDefaultEnvironment(), ...p.env }, stdio: ['pipe', 'pipe', p.stderr ?? 'inherit'], shell: false, cwd: p.cwd, detached: true });
      proc.on('error', (e) => { reject(e); this.onerror?.(e); });
      proc.on('spawn', () => resolve());
      proc.on('close', () => { self._process = undefined; this.onclose?.(); });
      proc.stdin?.on('error', (e) => this.onerror?.(e));
      proc.stdout?.on('data', (chunk: Buffer) => {
        if (overflowed) return;
        try { self._readBuffer.append(chunk); self.processReadBuffer(); } catch (e) { overflowed = true; this.onerror?.(e as Error); this.close().catch(() => {}); }
      });
      proc.stdout?.on('error', (e) => this.onerror?.(e));
      if (self._stderrStream && proc.stderr) proc.stderr.pipe(self._stderrStream);
    });
  }

  /**
   * The SDK's close sequence, once and for the whole group (Windows: the tree): stdin EOF, up to 2 s; SIGTERM, up to 2 s;
   * then SIGKILL. The SDK's own close then finds the process gone, instead of waiting through its stdin EOF and SIGTERM
   * steps a second time (about 6 s per connection for a server that ignores both).
   */
  override async close(): Promise<void> {
    const proc = (this as unknown as SdkStdio)._process;
    const exited = () => !proc || proc.exitCode !== null || proc.signalCode !== null;
    const waitExit = (ms: number) => exited() ? Promise.resolve()
      : Promise.race([new Promise((done) => proc!.once('exit', done)), new Promise((done) => setTimeout(done, ms).unref())]);
    if (proc && !exited()) {
      proc.stdin?.end();
      await waitExit(2000);
      if (!exited()) { endTree(proc, 'SIGTERM'); await waitExit(2000); }
      if (!exited()) { endTree(proc, 'SIGKILL'); await waitExit(1000); }
    }
    return super.close();
  }
}

/** A detached copy of the partial snapshot (the abandoned run may still assign fields) marked as stopped. */
function stoppedSnapshot(live: Snapshot, cause: StopCause, progress: Progress): Snapshot {
  const snap: Snapshot = {
    ...live, tools: [...live.tools], resources: [...live.resources], resourceTemplates: [...live.resourceTemplates], prompts: [...live.prompts],
    listMeta: { ...live.listMeta }, resourceReads: { ...live.resourceReads }, coverage: { ...live.coverage },
    // The calls finished so far (the abandoned run may still push more).
    ...(live.active ? { active: { ...live.active, calls: [...live.active.calls] } } : {}),
    transport: { ...live.transport, probes: { ...live.transport.probes }, timings: { ...live.transport.timings }, exchanges: progress.tracer ? ruleExchanges(progress.tracer) : [...live.transport.exchanges] },
  };
  if (progress.tracer) snap.transport.timings = { ...progress.tracer.timings };
  const seen = progress.collect?.();
  if (seen?.timings) snap.transport.timings = seen.timings;
  if (progress.stderrTail && snap.target.kind === 'stdio') snap.transport.stdio ??= stdioObservation(progress.nonJsonStdout, progress.stderrTail());
  // Errors and modern results observed so far are evidence for the rules that read them (SPEC-016, SPEC-012/013).
  if (seen) {
    snap.transport.observedErrors ??= seen.observedErrors;
    snap.transport.modernResults ??= seen.modernResults;
    if (seen.notifications && Object.keys(seen.notifications.methods).length) snap.transport.notifications ??= seen.notifications;
  }
  const at = PHASES.indexOf(progress.phase as (typeof PHASES)[number]);
  const unfinished = at < 0 ? [progress.phase] : PHASES.slice(at);
  if (cause.kind === 'budget') return budgetStopped(snap, live, cause.budget, progress, unfinished);
  const ms = cause.ms;
  // Every check had run: the deadline only cut short the wait for connections to close.
  if (progress.phase === CLOSING) return snap;
  // The phase cut short and every later one in the run's order did not finish: the engine does not let a rule that
  // reads their data pass on it.
  snap.limits = {
    truncated: [...(live.limits?.truncated ?? [])],
    stopped: { maxDurationMs: ms, phase: progress.phase, completed: [...(progress.completed ?? [])], unfinished: [...unfinished] },
  };
  const why = `stopped by --max-duration (${ms} ms) during ${progress.phase}`;
  if (snap.era === 'unknown' && !snap.fatal && snap.coverage.toolLevel === 'ok') {
    // As after a --timeout: what the stdio server wrote (stderr is masked as it arrives) names the cause of the hang.
    const output = snap.target.kind === 'stdio' && progress.stderrTail ? startupOutput(progress.stderrTail(), progress.nonJsonStdout, createRedactor()) : '';
    snap.fatal = `no handshake within --max-duration (${ms} ms)${output}`;
    snap.coverage = { toolLevel: 'connect-failed', reason: why };
  } else if (snap.coverage.toolLevel === 'ok') {
    snap.coverage = { toolLevel: 'stopped', reason: why };
  }
  return snap;
}


/**
 * The snapshot of a run whose byte budget ran out (F146), copied as for a --max-duration stop: the read that crossed
 * the budget stopped at it, nothing more was read, and the rules run on what was observed. `limits.truncated` records
 * the cut and `limits.budgetExhausted` the phases that did not finish; the coverage is partial unless every check ran.
 */
function budgetStopped(snap: Snapshot, live: Snapshot, budget: ByteBudget, progress: Progress, unfinished: string[]): Snapshot {
  const overBytes = budget.exhausted?.overBytes ?? 1;
  const truncated: NonNullable<Snapshot['limits']>['truncated'] = [
    ...(live.limits?.truncated ?? []),
    { where: `snapshot budget (${overBytes} bytes over)`, length: budget.bytes + overBytes, cap: budget.bytes, unit: 'bytes' },
  ];
  // Every check had run (a late message while the connections closed): only the cut is recorded.
  if (progress.phase === CLOSING) {
    snap.limits = { truncated };
    return snap;
  }
  snap.limits = {
    truncated,
    budgetExhausted: { bytes: budget.bytes, overBytes, phase: progress.phase, completed: [...(progress.completed ?? [])], unfinished: [...unfinished] },
  };
  const why = `${BUDGET_ERROR} (${budget.bytes} bytes) during ${progress.phase}`;
  if (snap.era === 'unknown' && !snap.fatal && snap.coverage.toolLevel === 'ok') {
    snap.fatal = `no handshake within the snapshot budget (${budget.bytes} bytes)`;
    snap.coverage = { toolLevel: 'connect-failed', reason: why };
  } else if (snap.coverage.toolLevel === 'ok') {
    snap.coverage = { toolLevel: 'stopped', reason: why };
  }
  return snap;
}
