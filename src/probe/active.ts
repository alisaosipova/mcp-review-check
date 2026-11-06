// --active: read-only tool calls, argument synthesis, clientInfo variants (§2.9).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ActiveCall, Snapshot } from '../snapshot.js';
import { mcpParamHeaders, type ModernClient } from '../protocol/modern.js';
import { rpc } from '../protocol/legacy.js';
import { HARD_DESTRUCTIVE, READ_VERBS, WRITE_VERBS } from '../rules/lexicon.js';
import { CLAUDE_TOOL_TIMEOUT_MS } from '../rules/runtime.js';
import { TOOL_021 } from '../rules/schema.js';
import { annotations, isObj, properties, toolName, type Obj } from '../rules/util/access.js';
import { tokenize } from '../rules/util/text.js';

const MAX_TOOLS = 50;
// One second past Claude's limit, so a call that would time out in Claude is seen as exceeding it.
const MAX_CALL_MS = CLAUDE_TOOL_TIMEOUT_MS + 1000;

/** Mutating verbs that only the --active name filter uses (not the rules' WRITE_VERBS, so no rule finds more). */
const PROBE_WRITE_VERBS = new Set([
  'exec', 'kill', 'stop', 'restart', 'reboot', 'shutdown', 'deploy', 'push', 'commit', 'apply', 'install',
  'uninstall', 'rollback', 'clear', 'flush', 'unlink', 'rm', 'notify', 'reply', 'lock', 'unlock', 'grant', 'ban',
  'block', 'enable', 'activate', 'subscribe', 'pause', 'resume', 'toggle',
  // 1.2.0 (I-A03-1)
  'upsert', 'append', 'restore', 'migrate', 'unpublish', 'charge', 'sign', 'vote', 'follow', 'unfollow', 'retweet', 'launch',
  'scale', 'resize', 'mount', 'unmount', 'format', 'encrypt', 'decrypt', 'rotate', 'configure', 'store', 'attach', 'detach',
  'broadcast', 'alert', 'escalate', 'acknowledge',
]);
/** `resolve` is a READ verb (resolve_library_id), but resolving one of these things changes its state (I-A03-1). */
const RESOLVED_THINGS = new Set([
  'incident', 'incidents', 'ticket', 'tickets', 'issue', 'issues', 'alert', 'alerts', 'case', 'cases', 'conflict', 'conflicts',
  'thread', 'threads', 'comment', 'comments', 'bug', 'bugs', 'dispute', 'disputes',
]);
const isWriteVerb = (t: string) => WRITE_VERBS.has(t) || PROBE_WRITE_VERBS.has(t);
/** Glued words that start with a hard-destructive verb but name a thing (droplet_info, dropdown_options). */
const GLUED_NOUNS = /^drop(down|let|box|zone)/;

/** Base forms a token may be inflected from: deletes, deleted, deleting, stopped, running. */
function stems(t: string, first: boolean): string[] {
  const out: string[] = [];
  const undouble = (s: string) => (/([b-df-hj-np-tv-z])\1$/.test(s) ? [s, s.slice(0, -1)] : [s]);
  // -s/-es only in verb position (deletes_file); later in the name it is usually a plural noun (recent_posts).
  if (first && t.endsWith('es')) out.push(t.slice(0, -2));
  if (first && t.endsWith('s')) out.push(t.slice(0, -1));
  if (t.endsWith('ed')) out.push(t.slice(0, -1), ...undouble(t.slice(0, -2)));
  if (t.endsWith('ing')) out.push(...undouble(t.slice(0, -3)), `${t.slice(0, -3)}e`);
  return out.filter((s) => s.length >= 2);
}

/** Words that join a second action to a name's first verb (get_and_kill, fetch_then_restart). */
const CONJUNCTIONS = new Set(['and', 'then', 'or', 'also', 'plus']);

/** The probe-only verb, inflected write verb or glued hard-destructive verb (DELETEFILE) in this token, if any. */
const mutatingVerb = (t: string, verbPosition: boolean): string | undefined =>
  (isWriteVerb(t) ? t : undefined)
  ?? stems(t, verbPosition).find(isWriteVerb)
  ?? (GLUED_NOUNS.test(t) ? undefined : [...HARD_DESTRUCTIVE].find((v) => t.length > v.length && t.startsWith(v)));

/** The name's words: NFKC-folded, split on every character that is not a letter or digit (read+delete, a zero-width
 *  space join), then on camelCase and letter-digit boundaries (I-A03-1). */
const probeTokens = (name: string) => tokenize(name.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' '));

/** A write verb in the name. A name that starts with a read verb (get_order_status, list_commits) keeps the exact
 *  WRITE_VERBS token check of 1.0.0 up to a conjunction; the tokens after one (get_and_kill_process) and every token
 *  of any other name are also checked for the probe-only verbs, inflected forms and an all-caps or glued name that
 *  starts with a hard-destructive verb (DELETEFILE). */
export function hasWriteVerb(name: string): boolean {
  return writeVerbOf(name) !== undefined;
}

/** The write verb hasWriteVerb finds in the name (its base form), or undefined. */
export function writeVerbOf(name: string): string | undefined {
  const tokens = probeTokens(name);
  const exact = tokens.find((t) => WRITE_VERBS.has(t));
  if (exact) return exact;
  if (tokens.length === 0) return undefined;
  if (tokens[0] === 'resolve' && RESOLVED_THINGS.has(tokens[1])) return 'resolve';
  const first = (ts: string[]) => {
    for (let i = 0; i < ts.length; i++) {
      if (CONJUNCTIONS.has(ts[i])) continue;
      const v = mutatingVerb(ts[i], i === 0);
      if (v) return v;
    }
    return undefined;
  };
  if (READ_VERBS.has(tokens[0])) {
    const joined = tokens.findIndex((t) => CONJUNCTIONS.has(t));
    return joined > 0 ? first(tokens.slice(joined + 1)) : undefined;
  }
  return first(tokens);
}

/** Why the tool itself is not safe to call (annotations, then the name), or undefined. */
function unsafeReason(tool: Obj): string | undefined {
  const a = annotations(tool);
  if (a.readOnlyHint !== true) return 'the tool is not read-only (readOnlyHint is not true)';
  if (a.destructiveHint === true) return 'destructiveHint is true';
  const verb = writeVerbOf(toolName(tool));
  return verb ? `the name contains the write verb ${JSON.stringify(verb)}` : undefined;
}

export function isSafeToCall(tool: Obj): boolean {
  return unsafeReason(tool) === undefined;
}

/** A Streamable HTTP client drops a tool whose x-mcp-header annotations break the rules (TOOL-021), so a 2026-07-28
 *  client cannot call it (A03-01). */
export function droppedByModernClient(tool: Obj): boolean {
  return TOOL_021.check({ tools: [tool] } as unknown as Snapshot).length > 0;
}

/** Sample values for string formats, so a format-validating server accepts the synthesized argument. */
const FORMAT_SAMPLES: Record<string, string> = {
  uri: 'https://example.com/', 'uri-reference': 'https://example.com/', iri: 'https://example.com/', 'iri-reference': 'https://example.com/', url: 'https://example.com/',
  email: 'user@example.com', 'idn-email': 'user@example.com',
  'date-time': '2026-01-01T00:00:00Z', date: '2026-01-01', time: '00:00:00Z', duration: 'P1D',
  uuid: '00000000-0000-4000-8000-000000000000', hostname: 'example.com', 'idn-hostname': 'example.com',
  ipv4: '192.0.2.1', ipv6: '2001:db8::1',
};
/** Nesting cut-off for $ref chains and nested objects or arrays. */
const MAX_DEPTH = 8;

/** A local JSON pointer ("#/$defs/x") resolved against the input schema. */
function resolveRef(ref: string, root: unknown): unknown {
  if (!ref.startsWith('#')) return undefined;
  let node: unknown = root;
  for (const part of ref.slice(1).split('/').filter(Boolean)) {
    const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObj(node) || !Object.prototype.hasOwnProperty.call(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

function numberPlaceholder(schema: Obj, integer: boolean): number {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const step = integer ? 1 : 0.5;
  const min = num(schema.minimum) ?? (num(schema.exclusiveMinimum) !== undefined ? num(schema.exclusiveMinimum)! + step : undefined);
  const max = num(schema.maximum) ?? (num(schema.exclusiveMaximum) !== undefined ? num(schema.exclusiveMaximum)! - step : undefined);
  let v = min ?? (max !== undefined && max < 1 ? max : 1);
  if (integer) v = Math.ceil(v);
  const multipleOf = num(schema.multipleOf);
  if (multipleOf && multipleOf > 0) v = Math.ceil(v / multipleOf) * multipleOf;
  return v;
}

function stringPlaceholder(schema: Obj): string {
  const format = typeof schema.format === 'string' ? FORMAT_SAMPLES[schema.format] : undefined;
  let v = format ?? 'mcp-review-check';
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
  const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : Infinity;
  if (!format && v.length < minLength) v = v.padEnd(Math.min(minLength, 10000), 'x');
  if (!format && v.length > maxLength) v = v.slice(0, Math.max(0, maxLength));
  return v;
}

/**
 * A value the property schema accepts: default, examples[0], enum[0], const, then a placeholder that follows the type
 * and the common constraints (string format and length, number bounds and multipleOf, array minItems, the required
 * properties of an object), the first anyOf/oneOf/allOf branch and local $ref. A `pattern` is not synthesized.
 */
export function placeholder(schema: unknown, root: unknown = schema, depth = 0): unknown {
  if (!isObj(schema) || depth > MAX_DEPTH) return 'mcp-review-check';
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  const types = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter((t): t is string => typeof t === 'string');
  const type = types.find((t) => t !== 'null') ?? types[0];
  if (type === undefined) {
    if (typeof schema.$ref === 'string') {
      const target = resolveRef(schema.$ref, root);
      if (target !== undefined) return placeholder(target, root, depth + 1);
    }
    for (const k of ['anyOf', 'oneOf', 'allOf']) {
      const branches = schema[k];
      if (!Array.isArray(branches)) continue;
      const branch = branches.find((b) => !(isObj(b) && b.type === 'null')) ?? branches[0];
      if (branch !== undefined) return placeholder(branch, root, depth + 1);
    }
    if (isObj(schema.properties)) return objectPlaceholder(schema, root, depth);
  }
  switch (type) {
    case 'integer': return numberPlaceholder(schema, true);
    case 'number': return numberPlaceholder(schema, false);
    case 'boolean': return false;
    case 'null': return null;
    case 'array': {
      const n = typeof schema.minItems === 'number' ? Math.min(schema.minItems, 100) : 0;
      return Array.from({ length: n }, () => placeholder(schema.items, root, depth + 1));
    }
    case 'object': return objectPlaceholder(schema, root, depth);
    default: return stringPlaceholder(schema);
  }
}

function requiredOf(schema: unknown): string[] {
  return isObj(schema) && Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : [];
}

function objectPlaceholder(schema: Obj, root: unknown, depth: number): Record<string, unknown> {
  const props = properties(schema);
  const out: Record<string, unknown> = {};
  for (const k of requiredOf(schema)) out[k] = placeholder(Object.prototype.hasOwnProperty.call(props, k) ? props[k] : undefined, root, depth + 1);
  return out;
}

export function synthesizeArgs(inputSchema: unknown): Record<string, unknown> {
  return isObj(inputSchema) ? objectPlaceholder(inputSchema, inputSchema, 0) : {};
}

/** Candidate wrong-type values, each with the JSON Schema types that would accept it. */
const WRONG_TYPE_CANDIDATES: Array<[unknown, string[]]> = [
  [12345, ['number', 'integer']],
  ['mcp-review-check-wrong-type', ['string']],
  [true, ['boolean']],
  [['mcp-review-check-wrong-type'], ['array']],
  [{ 'mcp-review-check': 'wrong-type' }, ['object']],
];

/**
 * A value whose JSON type the property schema does not allow, or undefined when no such value is certain: the schema
 * is missing, has no `type` (any value, or types only inside anyOf/oneOf/$ref), or allows every candidate type.
 * A sibling `type` constrains the value even next to anyOf/oneOf/$ref, so a value outside it is still invalid.
 */
export function wrongTypeValue(schema: unknown): unknown {
  if (!isObj(schema)) return undefined;
  const types = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter((t): t is string => typeof t === 'string');
  if (!types.length) return undefined;
  return WRONG_TYPE_CANDIDATES.find(([, accepts]) => !accepts.some((t) => types.includes(t)))?.[0];
}

export interface ActiveContext {
  snap: Snapshot;
  toolArgs?: Record<string, unknown>;
  timeoutMs: number;
  now: () => number;
  client?: Client;
  modern?: ModernClient;
  /** Opens a fresh legacy client with the given clientInfo.name and lists tool names. */
  listWithClientName?: (name: string) => Promise<string[] | undefined>;
  /** Filled as the run goes (each call and each clientInfo variant from the second on, when it finishes) and returned: a
   *  --max-duration stop keeps the calls already made. */
  into?: NonNullable<Snapshot['active']>;
}

async function call(ctx: ActiveContext, def: Obj, kind: ActiveCall['kind'], args: unknown): Promise<ActiveCall> {
  const tool = toolName(def);
  const timeout = Math.min(ctx.timeoutMs, MAX_CALL_MS);
  const params = { name: tool, arguments: args };
  if (ctx.client) {
    const obs = await rpc(ctx.client, `active ${tool}`, 'tools/call', params, timeout, ctx.now);
    // rpc() reports an SDK timeout as -32001 plus transportError: that is our timeout, not a server error.
    if (obs.transportError) return { tool, kind, args, transportError: obs.transportError, durationMs: obs.durationMs };
    return { tool, kind, args, result: obs.result, jsonRpcError: obs.error, durationMs: obs.durationMs };
  }
  const started = ctx.now();
  // A 2026-07-28 client mirrors the x-mcp-header arguments into Mcp-Param-{Name} headers (A03-01).
  const r = await ctx.modern!.request('tools/call', params, { label: `active ${tool}`, timeoutMs: timeout, extraHeaders: mcpParamHeaders(def.inputSchema, args) });
  const durationMs = ctx.now() - started;
  if (!r.result && !r.error && r.exchange.error) return { tool, kind, args, transportError: `${r.exchange.error.name}: ${r.exchange.error.message}`, httpStatus: r.exchange.status, durationMs };
  if (!r.result && !r.error) return { tool, kind, args, transportError: `no JSON-RPC response (HTTP ${r.exchange.status ?? '?'})`, httpStatus: r.exchange.status, durationMs };
  return { tool, kind, args, result: r.result, jsonRpcError: r.error, httpStatus: r.exchange.status, durationMs };
}

/**
 * The tools --active may call, one entry per name. tools/call addresses a tool by name only, so a name listed more than
 * once is called only when every entry with it is safe: the server, not the linter, picks the implementation.
 */
export function callableTools(tools: readonly Obj[], modern = false): Obj[] {
  const byName = new Map<string, Obj[]>();
  for (const t of tools) {
    const entries = byName.get(toolName(t));
    if (entries) entries.push(t);
    else byName.set(toolName(t), [t]);
  }
  const ok = (t: Obj) => isSafeToCall(t) && !(modern && droppedByModernClient(t));
  return [...byName.values()].filter((entries) => entries.every(ok)).map((entries) => entries[0]);
}

const SKIPPED = ', so --active does not call it';

/**
 * Why --active made no call to this tool (A03-04): its annotations or name, invalid x-mcp-header annotations on a
 * 2026-07-28-only server, another unsafe entry with the same name, the cap on tools, or a --max-duration stop before
 * the call. undefined when none applies (the tool was called).
 */
export function activeSkipReason(tool: Obj, all: readonly Obj[], limits?: Snapshot['limits'], opts: { modern?: boolean } = {}): string | undefined {
  const own = unsafeReason(tool);
  if (own) return own + SKIPPED;
  const modern = !!opts.modern;
  if (modern && droppedByModernClient(tool)) return `its x-mcp-header annotations are invalid (TOOL-021), so a Streamable HTTP client drops it and --active does not call it`;
  const name = toolName(tool);
  if (all.some((t) => toolName(t) === name && (!isSafeToCall(t) || (modern && droppedByModernClient(t))))) {
    return `the name is listed more than once and not every entry is read-only${SKIPPED}`;
  }
  if (callableTools(all, modern).findIndex((t) => toolName(t) === name) >= MAX_TOOLS) return `the tool was past the cap of ${MAX_TOOLS} tools on --active calls`;
  const stopped = limits?.stopped;
  if (stopped && (stopped.unfinished ?? [stopped.phase]).includes('active tool calls')) return 'the run stopped before this call';
  return undefined;
}

export async function runActive(ctx: ActiveContext): Promise<NonNullable<Snapshot['active']>> {
  const result: NonNullable<Snapshot['active']> = ctx.into ?? { calls: [] };
  const calls: ActiveCall[] = result.calls;
  const tools = callableTools(ctx.snap.tools, !ctx.client && !!ctx.modern).slice(0, MAX_TOOLS);
  for (const t of tools) {
    const name = toolName(t);
    // Own keys only: a tool named "constructor" or "__proto__" must not pick up Object.prototype members.
    const provided = ctx.toolArgs && Object.prototype.hasOwnProperty.call(ctx.toolArgs, name) ? ctx.toolArgs[name] : undefined;
    const args = provided !== undefined ? provided : synthesizeArgs(t.inputSchema);
    calls.push(await call(ctx, t, provided !== undefined ? 'valid' : 'synthetic', args));
    const required = requiredOf(t.inputSchema);
    if (required.length) {
      calls.push(await call(ctx, t, 'invalid-missing', {}));
      const first = required[0];
      const wrong = wrongTypeValue(properties(t.inputSchema)[first]);
      // Without a value the schema certainly rejects, a success would not show that invalid input is accepted (RT-002).
      if (wrong !== undefined) calls.push(await call(ctx, t, 'invalid-type', { ...(isObj(args) ? args : {}), [first]: wrong }));
    }
  }
  if (ctx.listWithClientName) {
    const variants: Record<string, string[]> = {};
    for (const n of ['mcp-review-check', 'claude-ai', 'Anthropic']) {
      const names = await ctx.listWithClientName(n);
      if (names) variants[n] = names;
      // Into the result as each one finishes, from two on (I-A03-3): a stop during the third keeps two. A new object
      // each time, so a stopped snapshot's shallow copy is not changed by the abandoned run.
      if (Object.keys(variants).length > 1) result.clientInfoVariants = { ...variants };
    }
  }
  return result;
}
