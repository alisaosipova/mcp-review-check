// Snapshot and observation types (§4.2). Rules are pure functions over a Snapshot.

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
  json?: unknown;
  /** Time to headers (latency rules use this). */
  durationMs: number;
  /** Time until the body was read (or reading stopped at the matching SSE response). */
  bodyMs?: number;
  error?: { name: string; code?: string | number; causeCode?: string; message: string };
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
  | 'challenge';

export type ProbeObservation = HttpExchange | JsonRpcObservation;

export interface ObservedError {
  source: string;
  requestId?: unknown;
  responseId?: unknown;
  code?: unknown;
  message?: unknown;
  /** The response answered a 2026-07-28 request (MCP-Protocol-Version: 2026-07-28). */
  modern?: boolean;
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
  kind: 'dns' | 'refused' | 'timeout' | 'reset' | 'tls' | 'not-mcp' | 'http' | 'other';
  summary: string;
  code?: string;
  status?: number;
  hint?: string;
}

/** Input caps applied before the regex rules and the --max-duration stop. */
export interface Limits {
  truncated: Array<{ where: string; length: number; cap: number }>;
  stopped?: { maxDurationMs: number; phase: string };
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
  target: { kind: 'http'; urlAsEntered: string; url: URL } | { kind: 'stdio'; command: string; args: string[] };
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
    stdio?: { nonJsonStdout: string[]; stderrTail: string };
    modernResults?: Array<{ method: string; result: unknown }>;
    observedErrors?: ObservedError[];
  };
  authProbe?: AuthProbe;
  active?: { calls: ActiveCall[]; clientInfoVariants?: Record<string, string[]> };
  coverage: { toolLevel: 'ok' | 'auth-required' | 'token-rejected' | 'connect-failed' | 'list-failed' | 'stopped'; reason?: string };
  /** Set when no transport worked (SRV-003 fatal, exit code 3). */
  fatal?: string;
  connectDiagnosis?: ConnectDiagnosis;
  limits?: Limits;
  env?: { nodeExtraCaCerts?: boolean };
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
