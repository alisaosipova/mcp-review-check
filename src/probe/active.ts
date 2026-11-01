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

export function placeholder(schema: unknown): unknown {
  if (!isObj(schema)) return 'mcp-review-check';
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'integer':
    case 'number': return 1;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return {};
    default: return 'mcp-review-check';
  }
}

export function synthesizeArgs(inputSchema: unknown): Record<string, unknown> {
  const props = properties(inputSchema);
  const required = isObj(inputSchema) && Array.isArray(inputSchema.required) ? inputSchema.required.filter((r): r is string => typeof r === 'string') : [];
  const args: Record<string, unknown> = {};
  for (const k of required) args[k] = placeholder(props[k]);
  return args;
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
  const calls: ActiveCall[] = [];
  const tools = callableTools(ctx.snap.tools).slice(0, MAX_TOOLS);
  for (const t of tools) {
    const name = toolName(t);
    // Own keys only: a tool named "constructor" or "__proto__" must not pick up Object.prototype members.
    const provided = ctx.toolArgs && Object.prototype.hasOwnProperty.call(ctx.toolArgs, name) ? ctx.toolArgs[name] : undefined;
    const args = provided !== undefined ? provided : synthesizeArgs(t.inputSchema);
    calls.push(await call(ctx, name, provided !== undefined ? 'valid' : 'synthetic', args));
    const required = isObj(t.inputSchema) && Array.isArray(t.inputSchema.required) ? t.inputSchema.required.filter((r): r is string => typeof r === 'string') : [];
    if (required.length) {
      calls.push(await call(ctx, name, 'invalid-missing', {}));
      const first = required[0];
      const wrong = wrongTypeValue(properties(t.inputSchema)[first]);
      // Without a value the schema certainly rejects, a success would not show that invalid input is accepted (RT-002).
      if (wrong !== undefined) calls.push(await call(ctx, name, 'invalid-type', { ...(isObj(args) ? args : {}), [first]: wrong }));
    }
  }
  const result: NonNullable<Snapshot['active']> = { calls };
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
