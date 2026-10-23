// TOOL: naming, descriptions, tool shape and OpenAI tool _meta (§2.3).
import type { Snapshot } from '../snapshot.js';
import { ALL_VERBS, READ_VERBS, WRITE_VERBS } from './lexicon.js';
import { defineRule, type RawFinding } from './types.js';
import { annotations, isNonEmptyStr, isObj, isStr, isStrArray, listPreview, metaOf, properties, toolName, uiUriOf, type Obj } from './util/access.js';
import { deref, walkSchema } from './util/schemaWalk.js';
import { firstVerb, tokenize, toolKind, words } from './util/text.js';
import { TEXT_CAP } from '../limits.js';

const MCP_TOOLS_2025 = 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools';
const CLAUDE_POLICY = 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy';
const OAI_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';
const CLAUDE_REVIEW = 'https://claude.com/docs/connectors/building/review-criteria';
const OAI_REF = 'https://developers.openai.com/plugins/reference';

/** Run `fn` per tool and tag findings with the tool name. */
export function perTool(snap: Snapshot, fn: (t: Obj, name: string) => RawFinding[] | RawFinding | undefined): RawFinding[] {
  const out: RawFinding[] = [];
  for (const t of snap.tools) {
    const name = toolName(t);
    const r = fn(t, name);
    if (!r) continue;
    for (const f of Array.isArray(r) ? r : [r]) out.push({ tool: name, ...f });
  }
  return out;
}

export const TOOL_001 = defineRule(
  {
    id: 'TOOL-001', title: 'Tool name characters and length', severity: { spec: 'warning' }, needs: ['tools'],
    rationale: 'Tool names should use only letters, digits, _, - and . (1-128 characters).',
    fix: 'Rename using only letters, digits, `_`, `-` and `.`.',
    sources: [MCP_TOOLS_2025],
  },
  (snap) => perTool(snap, (t, name) => {
    if (typeof t.name !== 'string') return { severity: 'error', message: `tool name is not a string (${JSON.stringify(t.name)})` };
    if (/^[A-Za-z0-9_.-]{1,128}$/.test(name)) return undefined;
    const bad = [...new Set([...name].filter((c) => !/[A-Za-z0-9_.-]/.test(c)))].map((c) => JSON.stringify(c));
    return { message: name.length === 0 ? 'tool name is empty' : name.length > 128 ? `name is ${name.length} characters (> 128)` : `name contains ${bad.join(' ')}` };
  }),
);

export const TOOL_002 = defineRule(
  {
    id: 'TOOL-002', title: 'Tool name at most 64 characters', severity: { claude: 'error' }, needs: ['tools'],
    rationale: 'Claude rejects tool names longer than 64 characters.',
    fix: 'Shorten the tool name to 64 characters or fewer.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => perTool(snap, (_t, name) => ([...name].length > 64 ? { message: `name is ${[...name].length} characters (> 64)` } : undefined)),
);

export const TOOL_003 = defineRule(
  {
    id: 'TOOL-003', title: 'Tool names unique', severity: { chatgpt: 'error', spec: 'warning' }, needs: ['tools'],
    rationale: 'Duplicate names make tool routing ambiguous.',
    fix: 'Give every tool a unique name.',
    sources: [OAI_GUIDE, 'https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names'],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const counts = new Map<string, number>();
    for (const n of snap.tools.map(toolName)) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const [n, c] of counts) if (c > 1) out.push({ tool: n, message: `name appears ${c} times` });
    const lower = new Map<string, string[]>();
    for (const n of counts.keys()) lower.set(n.toLowerCase(), [...(lower.get(n.toLowerCase()) ?? []), n]);
    for (const names of lower.values()) if (names.length > 1) out.push({ tool: names[0], severity: 'info', message: `names differ only by case: ${names.join(', ')}` });
    return out;
  },
);

const PROMO = new Set(['best', 'top', 'official', 'ultimate', 'premium', 'recommended', 'preferred', 'number1', 'no1', 'greatest', 'perfect', 'superior', 'leading']);

export const TOOL_004 = defineRule(
  {
    id: 'TOOL-004', title: 'Promotional or comparative tool name', severity: { chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Tool names must not try to win selection through promotion.',
    fix: 'Use a neutral, descriptive name.',
    sources: [OAI_GUIDE],
  },
  (snap) => perTool(snap, (t, name) => {
    const toks = [...tokenize(name), ...(isStr(t.title) ? tokenize(t.title) : [])];
    const joined = toks.slice(1).map((x, i) => toks[i] + x);
    const hit = [...toks, ...joined].find((x) => PROMO.has(x));
    if (hit) return { message: `promotional word "${hit}" in name or title` };
    if (/(use_?me|pick_?me|choose_?me)/i.test(name)) return { message: 'name asks the model to pick it' };
    return undefined;
  }),
);

const EXTRA_VERBS = new Set(['render', 'open', 'calculate', 'convert', 'generate', 'analyze', 'compare', 'translate']);

export const TOOL_005 = defineRule(
  {
    id: 'TOOL-005', title: 'Opaque tool name', severity: { chatgpt: 'info' }, needs: ['tools'],
    rationale: 'Names should say what the tool does.',
    fix: 'Use a verb_noun name such as search_invoices.',
    sources: [OAI_GUIDE],
  },
  (snap) => perTool(snap, (_t, name) => {
    const toks = tokenize(name);
    if (/^(tool|fn|func|op|action|cmd|handler|endpoint)[_-]?\d+$/i.test(name)) return { message: 'name is a numbered placeholder' };
    if (/[0-9a-f]{8,}/i.test(name)) return { message: 'name contains a hex id or UUID' };
    if (toks.length === 1 && toks[0].length < 3) return { message: 'name is a single short token' };
    if (!toks.some((x) => ALL_VERBS.has(x) || EXTRA_VERBS.has(x))) return { message: 'name contains no recognizable verb' };
    return undefined;
  }),
);

export const TOOL_006 = defineRule(
  {
    id: 'TOOL-006', title: 'Tool has a title', severity: { claude: 'error', spec: 'info' }, needs: ['tools'],
    rationale: 'Claude shows the human-readable title in its UI and requires it for review.',
    fix: 'Add `title` (top level, or in `annotations.title`).',
    sources: [CLAUDE_REVIEW],
  },
  (snap) => perTool(snap, (t) => {
    const at = annotations(t).title;
    const title = t.title ?? at;
    if (!isNonEmptyStr(title)) return { platforms: ['claude'], message: 'no title' };
    if (t.title !== undefined && at !== undefined && t.title !== at) return { platforms: ['spec'], message: `title and annotations.title differ ("${String(t.title)}" wins)` };
    return undefined;
  }),
);

export const TOOL_007 = defineRule(
  {
    id: 'TOOL-007', title: 'Tool has a description', severity: { chatgpt: 'error', claude: 'warning', spec: 'info' }, needs: ['tools'],
    rationale: 'Models choose tools from their descriptions.',
    fix: 'Describe what the tool does, when to use it and what it returns.',
    sources: [OAI_GUIDE, CLAUDE_POLICY],
  },
  (snap) => perTool(snap, (t) => (isNonEmptyStr(t.description) ? undefined : { message: 'no description' })),
);

const STOP = new Set(['a', 'an', 'the', 'this', 'tool', 'to', 'for']);
const SIDE_EFFECT = /(creat|updat|delet|send|modif|chang|writ|sav|cancel|remov|post|upload)/i;

export const TOOL_008 = defineRule(
  {
    id: 'TOOL-008', title: 'Description too thin, generic or overloaded', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Thin or generic descriptions lead to wrong tool selection.',
    fix: 'Write 1-3 specific sentences: purpose, when to use, side effects and output.',
    sources: ['https://developers.openai.com/plugins/plan/tools', CLAUDE_POLICY],
  },
  (snap) => perTool(snap, (t, name) => {
    if (!isNonEmptyStr(t.description)) return undefined; // TOOL-007 fired
    const d = t.description.trim();
    const out: RawFinding[] = [];
    const reasons: string[] = [];
    const platforms = new Set<'claude' | 'chatgpt'>();
    const w = words(d);
    if (w.length < 6 && d.length < 40) { reasons.push(`only ${w.length} words`); platforms.add('chatgpt'); }
    if (d.length < 20) { reasons.push(`only ${d.length} characters`); platforms.add('claude'); }
    const nameToks = new Set(tokenize(name));
    const descToks = w.map((x) => x.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean);
    if (d.toLowerCase() === name.toLowerCase()) { reasons.push('equals the name'); platforms.add('claude'); platforms.add('chatgpt'); }
    else if (descToks.length && descToks.flatMap((x) => tokenize(x)).every((x) => nameToks.has(x) || STOP.has(x))) { reasons.push('only restates the name'); platforms.add('claude'); platforms.add('chatgpt'); }
    if (/^(makes? a request|calls? the api|does stuff|utility|helper|tool)\.?$/i.test(d)) { reasons.push('generic wording'); platforms.add('claude'); platforms.add('chatgpt'); }
    if (reasons.length) out.push({ platforms: [...platforms], message: `description is too thin: ${reasons.join(', ')}` });
    if (d.length > 1024) out.push({ platforms: ['claude'], severity: 'info', message: `description is ${d.length >= TEXT_CAP ? `over ${TEXT_CAP}` : d.length} characters; it may be mixing purposes` });
    const kind = toolKind(t);
    if (kind !== 'read' && !SIDE_EFFECT.test(d)) {
      const what = annotations(t).readOnlyHint === false || annotations(t).destructiveHint === true ? 'write tool' : 'tool without readOnlyHint';
      out.push({ platforms: ['chatgpt'], severity: 'info', message: `${what}: description does not mention side effects` });
    }
    return out;
  }),
);

export const TOOL_009 = defineRule(
  {
    id: 'TOOL-009', title: 'Every input parameter has a description', severity: { chatgpt: 'info', claude: 'info' }, needs: ['tools'],
    rationale: 'Linter-defined best practice (no directory requires it): parameter descriptions are the main signal for correct arguments.',
    fix: 'Add a description to every input property.',
    sources: ['https://developers.openai.com/plugins/plan/tools'],
  },
  (snap) => perTool(snap, (t) => {
    const missing: string[] = [];
    walkSchema(t.inputSchema, (v) => {
      if (!v.viaProperty || v.path.endsWith('/$ref')) return;
      const target = deref(t.inputSchema, v.node);
      if (!isNonEmptyStr(v.node.description) && !(isObj(target) && isNonEmptyStr(target.description))) missing.push(v.path);
    });
    const uniq = [...new Set(missing)];
    return uniq.length ? { message: `${uniq.length} parameter(s) without description: ${uniq.slice(0, 10).join(', ')}${uniq.length > 10 ? ', …' : ''}` } : undefined;
  }),
);

// ---- Catch-all and dispatcher tools (TOOL-023..028) ----

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const HTTP_TOOL_NAME = /(api|http|rest|raw)_?(request|call|query)|^request$|^call_api$|^fetch_api$/i;

function enumValues(node: Obj): unknown[] | undefined {
  if (Array.isArray(node.enum)) return node.enum;
  for (const k of ['oneOf', 'anyOf']) {
    const list = node[k];
    if (Array.isArray(list)) {
      const consts = list.filter(isObj).flatMap((s) => (s.const !== undefined ? [s.const] : Array.isArray(s.enum) ? s.enum : []));
      if (consts.length) return consts;
    }
  }
  if (node.const !== undefined) return [node.const];
  return undefined;
}

function isFreeString(node: Obj): boolean {
  return (node.type === 'string' || node.type === undefined) && enumValues(node) === undefined && node.pattern === undefined && node.format === undefined;
}

export const TOOL_023 = defineRule(
  {
    id: 'TOOL-023', title: 'Catch-all HTTP tool mixing safe and unsafe methods', severity: { claude: 'error' }, needs: ['tools'],
    rationale: 'A single tool that both reads and writes cannot be annotated correctly; Claude rejects it.',
    fix: 'Split into a read-only tool plus write tools (create/update/delete).',
    sources: [CLAUDE_REVIEW],
  },
  (snap) => perTool(snap, (t, name) => {
    const nameHit = HTTP_TOOL_NAME.test(name);
    let methodProp: Obj | undefined;
    let methodPath = '';
    walkSchema(t.inputSchema, (v) => {
      if (!methodProp && v.viaProperty && /^(method|http_?method|verb|request_?method)$/i.test(v.name)) { methodProp = v.node; methodPath = v.path; }
    });
    if (methodProp) {
      const vals = (enumValues(methodProp) ?? []).filter(isStr).map((s) => s.toUpperCase());
      if (vals.some((v) => SAFE_METHODS.includes(v)) && vals.some((v) => UNSAFE_METHODS.includes(v))) {
        return { path: methodPath, message: `method parameter allows both safe and unsafe HTTP methods (${vals.join(', ')})` };
      }
      if (isFreeString(methodProp) && nameHit) return { severity: 'warning', path: methodPath, message: 'generic HTTP tool with a free-form method parameter' };
      return undefined;
    }
    return nameHit ? { severity: 'info', message: 'name suggests a generic HTTP passthrough tool' } : undefined;
  }),
);

const NOUN_VERBS = new Set(['list', 'set', 'order', 'post', 'share', 'schedule', 'queue', 'book', 'archive', 'export', 'import', 'view', 'count', 'check', 'preview', 'run', 'start']);
const GROUPS = [new Set(['create', 'add', 'insert']), new Set(['update', 'edit', 'patch', 'set']), new Set(['delete', 'remove', 'destroy'])];

export const TOOL_024 = defineRule(
  {
    id: 'TOOL-024', title: 'Operation enum mixing read and write, or many modes', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Mode switches hide write operations behind a read tool and defeat annotations.',
    fix: 'Split the tool by action type so each tool has accurate hints.',
    sources: [CLAUDE_REVIEW, OAI_GUIDE],
  },
  (snap) => perTool(snap, (t) => {
    const out: RawFinding[] = [];
    walkSchema(t.inputSchema, (v) => {
      // `type` is left out: it usually names a data type (Redis "list", "set"), not an operation.
      if (!v.viaProperty || !/^(action|operation|op|mode|command)$/i.test(v.name)) return;
      const vals = (enumValues(v.node) ?? []).filter(isStr);
      const verbs = vals.map((x) => tokenize(x)[0]).filter((x): x is string => !!x && ALL_VERBS.has(x));
      if (!verbs.length) return; // entity-type enums are fine
      // A `mode` value is often a noun; there, verbs that double as common nouns do not count.
      const clear = v.name === 'mode' ? verbs.filter((x) => !NOUN_VERBS.has(x)) : verbs;
      // Word-list detection, so a warning (§1.2); TOOL-023 keeps the error for explicit HTTP-method enums.
      if (clear.some((x) => READ_VERBS.has(x)) && clear.some((x) => WRITE_VERBS.has(x))) out.push({ path: v.path, message: `"${v.rawName}" enum mixes read and write operations (${vals.join(', ')})` });
      const groups = GROUPS.filter((g) => verbs.some((x) => g.has(x))).length;
      if (groups >= 2) out.push({ path: v.path, platforms: ['claude'], severity: 'info', message: `"${v.rawName}" enum spans ${groups} action types; split by action type` });
      if (verbs.length >= 4) out.push({ path: v.path, platforms: ['chatgpt'], message: `"${v.rawName}" enum has ${verbs.length} verb modes` });
    });
    return out;
  }),
);

const DISCOVERY = /^(list|get|describe|search)_(operations|actions|endpoints|schemas?|apis|commands|tools)$/i;
const EXEC_NAME = /^(execute|exec|run|invoke|call|dispatch|perform|proxy|request|http|api|graphql|sql|query)([_-]?(api|operation|action|endpoint|request|command|tool|method|query))?$/i;
const OP_PROP = /^(operation(_?id)?|action|method|endpoint|path|url|command|tool(_name)?|function)$/i;

function isFreeObject(node: Obj): boolean {
  return node.type === 'object' && (!isObj(node.properties) || Object.keys(node.properties).length === 0 || node.additionalProperties === true);
}

export const TOOL_025 = defineRule(
  {
    id: 'TOOL-025', title: 'Generic executor or operation dispatcher', severity: { chatgpt: 'error' }, needs: ['tools'],
    rationale: 'Dispatcher tools hide what the plugin can do; OpenAI rejects them.',
    fix: 'Expose one tool per operation with a typed schema.',
    sources: [OAI_GUIDE],
  },
  (snap) => {
    const hasDiscovery = snap.tools.some((t) => DISCOVERY.test(toolName(t)));
    return perTool(snap, (t, name) => {
      const props = properties(t.inputSchema);
      const opProp = Object.entries(props).find(([k, v]) => OP_PROP.test(k) && isObj(v) && isFreeString(v));
      const argsObj = Object.values(props).some((v) => isObj(v) && isFreeObject(v));
      if (hasDiscovery && opProp && argsObj) return { message: `dispatcher: takes "${opProp[0]}" plus a free-form arguments object next to a discovery tool` };
      if ((EXEC_NAME.test(name) || /execute_operation|call_api|run_action|invoke_endpoint/i.test(name)) && opProp) {
        return { severity: 'warning', message: `generic executor with free-form "${opProp[0]}" parameter` };
      }
      return undefined;
    });
  },
);

// Raw request and query-language parameters. A natural-language `query` or a filesystem `path` is not one;
// url/path/uri/route count only next to a method or verb parameter (a raw request builder).
const RAW_QUERY = /^(endpoint|query_?string|body|request_?body|payload|graphql|gql|sql|jql|soql|cql|kql|spl|promql|filter_expression)$/i;
const RAW_TARGET = /^(path|url|uri|route)$/i;
const METHOD_PROP = /^(method|http_?method|verb|request_?method)$/i;
// At most 6 capitalized words before "API": an unbounded repeat is quadratic on long capitalized text.
const API_NAMED = /\b[A-Z][\w.&-]{0,40}( [A-Z][\w.&-]{0,40}){0,5}\s+(Web |REST |GraphQL |Admin )?API\b/;

const GENERIC_NAME_TOKENS = new Set(['mcp', 'server', 'api', 'tools', 'tool', 'the', 'remote', 'connector', 'plugin', 'app', 'official', 'docs']);

/** Product names from serverInfo: the full name and title, and their first distinctive token (the brand), lowercased. */
function productNames(snap: Snapshot): string[] {
  const si = snap.serverInfo ?? {};
  const out = new Set<string>();
  for (const v of [si.title, si.name]) {
    if (!isStr(v)) continue;
    out.add(v.toLowerCase());
    const brand = tokenize(v).find((tok) => !GENERIC_NAME_TOKENS.has(tok));
    if (brand) out.add(brand);
  }
  return [...out].filter((x) => x.length >= 3);
}

export const TOOL_026 = defineRule(
  {
    id: 'TOOL-026', title: 'Free-form query tool must name or link the target API', severity: { claude: 'warning' }, needs: ['tools'],
    rationale: 'Reviewers must be able to tell which API a free-form query reaches.',
    fix: 'Name the target API (e.g. "Acme REST API") or link its documentation in the description.',
    sources: [CLAUDE_REVIEW],
  },
  (snap) => perTool(snap, (t, name) => {
    const props = properties(t.inputSchema);
    const hasMethod = Object.keys(props).some((k) => METHOD_PROP.test(k));
    const hit = Object.entries(props).find(([k, v]) => (RAW_QUERY.test(k) || (hasMethod && RAW_TARGET.test(k))) && isObj(v) && (isFreeString(v) || isFreeObject(v)));
    if (!hit) return undefined;
    const d = isStr(t.description) ? t.description : '';
    if (/https?:\/\/\S+/.test(d) || API_NAMED.test(d)) return undefined;
    // The product named in the tool name, title or description also identifies the target.
    const text = [name, t.title, annotations(t).title, d].filter(isStr).join(' ').toLowerCase();
    if (productNames(snap).some((p) => text.includes(p))) return undefined;
    return { path: `/properties/${hit[0]}`, message: `free-form "${hit[0]}" parameter but the description does not name or link the target API` };
  }),
);

const COLLECTION_TOKENS = new Set(['list', 'search', 'query', 'export', 'dump', 'find', 'all']);
const LIMIT_PROP = /^(limit|max_?results|page|page_?size|per_?page|cursor|offset|next_?token|top|first)$/i;

export const TOOL_027 = defineRule(
  {
    id: 'TOOL-027', title: 'Collection tools without pagination or limits', severity: { claude: 'info' }, needs: ['tools'],
    rationale: 'Unbounded results overflow the context window.',
    fix: 'Add limit/cursor parameters and cap result sizes.',
    sources: [CLAUDE_REVIEW],
  },
  (snap) => perTool(snap, (t, name) => {
    if (toolKind(t) === 'write') return undefined; // "creates entities from lists" is not a collection read
    const d = isStr(t.description) ? t.description : '';
    const implied = tokenize(name).some((x) => COLLECTION_TOKENS.has(x)) || /\b(lists?|search(es)?|quer(y|ies)|exports?|dumps?|finds?|all)\b/i.test(d);
    if (!implied) return undefined;
    const names: string[] = [];
    walkSchema(t.inputSchema, (v) => { if (v.viaProperty) names.push(v.name); });
    if (names.some((n) => LIMIT_PROP.test(n))) return undefined;
    if (/\b(all records|entire (database|table)|full dump|dump)\b/i.test(d)) return { severity: 'warning', message: 'returns a full dump without pagination or limits' };
    return { message: 'collection tool without pagination or limit parameters' };
  }),
);

const TRIM_PROP = /^(fields|select|include_[a-z_]+|exclude_[a-z_]+|verbose|detail(_level)?|format|summary|compact|properties)$/i;

export const TOOL_028 = defineRule(
  {
    id: 'TOOL-028', title: 'No option to trim response size', severity: { claude: 'info' }, needs: ['tools'],
    rationale: 'Field selection keeps responses small.',
    fix: 'Offer fields/select/verbose-style parameters on read tools that return large objects.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => {
    const hits = snap.tools.filter((t) => {
      const v = firstVerb(toolName(t));
      if (toolKind(t) !== 'read' || !v || !['list', 'search', 'get', 'find', 'query'].includes(v)) return false;
      const names: string[] = [];
      walkSchema(t.inputSchema, (x) => { if (x.viaProperty) names.push(x.name); });
      return !names.some((n) => TRIM_PROP.test(n));
    }).map(toolName);
    return hits.length ? [{ message: `${hits.length} read tool(s) without a field-selection option: ${listPreview(hits)}` }] : [];
  },
);

// ---- OpenAI tool _meta (TOOL-029..032) ----

export const TOOL_029 = defineRule(
  {
    id: 'TOOL-029', title: 'openai/toolInvocation status strings', severity: { chatgpt: 'error' }, needs: ['tools'],
    rationale: 'ChatGPT shows these strings while the tool runs; the portal validates them.',
    fix: 'Use strings of at most 64 characters for openai/toolInvocation/invoking and /invoked.',
    sources: [OAI_REF],
  },
  (snap) => perTool(snap, (t) => {
    const m = metaOf(t);
    const out: RawFinding[] = [];
    for (const k of ['openai/toolInvocation/invoking', 'openai/toolInvocation/invoked']) {
      const v = m[k];
      if (v !== undefined && !(isStr(v) && v.length <= 64)) out.push({ message: `${k} is not a string of at most 64 characters` });
    }
    if (uiUriOf(t) !== undefined && m['openai/toolInvocation/invoking'] === undefined && m['openai/toolInvocation/invoked'] === undefined) {
      out.push({ severity: 'info', message: 'UI tool has no openai/toolInvocation status strings' });
    }
    return out;
  }),
);

const FILE_PROPS = ['download_url', 'file_id', 'mime_type', 'file_name'];

export const TOOL_030 = defineRule(
  {
    id: 'TOOL-030', title: 'openai/fileParams file-object schema', severity: { chatgpt: 'error' }, needs: ['tools'],
    rationale: 'ChatGPT passes files as a fixed object shape.',
    fix: 'Each file param must be an object with string download_url, file_id, mime_type, file_name; require only download_url and file_id.',
    sources: [OAI_REF],
  },
  (snap) => perTool(snap, (t) => {
    const fp = metaOf(t)['openai/fileParams'];
    if (fp === undefined) return undefined;
    if (!isStrArray(fp)) return { message: 'openai/fileParams is not a string[]' };
    const out: RawFinding[] = [];
    const props = properties(t.inputSchema);
    for (const p of fp) {
      let node = deref(t.inputSchema, props[p]);
      if (!isObj(node)) { out.push({ message: `file param "${p}" is not a top-level property` }); continue; }
      if (node.type === 'array') node = deref(t.inputSchema, node.items);
      if (!isObj(node)) continue;
      const fprops = properties(node);
      const missing = FILE_PROPS.filter((k) => !(isObj(fprops[k]) && (fprops[k] as Obj).type === 'string'));
      if (missing.length) out.push({ path: `/properties/${p}`, message: `file param "${p}" lacks string ${missing.join(', ')}` });
      const req = Array.isArray(node.required) ? node.required : [];
      if (!req.includes('download_url') || !req.includes('file_id')) out.push({ path: `/properties/${p}`, message: `file param "${p}" must require download_url and file_id` });
      const extra = req.filter((r) => r !== 'download_url' && r !== 'file_id');
      if (extra.length) out.push({ path: `/properties/${p}`, message: `file param "${p}" must not require ${extra.join(', ')}` });
    }
    return out;
  }),
);

const PROFILE_FIELDS = new Set(['id', 'name', 'email', 'nickname']);

export const TOOL_031 = defineRule(
  {
    id: 'TOOL-031', title: 'openai/profile marker contract', severity: { chatgpt: 'error' }, needs: ['tools'],
    rationale: 'ChatGPT calls the profile tool automatically to identify the user.',
    fix: 'Mark one read-only, argument-free tool whose output has a required string id.',
    sources: ['https://developers.openai.com/plugins/build/auth'],
  },
  (snap) => {
    const marked = snap.tools.filter((t) => metaOf(t)['openai/profile'] !== undefined);
    const out: RawFinding[] = [];
    let trueCount = 0;
    for (const t of marked) {
      const name = toolName(t);
      const v = metaOf(t)['openai/profile'];
      if (typeof v !== 'boolean') { out.push({ tool: name, message: 'openai/profile is not a boolean' }); continue; }
      if (!v) continue;
      trueCount++;
      if (annotations(t).readOnlyHint !== true) out.push({ tool: name, message: 'profile tool is not readOnlyHint: true' });
      const req = isObj(t.inputSchema) && Array.isArray(t.inputSchema.required) ? t.inputSchema.required : [];
      if (req.length) out.push({ tool: name, message: 'profile tool has required input properties' });
      const op = properties(t.outputSchema);
      const oreq = isObj(t.outputSchema) && Array.isArray(t.outputSchema.required) ? t.outputSchema.required : [];
      if (!(isObj(op.id) && (op.id as Obj).type === 'string' && oreq.includes('id'))) out.push({ tool: name, message: 'profile outputSchema lacks a required string id' });
      const extra = Object.keys(op).filter((k) => !PROFILE_FIELDS.has(k));
      if (extra.length || (isObj(t.outputSchema) && t.outputSchema.additionalProperties !== false)) {
        out.push({ tool: name, severity: 'warning', message: `profile output should contain only id, name, email, nickname with additionalProperties: false${extra.length ? ` (extra: ${extra.join(', ')})` : ''}` });
      }
    }
    if (trueCount > 1) out.push({ message: `${trueCount} tools are marked openai/profile: true` });
    return out;
  },
);

export const TOOL_032 = defineRule(
  {
    id: 'TOOL-032', title: 'Per-tool securitySchemes', severity: { chatgpt: 'info' }, needs: ['tools'],
    rationale: 'ChatGPT uses securitySchemes to decide which tools need sign-in.',
    fix: 'Declare securitySchemes: [{ type: "oauth2", scopes: [...] }] or [{ type: "noauth" }] on each tool.',
    sources: ['https://developers.openai.com/plugins/build/auth'],
  },
  (snap) => {
    const usesOAuth = !!snap.authProbe?.prm;
    const prmScopes = snap.authProbe?.prm?.json.scopes_supported;
    return perTool(snap, (t) => {
      const ss = t.securitySchemes ?? metaOf(t).securitySchemes;
      if (ss === undefined) return usesOAuth ? { message: 'no securitySchemes declared' } : undefined;
      if (!Array.isArray(ss)) return { severity: 'error', message: 'securitySchemes is not an array' };
      const out: RawFinding[] = [];
      for (const s of ss) {
        if (!isObj(s) || (s.type !== 'noauth' && s.type !== 'oauth2')) { out.push({ severity: 'error', message: `securitySchemes entry type ${JSON.stringify(isObj(s) ? s.type : s)} is not noauth or oauth2` }); continue; }
        if (s.type === 'oauth2' && s.scopes !== undefined && !isStrArray(s.scopes)) { out.push({ severity: 'error', message: 'oauth2 scopes is not a string[]' }); continue; }
        if (s.type === 'oauth2' && isStrArray(s.scopes) && isStrArray(prmScopes)) {
          const unknown = s.scopes.filter((x) => !prmScopes.includes(x));
          if (unknown.length) out.push({ severity: 'warning', message: `scopes not in PRM scopes_supported: ${unknown.join(', ')}` });
        }
      }
      return out;
    });
  },
);

export const toolRules = [
  TOOL_001, TOOL_002, TOOL_003, TOOL_004, TOOL_005, TOOL_006, TOOL_007, TOOL_008, TOOL_009,
  TOOL_023, TOOL_024, TOOL_025, TOOL_026, TOOL_027, TOOL_028, TOOL_029, TOOL_030, TOOL_031, TOOL_032,
];

