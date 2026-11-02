// --active: read-only tool calls, argument synthesis, clientInfo variants (§2.9).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ActiveCall, Snapshot } from '../snapshot.js';
import type { ModernClient } from '../protocol/modern.js';
import { rpc } from '../protocol/legacy.js';
import { WRITE_VERBS } from '../rules/lexicon.js';
import { CLAUDE_TOOL_TIMEOUT_MS } from '../rules/runtime.js';
import { annotations, isObj, properties, toolName, type Obj } from '../rules/util/access.js';
import { tokenize } from '../rules/util/text.js';

const MAX_TOOLS = 50;
// One second past Claude's limit, so a call that would time out in Claude is seen as exceeding it.
const MAX_CALL_MS = CLAUDE_TOOL_TIMEOUT_MS + 1000;

export function isSafeToCall(tool: Obj): boolean {
  const a = annotations(tool);
  return a.readOnlyHint === true && a.destructiveHint !== true && !tokenize(toolName(tool)).some((t) => WRITE_VERBS.has(t));
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
  /** Filled as the run goes (each call when it finishes, the clientInfo variants at the end) and returned: a
   *  --max-duration stop keeps the calls already made. */
  into?: NonNullable<Snapshot['active']>;
}

async function call(ctx: ActiveContext, tool: string, kind: ActiveCall['kind'], args: unknown): Promise<ActiveCall> {
  const timeout = Math.min(ctx.timeoutMs, MAX_CALL_MS);
  const params = { name: tool, arguments: args };
  if (ctx.client) {
    const obs = await rpc(ctx.client, `active ${tool}`, 'tools/call', params, timeout, ctx.now);
    // rpc() reports an SDK timeout as -32001 plus transportError: that is our timeout, not a server error.
    if (obs.transportError) return { tool, kind, args, transportError: obs.transportError, durationMs: obs.durationMs };
    return { tool, kind, args, result: obs.result, jsonRpcError: obs.error, durationMs: obs.durationMs };
  }
  const started = ctx.now();
  const r = await ctx.modern!.request('tools/call', params, { label: `active ${tool}`, timeoutMs: timeout });
  const durationMs = ctx.now() - started;
  if (!r.result && !r.error && r.exchange.error) return { tool, kind, args, transportError: `${r.exchange.error.name}: ${r.exchange.error.message}`, httpStatus: r.exchange.status, durationMs };
  if (!r.result && !r.error) return { tool, kind, args, transportError: `no JSON-RPC response (HTTP ${r.exchange.status ?? '?'})`, httpStatus: r.exchange.status, durationMs };
  return { tool, kind, args, result: r.result, jsonRpcError: r.error, httpStatus: r.exchange.status, durationMs };
}

/**
 * The tools --active may call, one entry per name. tools/call addresses a tool by name only, so a name listed more than
 * once is called only when every entry with it is safe: the server, not the linter, picks the implementation.
 */
export function callableTools(tools: readonly Obj[]): Obj[] {
  const byName = new Map<string, Obj[]>();
  for (const t of tools) {
    const entries = byName.get(toolName(t));
    if (entries) entries.push(t);
    else byName.set(toolName(t), [t]);
  }
  return [...byName.values()].filter((entries) => entries.every(isSafeToCall)).map((entries) => entries[0]);
}

export async function runActive(ctx: ActiveContext): Promise<NonNullable<Snapshot['active']>> {
  const result: NonNullable<Snapshot['active']> = ctx.into ?? { calls: [] };
  const calls: ActiveCall[] = result.calls;
  const tools = callableTools(ctx.snap.tools).slice(0, MAX_TOOLS);
  for (const t of tools) {
    const name = toolName(t);
    // Own keys only: a tool named "constructor" or "__proto__" must not pick up Object.prototype members.
    const provided = ctx.toolArgs && Object.prototype.hasOwnProperty.call(ctx.toolArgs, name) ? ctx.toolArgs[name] : undefined;
    const args = provided !== undefined ? provided : synthesizeArgs(t.inputSchema);
    calls.push(await call(ctx, name, provided !== undefined ? 'valid' : 'synthetic', args));
    const required = requiredOf(t.inputSchema);
    if (required.length) {
      calls.push(await call(ctx, name, 'invalid-missing', {}));
      const first = required[0];
      const wrong = wrongTypeValue(properties(t.inputSchema)[first]);
      // Without a value the schema certainly rejects, a success would not show that invalid input is accepted (RT-002).
      if (wrong !== undefined) calls.push(await call(ctx, name, 'invalid-type', { ...(isObj(args) ? args : {}), [first]: wrong }));
    }
  }
  if (ctx.listWithClientName) {
    const variants: Record<string, string[]> = {};
    for (const n of ['mcp-review-check', 'claude-ai', 'Anthropic']) {
      const names = await ctx.listWithClientName(n);
      if (names) variants[n] = names;
    }
    if (Object.keys(variants).length > 1) result.clientInfoVariants = variants;
  }
  return result;
}
