// Snapshot and observation types (§4.2). Rules are pure functions over a Snapshot.
import type { Listing } from './listing/types.js';

export type Platform = 'claude' | 'chatgpt' | 'spec';
export type Severity = 'error' | 'warning' | 'info';
export type Era = 'modern' | 'legacy' | 'dual' | 'sse-legacy' | 'unknown';
export type TargetOpt = 'claude' | 'chatgpt' | 'all';

export interface HttpExchange {
  label: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>; // redacted
  requestJson?: unknown;
  status?: number;
  headers?: Record<string, string>;
  contentType?: string;
  bodySnippet?: string; // <= 4 KB
  /**
   * The parsed body. Since 0.4.0 (F036) kept only on the exchanges the rules read it from: the wire probes in
   * `transport.probes` (rpcView), the auth probe's requests (PRM, AS metadata, DCR, token) and, for a direct
   * createTracer user, every exchange unless `keepJson: false`. The run's other exchanges (the SDK traffic, listings,
   * UI reads, active calls) carry `jsonRpc`, `bodyBytes` and `bodySha256` instead; their results are in the snapshot
   * fields built from them (tools, listMeta.rawPages, resourceReads, modernResults, active.calls).
   */
  json?: unknown;
  /** Bytes of the body read (kept or not). */
  bodyBytes?: number;
  /** SHA-256 (hex) of the body text as kept (the read cap's prefix); over the masked text when a known secret occurs in it. */
  bodySha256?: string;
  /** The JSON-RPC responses in the body (one, or each of a batch or SSE stream), without their results (F036). */
  jsonRpc?: JsonRpcSummary[];
  /** The body parsed as a JSON object or array (kept or not): AUTH-021 tells "not JSON" from "JSON" without `json`. */
  jsonParsed?: true;
  /** `error` of a JSON object body that is a string (an OAuth error such as invalid_grant, RFC 6749 5.2), first 200 chars. */
  oauthError?: string;
  /** Time to headers (latency rules use this). */
  durationMs: number;
  /** Time until the body was read (or reading stopped at the matching SSE response). */
  bodyMs?: number;
  error?: { name: string; code?: string | number; causeCode?: string; message: string };
}

/** One JSON-RPC response of a body: its id, whether it carried a result, its error's code and message, and whether it
 *  also had a `method` (then it is a server request or notification, not a response). */
export interface JsonRpcSummary {
  id?: unknown;
  result?: true;
  method?: true;
  error?: { code?: unknown; message?: unknown; data?: unknown };
  /** What rules read of the result: `isError` of a tools/call result, the length of `contents` of a resources/read result. */
  resultInfo?: { isError?: boolean; contents?: number };
  /** The whole result, only where a rule reads it (the discover probe: it is the same object as `discoverRaw`). */
  resultValue?: unknown;
}

/** A JSON-RPC exchange observed through the SDK client (stdio, SSE, or legacy HTTP). */
export interface JsonRpcObservation {
  kind: 'jsonrpc';
  label: string;
  requestId?: unknown;
  responseId?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
  transportError?: string;
  durationMs: number;
}

export type WireProbeName =
  | 'preflight'
  | 'discover'
  | 'get'
  | 'delete'
  | 'badVersion'
  | 'badVersionModern'
  | 'unknownMethod'
  | 'unknownMethodModern'
  | 'unknownTool'
  | 'resourceMissing'
  | 'resourceMissingModern'
  | 'headerMismatchNone'
  | 'headerMismatchWrong'
  | 'originNone'
  | 'originClaude'
  | 'originChatgpt'
  | 'originEvil'
  | 'challenge'
  | 'tasksGet'
  | 'subscriptionsListen';

/** Server notifications seen in the bodies this run read (HTTP only): method names with counts, capped, redacted. */
export interface NotificationLog {
  methods: Record<string, number>;
  /** Notifications of methods beyond the cap of distinct names. */
  otherMethods?: number;
  /** notifications/message: how many, how many answered a 2026-07-28 request that carried no
   *  io.modelcontextprotocol/logLevel (the spec says the server MUST NOT), and how many lacked a valid level. */
  message?: { total: number; unrequested: number; invalidLevel: number };
}

export type ProbeObservation = HttpExchange | JsonRpcObservation;

export interface ObservedError {
  source: string;
  requestId?: unknown;
  responseId?: unknown;
  code?: unknown;
  message?: unknown;
  /** The response answered a 2026-07-28 request (MCP-Protocol-Version: 2026-07-28). */
  modern?: boolean;
  /** A successful response (a result, no error object) whose id is not the request's: no code to check (SPEC-016). */
  result?: boolean;
  /** The request's JSON-RPC method (set on `result` entries). */
  method?: string;
}

export interface DnsResult {
  host: string;
  a: string[];
  aaaa: string[];
  error?: string;
  /** Resolver error code when both lookups failed (ENOTFOUND = NXDOMAIN, ENODATA, ETIMEOUT, ...). */
  code?: string;
  /** Addresses from the system resolver (dns.lookup: /etc/hosts, container DNS), when it answered. */
  lookup?: string[];
}

export interface TlsObservation {
  host: string;
  ok: boolean;
  code?: string;
  /** 'mcp': the server URL itself (SRV-001); 'as': an OAuth host (AUTH-010). */
  role?: 'mcp' | 'as';
  attempts?: string[];
  /** Every attempt failed with a timeout or reset: inconclusive, not a certificate verdict. */
  transient?: boolean;
}

/** Why an HTTP handshake failed: the network cause or "not an MCP endpoint", with a hint. */
export interface ConnectDiagnosis {
  kind: 'dns' | 'refused' | 'timeout' | 'no-answer' | 'reset' | 'tls' | 'not-mcp' | 'http' | 'other';
  summary: string;
  code?: string;
  status?: number;
  hint?: string;
}

/** The phases of a run in order (connect.ts); a run skips the ones it does not need (no auth probe on a public server). */
export const PHASES = [
  'connect', 'auth probe', 'listing', 'UI resource reads', 'wire probes', 'tools re-list', 'text-only tools/list', 'active tool calls',
] as const;
export type Phase = (typeof PHASES)[number];

/** Input caps applied before the regex rules and the --max-duration stop. */
export interface Limits {
  /** `unit` items: `length` counts things (UI resources) rather than characters; bytes: the snapshot budget. */
  truncated: Array<{ where: string; length: number; cap: number; unit?: 'items' | 'bytes' }>;
  /**
   * `phase`: the phase the deadline cut short. `completed`: the phases that ran to their end before it, in order.
   * `unfinished`: the phase cut short and every later one: their data is partial or missing, so a rule that reads it
   * reports what it found but cannot pass (the engine skips it with "stopped by --max-duration" when it finds nothing).
   */
  stopped?: { maxDurationMs: number; phase: string; completed?: string[]; unfinished?: string[] };
  /**
   * The snapshot byte budget (SNAPSHOT_BUDGET) ran out (F146): the read that crossed it stopped at the budget, nothing
   * more was read, and the run went on to the rules with what it had. `bytes`: the budget; `overBytes`: what arrived
   * past it in the read that crossed it (at least 1). `phase`, `completed`, `unfinished` as for `stopped`.
   */
  budgetExhausted?: { bytes: number; overBytes: number; phase: string; completed: string[]; unfinished: string[] };
}

export interface AsObservation {
  issuer: string;
  attempts: HttpExchange[];
  discoveryUrl?: string;
  json?: Record<string, unknown>;
}

export interface AuthProbe {
  trigger: 'preflight-401' | 'preflight-403' | 'bearer-rejected';
  challenge?: { status: number; raw: string; parsed: Array<{ scheme: string; params: Record<string, string> }> };
  prmAttempts: HttpExchange[];
  prm?: { url: string; via: 'header' | 'well-known-path' | 'well-known-root'; json: Record<string, unknown>; contentType?: string };
  /** No PRM, but <origin>/.well-known/oauth-authorization-server answered (2025-03-26 discovery); as[0] holds it. */
  legacyDiscovery?: boolean;
  as: AsObservation[];
  invalidToken?: HttpExchange;
  timings: Record<string, number[]>;
  asDns?: DnsResult[];
  active?: { dcr?: HttpExchange; clientId?: string; authorize?: HttpExchange[]; token?: HttpExchange[] };
}

export interface ActiveCall {
  tool: string;
  kind: 'valid' | 'synthetic' | 'invalid-missing' | 'invalid-type';
  args: unknown;
  result?: unknown;
  jsonRpcError?: unknown;
  /** The call never got an answer (timeout, connection error): not a server JSON-RPC error. */
  transportError?: string;
  httpStatus?: number;
  durationMs: number;
}

export interface Snapshot {
  target: { kind: 'http'; urlAsEntered: string; url: URL } | { kind: 'stdio'; command: string; args: string[] }
    /** Listing-only run (--plugin-dir / --openai-manifest without a server): nothing is connected. */
    | { kind: 'listing' };
  localMode: boolean;
  era: Era;
  protocolVersion?: string;
  serverInfo?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  instructions?: unknown;
  initializeRaw?: unknown;
  discoverRaw?: unknown;
  tools: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  resourceTemplates: Record<string, unknown>[];
  prompts: Record<string, unknown>[];
  listMeta: Record<string, { pages: number; rawPages: unknown[]; error?: string }>;
  toolsRelist?: string[];
  toolsFreshConnection?: string[];
  /** tools/list from a connection that did not declare io.modelcontextprotocol/ui (APPS-019). Set only when some tool links a UI. */
  toolsWithoutUi?: Record<string, unknown>[];
  resourceReads: Record<string, { ok: boolean; raw?: unknown; error?: unknown; durationMs: number }>;
  transport: {
    kind: 'streamable-http' | 'sse' | 'stdio';
    exchanges: HttpExchange[];
    preflight?: HttpExchange;
    dns?: DnsResult;
    tls?: TlsObservation[];
    probes: Partial<Record<WireProbeName, ProbeObservation>>;
    timings: Record<string, number[]>;
    sessionId?: string;
    /** nonJsonStdout: the first 50 stdout lines that are not JSON-RPC messages (each cut to 1024 characters);
     *  nonJsonTotal: how many there were in all. */
    stdio?: { nonJsonStdout: string[]; nonJsonTotal?: number; stderrTail: string };
    modernResults?: Array<{ method: string; result: unknown }>;
    observedErrors?: ObservedError[];
    notifications?: NotificationLog;
  };
  authProbe?: AuthProbe;
  active?: { calls: ActiveCall[]; clientInfoVariants?: Record<string, string[]> };
  coverage: { toolLevel: 'ok' | 'auth-required' | 'token-rejected' | 'connect-failed' | 'list-failed' | 'stopped'; reason?: string };
  /** Set when no transport worked (SRV-003 fatal, exit code 3). */
  fatal?: string;
  connectDiagnosis?: ConnectDiagnosis;
  limits?: Limits;
  env?: { nodeExtraCaCerts?: boolean };
  /** --plugin-dir / --openai-manifest inputs (src/listing); absent without them, and the LST rules are skipped. */
  listing?: Listing;
  options: { target: TargetOpt; active: boolean; activeAuth: boolean; authenticated?: boolean };
}

/** Minimal empty snapshot; useful for tests and as a base in connect.ts. */
export function emptySnapshot(target: Snapshot['target'], options: Snapshot['options']): Snapshot {
  return {
    target,
    localMode: false,
    era: 'unknown',
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    listMeta: {},
    resourceReads: {},
    transport: { kind: target.kind === 'stdio' ? 'stdio' : 'streamable-http', exchanges: [], probes: {}, timings: {} },
    coverage: { toolLevel: 'ok' },
    options,
  };
}
