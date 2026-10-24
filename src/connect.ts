// buildSnapshot: preflight → auth probe → era → connect/fallback → listing → wire probes → active.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { emptySnapshot, type AuthProbe, type ObservedError, type Snapshot, type TargetOpt, type TlsObservation } from './snapshot.js';
import { describeCause, describeHttpFailure, diagnosisText, networkCause } from './diagnose.js';
import { capSnapshot, ERROR_BODY_CAP } from './limits.js';
import { CLIENT_CAPABILITIES, TEXT_ONLY_CAPABILITIES } from './protocol/clientCaps.js';
import { listAll, LooseResult } from './protocol/legacy.js';
import { ModernClient, MODERN_VERSION } from './protocol/modern.js';
import { RecordingTransport } from './protocol/recording.js';
import { createTracer, scrub, type Redactor, type Tracer } from './protocol/trace.js';
import { runActive } from './probe/active.js';
import { runAuthProbe } from './probe/auth.js';
import { defaultDeps, lookupHost, preflight, tlsCheckWithRetry, type Deps } from './probe/network.js';
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
  /** --local (true) or --no-local (false); unset: detected from the host (R-35, R-36). */
  local?: boolean;
}

/** The redactor for these options; before the rules only strong values (R-8), `all` adds --env values under a plain name. */
export function redactorFor(opts: BuildOptions, all = false): Redactor {
  const t = opts.target;
  return (all ? undefined : opts.redactor) ?? buildRedactor({
    bearer: opts.bearer, headers: opts.headers,
    ...(t.kind === 'http' ? { url: t.url } : { argv: [t.command, ...t.args], env: t.env }),
  }, !all);
}

/** Where a run is; --max-duration reports the phase and stops at the next checkpoint. */
interface Progress {
  phase: string;
  stopped?: boolean;
  tracer?: Tracer;
  stderrTail?: () => string;
  nonJsonStdout?: string[];
  /** Close open clients (and the stdio child) when the deadline hits. */
  close?: () => Promise<void>;
  /** Every stdio server process still running (main and fresh connections), ended at the deadline (R-60). */
  children?: Set<ChildProcess>;
  /** Aborted at the deadline: the tracer then sends no more HTTP requests and cancels its probes in flight (R-6). */
  abort: AbortController;
}

class Stopped extends Error {}

function checkpoint(p: Progress | undefined, phase: string): void {
  if (!p) return;
  if (p.stopped) throw new Stopped(phase);
  p.phase = phase;
}

export interface BuildResult {
  snap: Snapshot;
  stderrTail?: string;
  tracer?: Tracer;
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

async function listEverything(snap: Snapshot, list: Lister): Promise<void> {
  const caps = snap.capabilities ?? {};
  const plan: Array<[string, string, string, keyof Pick<Snapshot, 'tools' | 'resources' | 'resourceTemplates' | 'prompts'>]> = [['tools/list', 'tools', 'tools', 'tools']];
  if (caps.resources !== undefined) plan.push(['resources/list', 'resources', 'resources', 'resources'], ['resources/templates/list', 'resourceTemplates', 'resourceTemplates', 'resourceTemplates']);
  if (caps.prompts !== undefined) plan.push(['prompts/list', 'prompts', 'prompts', 'prompts']);
  for (const [method, key, metaKey, field] of plan) {
    let r = await list(method, key);
    // A dropped connection is the network's fault, not the server's: retry once before SPEC-020 can report it.
    if (r.error && NETWORK_ERROR.test(r.error)) r = await list(method, key);
    snap[field] = r.items;
    snap.listMeta[metaKey] = { pages: r.pages.length, rawPages: r.pages, error: r.error };
  }
  // A declared (or, on 2026-07-28, implied) tools capability whose list fails means nothing could be checked:
  // say so instead of reporting a clean run (SPEC-020 reports the failure itself).
  const toolsErr = snap.listMeta.tools?.error;
  if (toolsErr && (caps.tools !== undefined || snap.era === 'modern') && snap.coverage.toolLevel === 'ok') {
    snap.coverage = { toolLevel: 'list-failed', reason: `tools/list failed: ${toolsErr}` };
  }
}

async function readUiResources(snap: Snapshot, read: Reader, now: () => number): Promise<void> {
  const uris = new Set<string>();
  for (const t of snap.tools) { const u = uiUriOf(t); if (isStr(u) && u.startsWith('ui://')) uris.add(u); }
  for (const r of snap.resources) if (isStr(r.uri) && r.uri.startsWith('ui://')) uris.add(r.uri);
  for (const uri of uris) {
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

const legacyLister = (client: Client, timeoutMs: number): Lister => (m, k) => listAll(client, m, k, timeoutMs);
const legacyReader = (client: Client, timeoutMs: number): Reader => async (uri) => {
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
  /** The failing initialize response (B7 diagnostics). */
  contentType?: string;
  body?: string;
}

const MODERN_CODES = [-32020, -32021, -32022];

function modernErrorBody(tracer: Tracer): boolean {
  const last = [...tracer.exchanges].reverse().find((e) => e.label === 'sdk initialize');
  const err = isObj(last?.json) && isObj(last!.json.error) ? last!.json.error : undefined;
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
        ok: false, status, message: cleanErrorMessage((e as Error).message, status, tracer.redactor), // masked before its cuts (SEC-1)
        cause: status === undefined ? networkCause(e) : undefined, contentType: failed?.contentType, body: failed?.bodySnippet,
      };
      if (allowSse && status !== undefined && [400, 404, 405].includes(status) && !modernErrorBody(tracer)) {
        const sse = await connectSse(url, headers, tracer, timeoutMs, variant);
        if (sse.ok) return sse;
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
  return status !== undefined && status >= 100 && !m.includes(`HTTP ${status}`) ? `HTTP ${status}: ${m}` : m; // the SDK's -1 is no HTTP status (R-12)
}

async function connectSse(url: URL, headers: Record<string, string>, tracer: Tracer, timeoutMs: number, variant: ClientVariant = {}): Promise<LegacyConn> {
  const client = newClient(variant.clientName, variant.capabilities);
  const inner = new SSEClientTransport(url, { requestInit: { headers }, fetch: tracer.fetch });
  const rec = new RecordingTransport(inner);
  try {
    await withTimeout(client.connect(rec, { timeout: timeoutMs }), timeoutMs + 1000, 'SSE connect');
    return { ok: true, client, rec, kind: 'sse', protocolVersion: (rec.initializeRaw as { protocolVersion?: string })?.protocolVersion };
  } catch (e) {
    await client.close().catch(() => {});
    return { ok: false, message: `SSE fallback: ${(e as Error).message}` };
  }
}

function collectErrors(tracer: Tracer | undefined, rec: RecordingTransport | undefined): ObservedError[] {
  const out: ObservedError[] = [...(rec?.errors ?? [])];
  for (const e of tracer?.exchanges ?? []) {
    if (e.label.startsWith('sdk ') || !isObj(e.requestJson) || e.requestJson.jsonrpc !== '2.0') continue;
    const msgs = Array.isArray(e.json) ? e.json : [e.json];
    for (const m of msgs) {
      if (isObj(m) && isObj(m.error)) {
        out.push({ source: e.label, requestId: e.requestJson.id, responseId: m.id, code: m.error.code, message: m.error.message, modern: e.requestHeaders['mcp-protocol-version'] === MODERN_VERSION });
      }
    }
  }
  return out;
}

async function buildHttp(snap: Snapshot, urlAsEntered: string, opts: BuildOptions, deps: Deps, progress?: Progress): Promise<BuildResult> {
  const url = new URL(urlAsEntered);
  const timeoutMs = opts.timeoutMs ?? 30000;
  const connectTimeout = Math.min(timeoutMs, 15000);
  const headers = { ...(opts.headers ?? {}) };
  const tracer = createTracer(redactorFor(opts), deps.now, progress?.abort.signal);
  if (progress) progress.tracer = tracer;
  const authHeaders: Record<string, string> = { ...headers };
  if (opts.bearer) authHeaders.authorization = `Bearer ${opts.bearer}`;

  snap.transport.dns = await lookupHost(url.hostname, deps);
  snap.localMode = opts.local ?? isLocalTarget(snap.transport.dns);
  const tls: TlsObservation[] = [];
  snap.transport.tls = tls;
  if (url.protocol === 'https:') tls.push({ host: url.host, role: 'mcp', ...(await tlsCheckWithRetry(deps, url.hostname, Number(url.port || 443))) });

  // 1. preflight
  const pf = await preflight(tracer, url, connectTimeout, deps.sleep);
  snap.transport.preflight = pf;
  let trigger: AuthProbe['trigger'] | undefined = pf.status === 401 ? 'preflight-401' : pf.status === 403 && pf.headers?.['www-authenticate'] ? 'preflight-403' : undefined;

  // 2. era detection
  const modern = new ModernClient(url, tracer, authHeaders, timeoutMs);
  const disc = await modern.request('server/discover', {}, { label: 'discover', timeoutMs: connectTimeout });
  snap.transport.probes.discover = disc.exchange;
  const discOk = disc.exchange.status === 200 && !!disc.result && Array.isArray(disc.result.supportedVersions);
  const discSignal = disc.exchange.status === 400 && MODERN_CODES.includes(Number(disc.error?.code));
  if (disc.result && disc.exchange.status === 200) snap.discoverRaw = disc.result;

  // 3. legacy connect (with SSE fallback)
  const conn = await connectLegacyHttp(url, authHeaders, tracer, connectTimeout, {}, !discOk && !discSignal);
  if (progress) progress.close = async () => { await conn.client?.close().catch(() => {}); };
  await tracer.flush();
  const authFailed = conn.status === 401 || (!conn.ok && !discOk && disc.exchange.status === 401);
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

  // 4. auth probe
  if (authFailed) {
    snap.coverage = opts.bearer ? { toolLevel: 'token-rejected', reason: 'token rejected (401)' } : { toolLevel: 'auth-required', reason: 'server requires OAuth' };
    trigger ??= opts.bearer ? 'bearer-rejected' : 'preflight-401';
  }
  if (trigger) {
    checkpoint(progress, 'auth probe');
    const challengeExchange = pf.status === 401 || pf.status === 403 ? pf : [...tracer.exchanges].reverse().find((e) => e.status === 401) ?? pf;
    const { probe, tlsHosts } = await runAuthProbe({ tracer, url, trigger, challengeExchange, deps, timeoutMs, activeAuth: !!opts.activeAuth });
    snap.authProbe = probe;
    for (const h of tlsHosts) tls.push({ host: h.host, role: 'as', ...(await tlsCheckWithRetry(deps, h.hostname, h.port)) });
  }

  const connected = conn.ok || snap.era === 'modern';
  if (!connected && !authFailed) {
    const d = conn.status === 403
      ? { kind: 'http' as const, status: 403, summary: 'HTTP 403 (forbidden)' }
      : conn.cause ? describeCause(url, conn.cause) : describeHttpFailure(url, { status: conn.status, contentType: conn.contentType, body: conn.body, message: conn.message });
    snap.connectDiagnosis = d;
    snap.fatal = `could not complete a handshake: ${diagnosisText(d)}`;
    snap.coverage = { toolLevel: 'connect-failed', reason: diagnosisText(d) };
  }

  if (connected && !authFailed) {
    const lister: Lister = conn.ok ? legacyLister(conn.client!, timeoutMs) : (m, k) => modern.listAll(m, k);
    const reader: Reader = conn.ok ? legacyReader(conn.client!, timeoutMs) : modernReader(modern);
    checkpoint(progress, 'listing');
    await listEverything(snap, lister);
    checkpoint(progress, 'UI resource reads');
    await readUiResources(snap, reader, deps.now);
    const useModern = snap.era === 'modern' || snap.era === 'dual';
    checkpoint(progress, 'wire probes');
    snap.transport.probes = {
      ...snap.transport.probes,
      ...(await runWireProbes({
        snap, timeoutMs, now: deps.now, client: conn.client, modern: useModern ? modern : undefined, sleep: deps.sleep,
        http: { tracer, url, authHeaders, sessionId: conn.sessionId, protocolVersion: conn.protocolVersion },
      })),
    };
    const fresh = (variant: ClientVariant = {}) => freshTools(url, authHeaders, tracer, connectTimeout, timeoutMs, conn.ok ? conn.kind : undefined, variant);
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
      snap.active = await runActive({
        snap, toolArgs: opts.toolArgs, timeoutMs, now: deps.now, client: conn.client, modern: conn.ok ? undefined : modern,
        listWithClientName: conn.ok && conn.kind === 'streamable-http' ? async (name) => (await fresh({ clientName: name }))?.map(toolName) : undefined,
      });
    }
  }
  await conn.client?.close().catch(() => {});
  await tracer.flush();
  snap.transport.exchanges = tracer.exchanges;
  snap.transport.timings = tracer.timings;
  snap.transport.modernResults = modern.results;
  snap.transport.observedErrors = collectErrors(tracer, conn.rec);
  return { snap, tracer };
}

/** Some listed tool links a UI resource (the text-only re-list for APPS-019 is needed). */
function linksUi(snap: Snapshot): boolean {
  return snap.tools.some((t) => isStr(uiUriOf(t)));
}

/** tools/list on a new connection, optionally with another clientInfo.name or without the UI extension. */
async function freshTools(url: URL, headers: Record<string, string>, tracer: Tracer, connectTimeout: number, timeoutMs: number, kind: 'streamable-http' | 'sse' | undefined, variant: ClientVariant = {}): Promise<Record<string, unknown>[] | undefined> {
  if (!kind) {
    const fresh = new ModernClient(url, tracer, headers, timeoutMs, variant.capabilities);
    const r = await fresh.listAll('tools/list', 'tools');
    return r.error ? undefined : r.items;
  }
  const conn = kind === 'sse' ? await connectSse(url, headers, tracer, connectTimeout, variant) : await connectLegacyHttp(url, headers, tracer, connectTimeout, variant, false);
  if (!conn.ok) return undefined;
  try {
    const r = await listAll(conn.client!, 'tools/list', 'tools', timeoutMs);
    return r.error ? undefined : r.items;
  } finally {
    await conn.client!.close().catch(() => {});
  }
}

// ---------- stdio ----------

interface StdioConn {
  client: Client;
  rec: RecordingTransport;
  nonJson: string[];
  stderr: () => string;
}

function isJsonLine(line: string): boolean {
  try { JSON.parse(line); return true; } catch { return false; }
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
  const inner = new GroupStdioTransport({ command: t.command, args: t.args, env: { ...getDefaultEnvironment(), ...(t.env ?? {}) }, cwd: t.cwd, stderr: 'pipe' });
  let stderrTail = '';
  // Masked before the 4096-character tail and the 200-character summary lines cut it (SEC-1).
  // Decoded as a stream, so an echo split inside a UTF-8 character between two chunks is still one string to mask (R-10).
  (inner.stderr as NodeJS.ReadableStream | null)?.setEncoding('utf8').on('data', (c: string) => { stderrTail = scrub(stderrTail + c, r).slice(-4096); });
  const nonJson: string[] = [];
  const tap = () => {
    const proc = (inner as unknown as { _process?: ChildProcess })._process;
    if (proc && progress?.children) {
      if (progress.stopped) endTree(proc, 'SIGKILL'); // spawned while the deadline was ending the others
      // On POSIX the entry stays while the server's process group outlives its wrapper (R-5).
      else for (const set of [progress.children, everyChild]) { set.add(proc); proc.once('exit', () => { if (!running(proc)) set.delete(proc); }); }
    }
    // Split into lines as bytes, then decoded: the SDK reads the same stream as Buffers, and a chunk can end inside a UTF-8 character (R-10).
    let buf = Buffer.alloc(0);
    proc?.stdout?.on('data', (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      let i;
      while ((i = buf.indexOf(10)) >= 0) {
        const line = buf.subarray(0, i).toString('utf8').replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.trim() && !isJsonLine(line)) nonJson.push(line);
      }
    });
  };
  const rec = new RecordingTransport(inner as Transport, tap);
  const client = newClient(variant.clientName, variant.capabilities);
  try {
    await withTimeout(client.connect(rec, { timeout: timeoutMs }), timeoutMs + 1000, 'initialize');
  } catch (e) {
    await client.close().catch(() => {});
    const err = e as Error;
    throw Object.assign(new Error(`${err.message}${stderrTail ? `; stderr: ${stderrSummary(stderrTail, r)}` : ''}`), { stderrTail });
  }
  return { client, rec, nonJson, stderr: () => stderrTail };
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
    snap.fatal = `could not start or initialize the stdio server: ${(e as Error).message}`;
    snap.coverage = { toolLevel: 'connect-failed', reason: (e as Error).message };
    return { snap, stderrTail: (e as { stderrTail?: string }).stderrTail };
  }
  if (progress) {
    progress.stderrTail = conn.stderr;
    progress.nonJsonStdout = conn.nonJson;
    progress.close = async () => { await conn.client.close().catch(() => {}); };
  }
  snap.era = 'legacy';
  adoptInitialize(snap, conn.rec.initializeRaw);
  const lister = legacyLister(conn.client, timeoutMs);
  checkpoint(progress, 'listing');
  await listEverything(snap, lister);
  checkpoint(progress, 'UI resource reads');
  await readUiResources(snap, legacyReader(conn.client, timeoutMs), deps.now);
  checkpoint(progress, 'wire probes');
  snap.transport.probes = await runWireProbes({ snap, timeoutMs, now: deps.now, client: conn.client });
  const fresh = async (variant: ClientVariant = {}) => {
    try {
      const c = await connectStdio(t, connectTimeout, redactorFor(opts), variant, progress);
      try { const r = await listAll(c.client, 'tools/list', 'tools', timeoutMs); return r.error ? undefined : r.items; }
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
    checkpoint(progress, 'active tool calls');
    if (opts.active) {
      snap.active = await runActive({
        snap, toolArgs: opts.toolArgs, timeoutMs, now: deps.now, client: conn.client,
        listWithClientName: async (name) => (await fresh({ clientName: name }))?.map(toolName),
      });
    }
  }
  await new Promise((r) => setTimeout(r, 50)); // let trailing stdout/stderr arrive
  snap.transport.stdio = { nonJsonStdout: conn.nonJson, stderrTail: conn.stderr() };
  snap.transport.observedErrors = collectErrors(undefined, conn.rec);
  await conn.client.close().catch(() => {});
  return { snap, stderrTail: conn.stderr() };
}

// ---------- entry ----------

export async function buildSnapshot(opts: BuildOptions, deps: Deps = defaultDeps): Promise<BuildResult> {
  const options: Snapshot['options'] = {
    target: opts.platforms ?? 'all', active: !!opts.active, activeAuth: !!opts.activeAuth,
    authenticated: !!opts.bearer || Object.keys(opts.headers ?? {}).length > 0,
  };
  const t = opts.target;
  const snap = t.kind === 'http'
    ? emptySnapshot({ kind: 'http', urlAsEntered: t.url, url: new URL(t.url) }, options)
    : emptySnapshot({ kind: 'stdio', command: t.command, args: t.args }, options);
  if (t.kind === 'http') snap.env = { nodeExtraCaCerts: !!process.env.NODE_EXTRA_CA_CERTS };
  const progress: Progress = { phase: 'connect', children: new Set(), abort: new AbortController() };
  const run = t.kind === 'http' ? buildHttp(snap, t.url, opts, deps, progress) : buildStdio(snap, t, opts, deps, progress);
  const result = opts.maxDurationMs ? await withDeadline(run, snap, opts.maxDurationMs, progress) : await run;
  await endChildren(progress.children); // a failed initialize leaves its child to the SDK's unawaited close() (R-4)
  // Secrets are masked before the input caps: a cut through an echoed secret leaves a prefix no scrub recognises
  // (SEC-1). The target stays as entered (rules parse and hash it).
  const masked = { ...redactDeep(result.snap, redactorFor(opts)), target: result.snap.target };
  capSnapshot(masked);
  return { ...result, snap: masked };
}

/** Resolve with whatever was observed when --max-duration runs out; the rest of the run is abandoned. */
async function withDeadline(run: Promise<BuildResult>, snap: Snapshot, ms: number, progress: Progress): Promise<BuildResult> {
  let timer: NodeJS.Timeout | undefined;
  let ending: Promise<void> | undefined;
  const stop = new Promise<BuildResult>((resolve) => {
    timer = setTimeout(() => {
      progress.stopped = true;
      progress.abort.abort();
      void progress.close?.();
      const stopped = { snap: stoppedSnapshot(snap, ms, progress), tracer: progress.tracer, stderrTail: progress.stderrTail?.() };
      ending = endChildren(progress.children);
      void ending.then(() => resolve(stopped));
    }, ms);
  });
  run.catch(() => {}); // a Stopped checkpoint (or a closed client) after the deadline is expected
  try {
    // Past the deadline the run is abandoned however it settles ('Not connected' calls are no finished run, R-60).
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

/** End the stdio servers still running so none outlives the CLI: SIGTERM, then SIGKILL, each with a bounded wait (R-60). */
async function endChildren(children: Set<ChildProcess> | undefined, graceMs = 1000): Promise<void> {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    const live = [...(children ?? [])].filter(running); // a process leaves the set on 'exit' unless its group lives on
    if (!live.length) return;
    for (const c of live) endTree(c, signal);
    for (const until = Date.now() + graceMs; live.some(running) && Date.now() < until;) await new Promise((done) => setTimeout(done, 25));
  }
}

/** Every stdio server of every run in this process, for the CLI's signal handler (endAllNow). */
const everyChild = new Set<ChildProcess>();

/** A stdio server still running: the process itself or, on POSIX, anything left in its process group (R-5). */
function running(c: ChildProcess): boolean {
  if (c.exitCode === null && c.signalCode === null) return true;
  try { return process.platform !== 'win32' && !!c.pid && process.kill(-c.pid, 0); } catch { return false; }
}

/** Send `signal` to a stdio server and everything it started: its process group on POSIX, its tree on Windows (R-5). */
function endTree(c: ChildProcess, signal: NodeJS.Signals): void {
  // Windows: before the wrapper (cmd.exe for npx, .cmd and .bat) dies, as /T finds only the children of a live pid.
  if (process.platform === 'win32') { if (c.pid) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }
  else if (c.pid) { try { process.kill(-c.pid, signal); return; } catch { /* no group (any more): the process alone */ } }
  c.kill(signal);
}

/** End every stdio server this process started that is still running; the CLI calls it on SIGINT, SIGTERM and SIGHUP (R-5). */
export function endAllNow(): Promise<void> {
  return endChildren(everyChild);
}

/** The SDK 1.32.1 transport's private state that GroupStdioTransport works on (client/stdio.js). */
type SdkStdio = { _process?: ChildProcess; _serverParams: ConstructorParameters<typeof StdioClientTransport>[0]; _readBuffer: { append(chunk: Buffer): void }; _stderrStream: NodeJS.WritableStream | null; processReadBuffer(): void };

/** The SDK's stdio transport, but a server started through a wrapper (npx, .cmd, .bat, sh -c) ends with everything it
 *  started (R-5): on POSIX it leads its own process group; close() ends the group (Windows: the tree) before the wrapper. */
class GroupStdioTransport extends StdioClientTransport {
  /** The SDK's start (client/stdio.js:60-107) with detached: true; Windows keeps it as is (no groups there). */
  override async start(): Promise<void> {
    if (process.platform === 'win32') return super.start();
    const self = this as unknown as SdkStdio;
    if (self._process) throw new Error('StdioClientTransport already started!');
    const p = self._serverParams;
    return new Promise((resolve, reject) => {
      const proc = self._process = spawn(p.command, p.args ?? [], { env: { ...getDefaultEnvironment(), ...p.env }, stdio: ['pipe', 'pipe', p.stderr ?? 'inherit'], shell: false, cwd: p.cwd, detached: true });
      proc.on('error', (e) => { reject(e); this.onerror?.(e); });
      proc.on('spawn', () => resolve());
      proc.on('close', () => { self._process = undefined; this.onclose?.(); });
      proc.stdin?.on('error', (e) => this.onerror?.(e));
      proc.stdout?.on('data', (chunk: Buffer) => { try { self._readBuffer.append(chunk); self.processReadBuffer(); } catch (e) { this.onerror?.(e as Error); this.close().catch(() => {}); } });
      proc.stdout?.on('error', (e) => this.onerror?.(e));
      if (self._stderrStream && proc.stderr) proc.stderr.pipe(self._stderrStream);
    });
  }

  /** As the SDK's close (stdin EOF, up to 2 s), then the group or tree gets SIGTERM before the SDK ends the wrapper. */
  override async close(): Promise<void> {
    const proc = (this as unknown as SdkStdio)._process;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      proc.stdin?.end();
      await Promise.race([new Promise((done) => proc.once('exit', done)), new Promise((done) => setTimeout(done, 2000).unref())]);
      if (proc.exitCode === null && proc.signalCode === null) endTree(proc, 'SIGTERM');
    }
    return super.close();
  }
}

/** A detached copy of the partial snapshot (the abandoned run may still assign fields) marked as stopped. */
function stoppedSnapshot(live: Snapshot, ms: number, progress: Progress): Snapshot {
  const snap: Snapshot = {
    ...live, tools: [...live.tools], resources: [...live.resources], resourceTemplates: [...live.resourceTemplates], prompts: [...live.prompts],
    listMeta: { ...live.listMeta }, resourceReads: { ...live.resourceReads }, coverage: { ...live.coverage },
    transport: { ...live.transport, probes: { ...live.transport.probes }, timings: { ...live.transport.timings }, exchanges: [...(progress.tracer?.exchanges ?? live.transport.exchanges)] },
  };
  if (progress.tracer) snap.transport.timings = { ...progress.tracer.timings };
  if (progress.stderrTail && snap.target.kind === 'stdio') snap.transport.stdio ??= { nonJsonStdout: [...(progress.nonJsonStdout ?? [])], stderrTail: progress.stderrTail() };
  snap.limits = { truncated: [...(live.limits?.truncated ?? [])], stopped: { maxDurationMs: ms, phase: progress.phase } };
  const why = `stopped by --max-duration (${ms} ms) during ${progress.phase}`;
  if (snap.era === 'unknown' && !snap.fatal && snap.coverage.toolLevel === 'ok') {
    snap.fatal = `no handshake within --max-duration (${ms} ms)`;
    snap.coverage = { toolLevel: 'connect-failed', reason: why };
  } else if (snap.coverage.toolLevel === 'ok') {
    snap.coverage = { toolLevel: 'stopped', reason: why };
  }
  return snap;
}

