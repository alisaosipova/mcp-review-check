// RT: runtime checks, opt-in with --active (§2.9).
import type { ActiveCall, Snapshot } from '../snapshot.js';
import { INJ_005_PATTERNS, INJ_006_PATTERNS, INJ_007_PATTERNS, INJ_009_PATTERNS, matchPattern, ownToolFilter } from './injection.js';
import { validateAgainst } from './schema.js';
import { defineRule, type RawFinding } from './types.js';
import { isObj, isStr, metaOf, toolName, uiUriOf, type Obj } from './util/access.js';
import { isGenericError, nfkc, snippet } from './util/text.js';
import { parseWwwAuthenticate } from './util/wwwAuth.js';

const CLAUDE_REVIEW = 'https://claude.com/docs/connectors/building/review-criteria';
/** Claude's documented per-call tool timeout (RT-005); --active cuts calls off one second later. */
export const CLAUDE_TOOL_TIMEOUT_MS = 240000;
const CLAUDE_BUILD = 'https://claude.com/docs/connectors/building';

/** A 2026-07-28 interim result (resultType "input_required", MRTR): neither a success nor an error yet. */
export const isInputRequired = (c: ActiveCall) => isObj(c.result) && c.result.resultType === 'input_required';
/** Calls that got a final answer; timed-out or failed calls are reported by RT-005 only, interim results by none. */
const calls = (snap: Snapshot) => (snap.active?.calls ?? []).filter((c) => !c.transportError && !isInputRequired(c));
const allCalls = (snap: Snapshot) => snap.active?.calls ?? [];
const isInvalid = (c: ActiveCall) => c.kind === 'invalid-missing' || c.kind === 'invalid-type';
const resultObj = (c: ActiveCall): Obj | undefined => (isObj(c.result) ? c.result : undefined);
const isSuccess = (c: ActiveCall) => !!resultObj(c) && resultObj(c)!.isError !== true;

function textOf(result: Obj | undefined): string {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content.filter(isObj).map((c) => (c.type === 'text' && isStr(c.text) ? c.text : '')).join('\n');
}

function errorText(c: ActiveCall): string | undefined {
  const r = resultObj(c);
  if (r?.isError === true) return textOf(r);
  if (isObj(c.jsonRpcError)) return [c.jsonRpcError.message, c.jsonRpcError.data !== undefined ? JSON.stringify(c.jsonRpcError.data) : ''].filter(Boolean).join(' ');
  return undefined;
}

const toolByName = (snap: Snapshot, name: string) => snap.tools.find((t) => toolName(t) === name);

export const RT_001 = defineRule(
  {
    id: 'RT-001', title: 'Error messages are specific', severity: { claude: 'error' }, needs: ['active'],
    rationale: 'Reviewers check that invalid input produces an actionable error.',
    fix: 'Return isError results that name the invalid field and the expected value.',
    sources: [CLAUDE_REVIEW],
  },
  (snap) => calls(snap).filter(isInvalid).flatMap((c): RawFinding[] => {
    const t = errorText(c);
    if (t === undefined) return [];
    if (/\n\s+at .+\(.+:\d+:\d+\)/.test(t) || /Traceback \(most recent call last\)/.test(t)) return [{ tool: c.tool, severity: 'warning', message: `error for ${c.kind} input leaks a stack trace` }];
    if (isGenericError(t)) return [{ tool: c.tool, message: `generic error for ${c.kind} input: "${snippet(t)}"` }];
    return [];
  }),
);

export const RT_002 = defineRule(
  {
    id: 'RT-002', title: 'Invalid input silently accepted', severity: { claude: 'warning', spec: 'warning' }, needs: ['active'],
    rationale: 'Tools should validate arguments against their schema.',
    fix: 'Validate inputs and return an isError result for wrong types.',
    sources: [CLAUDE_REVIEW],
  },
  (snap) => calls(snap).filter((c) => c.kind === 'invalid-type' && isSuccess(c)).map((c) => ({ tool: c.tool, message: 'wrong-type argument returned a success result' })),
);

export const RT_003 = defineRule(
  {
    id: 'RT-003', title: 'Input-validation errors reported with isError', severity: { spec: 'warning' }, needs: ['active'],
    rationale: 'Tool errors belong in the result so the model can self-correct.',
    fix: 'Return { isError: true, content: [...] } for invalid arguments.',
    sources: ['https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts'],
  },
  (snap) => calls(snap).filter((c) => isInvalid(c) && c.jsonRpcError !== undefined).map((c) => ({ tool: c.tool, message: `${c.kind} input returned a JSON-RPC error instead of isError` })),
);

/**
 * Result size in characters as the model sees it: the text of text items, serialized non-text items, and
 * structuredContent only when no text item already mirrors it (the spec recommends that mirror).
 */
export function resultChars(r: Obj): number {
  const content = Array.isArray(r.content) ? r.content : [];
  let n = 0;
  const texts: string[] = [];
  for (const item of content) {
    if (isObj(item) && item.type === 'text' && isStr(item.text)) { n += item.text.length; texts.push(item.text); }
    else n += JSON.stringify(item ?? null).length;
  }
  if (r.structuredContent === undefined) return n;
  const sc = JSON.stringify(r.structuredContent);
  const mirrored = texts.some((t) => {
    if (t === sc) return true;
    try { return JSON.stringify(JSON.parse(t)) === sc; } catch { return false; }
  });
  return mirrored ? n : n + sc.length;
}

export const RT_004 = defineRule(
  {
    id: 'RT-004', title: 'Result size', severity: { claude: 'error' }, needs: ['active'],
    rationale: 'Large results overflow context; Claude truncates or rejects them.',
    fix: 'Paginate and trim results (aim for well under 25k tokens).',
    sources: [CLAUDE_BUILD],
  },
  (snap) => calls(snap).filter(isSuccess).flatMap((c): RawFinding[] => {
    const len = resultChars(resultObj(c)!);
    const how = 'text characters plus serialized non-text items; mirrored structuredContent counted once';
    if (len > 150000) return [{ tool: c.tool, message: `result is ${len} characters (> 150000; ${how})` }];
    if (len > 100000) return [{ tool: c.tool, severity: 'warning', message: `result is ${len} characters (> 100000, about 25k tokens; ${how})` }];
    if (len > 20000) return [{ tool: c.tool, severity: 'info', message: `result is ${len} characters with default arguments` }];
    return [];
  }),
);

export const RT_005 = defineRule(
  {
    id: 'RT-005', title: 'Tool latency', severity: { claude: 'error', chatgpt: 'warning' }, needs: ['active'],
    rationale: "Claude cuts tool calls off at 240 s (documented). The 60 s and 5 s thresholds are linter-defined responsiveness targets.",
    fix: 'Keep tool calls fast; move long work to background jobs.',
    sources: [CLAUDE_BUILD, 'https://developers.openai.com/plugins/deploy/troubleshooting'],
  },
  (snap) => allCalls(snap).flatMap((c): RawFinding[] => {
    const ms = Math.round(c.durationMs);
    const limit = `Claude's ${CLAUDE_TOOL_TIMEOUT_MS / 1000} s tool call timeout`;
    if (c.transportError) {
      // Calls are cut off at min(--timeout, 241 s): a call still running past 240 s exceeds Claude's limit.
      if (c.durationMs >= CLAUDE_TOOL_TIMEOUT_MS) return [{ tool: c.tool, platforms: ['claude'], message: `${c.kind} call got no answer within ${ms} ms; exceeds ${limit}` }];
      return [{ tool: c.tool, severity: 'warning', message: `${c.kind} call got no answer after ${ms} ms: ${c.transportError} (raise --timeout to measure slower tools)` }];
    }
    const out: RawFinding[] = [];
    if (ms > CLAUDE_TOOL_TIMEOUT_MS) out.push({ tool: c.tool, platforms: ['claude'], message: `call took ${ms} ms; exceeds ${limit}` });
    else if (ms > 60000) out.push({ tool: c.tool, platforms: ['claude'], severity: 'warning', message: `call took ${ms} ms (> 60 s, linter-defined threshold)` });
    if (ms > 5000) out.push({ tool: c.tool, platforms: ['chatgpt'], message: `call took ${ms} ms (> 5 s, linter-defined threshold)` });
    return out;
  }),
);

export const RT_006 = defineRule(
  {
    id: 'RT-006', title: 'structuredContent conforms to outputSchema', severity: { spec: 'error', chatgpt: 'error' }, needs: ['active'],
    rationale: 'Clients validate structuredContent against outputSchema.',
    fix: 'Return structuredContent matching outputSchema, and declare outputSchema when returning structuredContent.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/tools#output-schema', 'https://developers.openai.com/plugins/reference'],
  },
  (snap) => calls(snap).filter((c) => (c.kind === 'valid' || c.kind === 'synthetic') && isSuccess(c)).flatMap((c): RawFinding[] => {
    const tool = toolByName(snap, c.tool);
    const r = resultObj(c)!;
    if (tool?.outputSchema !== undefined) {
      if (r.structuredContent === undefined) return [{ tool: c.tool, message: 'outputSchema is declared but structuredContent is missing' }];
      const err = validateAgainst(tool.outputSchema, r.structuredContent);
      return err ? [{ tool: c.tool, message: `structuredContent does not match outputSchema: ${err.slice(0, 200)}` }] : [];
    }
    // OpenAI phrases this as guidance (no rejection or portal error), and the MCP spec makes outputSchema optional.
    return r.structuredContent !== undefined ? [{ tool: c.tool, platforms: ['chatgpt'], severity: 'warning', message: 'structuredContent returned without an outputSchema' }] : [];
  }),
);

export const RT_007 = defineRule(
  {
    id: 'RT-007', title: 'structuredContent mirrored as text', severity: { spec: 'warning' }, needs: ['active'],
    rationale: 'Clients without structured output support read the text content.',
    fix: 'Also return the serialized JSON as a text content item.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content'],
  },
  (snap) => calls(snap).filter(isSuccess).flatMap((c): RawFinding[] => {
    const r = resultObj(c)!;
    const hasText = Array.isArray(r.content) && r.content.some((x) => isObj(x) && x.type === 'text');
    return r.structuredContent !== undefined && !hasText ? [{ tool: c.tool, message: 'structuredContent without a text content item' }] : [];
  }),
);

export const RT_008 = defineRule(
  {
    id: 'RT-008', title: 'UI tools return meaningful content', severity: { spec: 'warning' }, needs: ['active'],
    rationale: 'Hosts that cannot render the widget show the content to the model and user.',
    fix: 'Return a useful text summary alongside the widget data.',
    sources: ['https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx'],
  },
  (snap) => calls(snap).filter(isSuccess).flatMap((c): RawFinding[] => {
    const tool = toolByName(snap, c.tool);
    if (!tool || uiUriOf(tool) === undefined) return [];
    const r = resultObj(c)!;
    const content = Array.isArray(r.content) ? r.content : [];
    const onlyShortText = content.length > 0 && content.every((x) => isObj(x) && x.type === 'text') && textOf(r).trim().length < 20;
    return content.length === 0 || onlyShortText ? [{ tool: c.tool, message: 'UI tool returned empty or near-empty content' }] : [];
  }),
);

const AUTH_TEXT = /\b(sign ?in|log ?in|authenticat|unauthori[sz]ed|not authenticated|missing (access )?token|connect your account|oauth)\b/i;

export const RT_009 = defineRule(
  {
    id: 'RT-009', title: 'Auth failures surfaced at the transport level', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['active'],
    rationale: 'Hosts show a Connect card only for HTTP 401 (or a ChatGPT www_authenticate _meta).',
    fix: 'Return HTTP 401 with a Bearer challenge for unauthenticated tool calls.',
    sources: ['https://claude.com/docs/connectors/building/lazy-authentication', 'https://developers.openai.com/plugins/build/auth'],
  },
  (snap) => {
    if (snap.options.authenticated) return [];
    return calls(snap).flatMap((c): RawFinding[] => {
      const r = resultObj(c);
      if (r?.isError !== true || !AUTH_TEXT.test(textOf(r))) return [];
      const out: RawFinding[] = [{ tool: c.tool, platforms: ['claude'], message: 'auth failure returned as isError text; Claude shows text instead of the Connect card; return 401' }];
      const wa = metaOf(r)['mcp/www_authenticate'];
      const challenges = (Array.isArray(wa) ? wa : [wa]).filter(isStr).flatMap((h) => parseWwwAuthenticate(h));
      const ok = challenges.length > 0 && challenges.every((ch) => ch.params.error && ch.params.error_description);
      if (!ok) out.push({ tool: c.tool, platforms: ['chatgpt'], message: 'auth failure returned as isError text without _meta["mcp/www_authenticate"] (error=, error_description=)' });
      return out;
    });
  },
);

const LEAK_KEY = /^(session_?id|trace_?id|request_?id|correlation_?id|span_?id|_?debug|stack(_?trace)?|logs?|internal_?(id|account_?id))$/i;
const TOKEN_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+|\bsk-[A-Za-z0-9_-]{16,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b/;

export function redactToken(v: string): string {
  return v.slice(0, 4) + '…';
}

function walkJson(v: unknown, visit: (key: string | undefined, value: unknown) => void, key?: string, depth = 0): void {
  if (depth > 32) return;
  visit(key, v);
  if (Array.isArray(v)) v.forEach((x) => walkJson(x, visit, undefined, depth + 1));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkJson(x, visit, k, depth + 1);
}

export const RT_010 = defineRule(
  {
    id: 'RT-010', title: 'Results leak internals or secrets', severity: { chatgpt: 'warning' }, needs: ['active'],
    rationale: 'Results must not expose debugging data or credentials.',
    fix: 'Strip internal ids, debug fields and tokens from results.',
    sources: ['https://developers.openai.com/plugins/plugin-guidelines'],
  },
  (snap) => calls(snap).filter(isSuccess).flatMap((c): RawFinding[] => {
    const r = resultObj(c)!;
    const roots: unknown[] = [r.structuredContent];
    for (const part of textOf(r).split('\n')) { try { roots.push(JSON.parse(part)); } catch { /* not JSON */ } }
    try { roots.push(JSON.parse(textOf(r))); } catch { /* not JSON */ }
    const keys = new Set<string>();
    const tokens = new Set<string>();
    for (const root of roots) walkJson(root, (k, v) => {
      if (k && LEAK_KEY.test(k)) keys.add(k);
      if (isStr(v)) { const m = TOKEN_RE.exec(v); if (m) tokens.add(redactToken(m[0])); }
    });
    const out: RawFinding[] = [];
    if (keys.size) out.push({ tool: c.tool, message: `result exposes internal keys: ${[...keys].join(', ')}` });
    if (tokens.size) out.push({ tool: c.tool, severity: 'error', message: `result contains token-like values: ${[...tokens].join(', ')}` });
    return out;
  }),
);

export const RT_011 = defineRule(
  {
    id: 'RT-011', title: 'Injection patterns in tool output', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['active'],
    rationale: 'Tool output reaches the model; instructions in it are prompt injection.',
    fix: 'Return data, not instructions to the model.',
    sources: ['https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy'],
  },
  (snap) => {
    const groups = [INJ_005_PATTERNS, INJ_006_PATTERNS, INJ_007_PATTERNS, INJ_009_PATTERNS];
    const own = ownToolFilter(snap);
    return calls(snap).filter(isSuccess).flatMap((c): RawFinding[] => {
      const text = nfkc(textOf(resultObj(c)));
      for (const patterns of groups) {
        // As in scanCorpus, the first matching pattern of a group decides; an informational match is not injection.
        for (const p of patterns) {
          const m = matchPattern(p, text);
          if (!m || !own({ text, where: 'tool.description' }, m, p)) continue;
          if (p.severity === 'info') break;
          return [{ tool: c.tool, message: `output contains "${snippet(text, m.index, m[0].length)}"` }];
        }
      }
      return [];
    });
  },
);

export const RT_012 = defineRule(
  {
    id: 'RT-012', title: 'Behavior gated on clientInfo', severity: { claude: 'info' }, needs: ['active'],
    rationale: 'Reviewers test with Claude clients; behavior should not depend on clientInfo.',
    fix: 'Serve the same tools regardless of clientInfo.',
    sources: ['https://claude.com/docs/connectors/building/testing'],
  },
  (snap) => {
    const v = snap.active?.clientInfoVariants;
    if (!v) return [];
    const keys = Object.entries(v).map(([k, names]) => [k, [...new Set(names)].sort().join(',')] as const);
    const distinct = new Set(keys.map(([, s]) => s));
    return distinct.size > 1 ? [{ message: `tools/list differs by clientInfo.name (${keys.map(([k, s]) => `${k}: ${s.split(',').filter(Boolean).length} tools`).join('; ')})` }] : [];
  },
);

export const runtimeRules = [RT_001, RT_002, RT_003, RT_004, RT_005, RT_006, RT_007, RT_008, RT_009, RT_010, RT_011, RT_012];
