// TOOL-010..015: tool annotations (§2.3).
import { HARD_DESTRUCTIVE, IRREVERSIBLE, READ_VERBS, WRITE_VERBS } from './lexicon.js';
import { perTool } from './tools.js';
import { defineRule, type RawFinding } from './types.js';
import { annotations, isObj, isStr } from './util/access.js';
import { walkSchema } from './util/schemaWalk.js';
import { firstVerb, tokenize, toolKind } from './util/text.js';

const SCHEMA_TS = 'https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts';
const CLAUDE_POLICY = 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy';
const OAI_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';
const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

export const TOOL_010 = defineRule(
  {
    id: 'TOOL-010', title: 'Annotation field types', severity: { spec: 'error' }, needs: ['tools'],
    rationale: 'Hosts ignore or reject annotations with the wrong types.',
    fix: 'Use a string title and boolean hints (true/false, not "true").',
    sources: [SCHEMA_TS],
  },
  (snap) => perTool(snap, (t) => {
    if (t.annotations === undefined) return undefined;
    if (!isObj(t.annotations)) return { message: 'annotations is not an object' };
    const a = t.annotations;
    const out: RawFinding[] = [];
    if (a.title !== undefined && !isStr(a.title)) out.push({ message: 'annotations.title is not a string' });
    for (const h of HINTS) if (a[h] !== undefined && typeof a[h] !== 'boolean') out.push({ message: `annotations.${h} is ${JSON.stringify(a[h])}, not a boolean` });
    return out;
  }),
);

export const TOOL_011 = defineRule(
  {
    id: 'TOOL-011', title: 'Claude: readOnlyHint or destructiveHint declared', severity: { claude: 'error' }, needs: ['tools'],
    rationale: 'Claude uses these hints to decide auto-permissions; the directory requires them.',
    fix: 'Read-only tools get `readOnlyHint: true`. Tools that modify or delete data get `destructiveHint: true`.',
    sources: ['https://claude.com/docs/connectors/building/submission'],
  },
  (snap) => perTool(snap, (t) => {
    const a = annotations(t);
    if (typeof a.readOnlyHint !== 'boolean' && typeof a.destructiveHint !== 'boolean') return { message: 'neither readOnlyHint nor destructiveHint is set' };
    if (a.readOnlyHint === false && a.destructiveHint === undefined) return { severity: 'warning', message: 'readOnlyHint is false but destructiveHint is absent; make it explicit' };
    return undefined;
  }),
);

export const TOOL_012 = defineRule(
  {
    id: 'TOOL-012', title: 'ChatGPT: readOnlyHint, destructiveHint and openWorldHint all explicit booleans', severity: { chatgpt: 'error' }, needs: ['tools'],
    rationale: 'The OpenAI portal rejects tools without all three hints (annotations_required). Spec defaults do not count.',
    fix: 'Set readOnlyHint, destructiveHint and openWorldHint to explicit booleans.',
    sources: [OAI_GUIDE],
  },
  (snap) => perTool(snap, (t) => {
    const a = annotations(t);
    const missing = ['readOnlyHint', 'destructiveHint', 'openWorldHint'].filter((h) => typeof a[h] !== 'boolean');
    // One finding per tool: the hints share one root cause and one fix.
    return missing.length ? { message: `missing ${missing.join(', ')}` } : undefined;
  }),
);

export const TOOL_013 = defineRule(
  {
    id: 'TOOL-013', title: 'Contradictory annotations', severity: { chatgpt: 'error', claude: 'warning', spec: 'warning' }, needs: ['tools'],
    rationale: 'A tool cannot be both read-only and destructive.',
    fix: 'Fix the hints so they describe the real behavior.',
    sources: [OAI_GUIDE, SCHEMA_TS],
  },
  (snap) => perTool(snap, (t) => {
    const a = annotations(t);
    const out: RawFinding[] = [];
    if (a.readOnlyHint === true && a.destructiveHint === true) out.push({ message: 'readOnlyHint and destructiveHint are both true' });
    if (a.readOnlyHint === true && a.idempotentHint !== undefined) out.push({ platforms: ['spec'], severity: 'info', message: 'idempotentHint is meaningless on a read-only tool' });
    return out;
  }),
);

const WRITE_DESC = /\b(creates?|updates?|deletes?|removes?|sends?|posts?|uploads?|writes?|saves?|submits?|schedules?|triggers?|enqueues?|persists?|modif(y|ies)|overwrites?|permanently)\b/i;

/**
 * Description text with quoted strings and example clauses removed: "blog post comparing React and Vue" in a query
 * tip (Exa) or "e.g. create a note" describes input, not what the tool does.
 */
export function behaviorText(d: string): string {
  return d
    .replace(/"[^"\n]{0,300}"|“[^”\n]{0,300}”|`[^`\n]{0,300}`|(^|[\s(])'[^'\n]{0,300}'(?=[\s.,;:)!?]|$)/g, '$1 ')
    .replace(/\b(e\.g\.|i\.e\.|for example|for instance|such as|like|examples?:)[^.;\n]{0,200}/gi, ' ');
}
const IRREV_DESC = /\b(irreversibl|permanent|cannot be undone|overwrite|send(s)? (an? )?(email|message|sms))/i;

export const TOOL_014 = defineRule(
  {
    id: 'TOOL-014', title: 'Annotations likely do not match behavior (heuristic)', severity: { claude: 'warning', chatgpt: 'warning', spec: 'warning' }, needs: ['tools'],
    rationale: 'Hints decide auto-permissions. Reviewers check that they are accurate.',
    fix: 'Correct the hints, or rename the tool.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => perTool(snap, (t, name) => {
    const a = annotations(t);
    const v = firstVerb(name);
    const d = isStr(t.description) ? t.description : '';
    const out: RawFinding[] = [];
    if (a.readOnlyHint === true) {
      const w = v && WRITE_VERBS.has(v) ? undefined : WRITE_DESC.exec(behaviorText(d));
      // The name is a strong signal; a word in the description alone is a weak one (informational).
      if (v && WRITE_VERBS.has(v)) out.push({ message: `marked readOnlyHint but name starts with write verb "${v}"` });
      else if (w) out.push({ severity: 'info', message: `marked readOnlyHint but the description says "${w[0]}"; check that the tool does not write` });
    }
    if (v && HARD_DESTRUCTIVE.has(v) && a.destructiveHint !== true) out.push({ message: `"${v}" tool without destructiveHint: true` });
    if (v && READ_VERBS.has(v) && a.destructiveHint === true) out.push({ message: `read verb "${v}" but destructiveHint: true` });
    if (a.readOnlyHint === false && a.destructiveHint === false && (tokenize(name).some((x) => IRREVERSIBLE.has(x)) || IRREV_DESC.test(d))) {
      out.push({ platforms: ['chatgpt'], message: 'destructiveHint: false on a tool that looks irreversible' });
    }
    // Without an annotations object TOOL-011 and TOOL-012 already report the missing hints.
    if (v && READ_VERBS.has(v) && isObj(t.annotations) && a.readOnlyHint === undefined) out.push({ platforms: ['spec'], message: `read verb "${v}" but readOnlyHint is absent (treated as destructive and open-world by default)` });
    return out;
  }),
);

// Web access reaches arbitrary targets whatever the verb. Messaging tokens count only for write tools: reading the
// user's own mailbox is a bounded private account, which OpenAI allows to use openWorldHint: false.
const WEB_TOKENS = new Set(['web', 'browse', 'crawl', 'scrape', 'url']);
const MESSAGE_TOKENS = new Set(['tweet', 'publish', 'email', 'sms', 'webhook', 'message', 'mail', 'notify']);
const TARGET_PROP = /^(url|uri|href|link|endpoint|webhook(_url)?|host|hostname)$/i;
const RECIPIENT_PROP = /^(to|recipients?|email_to|cc|bcc|phone(_number)?)$/i;
const DATE_FORMATS = new Set(['date', 'date-time', 'time', 'duration']);

export const TOOL_015 = defineRule(
  {
    id: 'TOOL-015', title: 'openWorldHint false on an open-ended tool (heuristic)', severity: { chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Tools that reach arbitrary external entities are open-world.',
    fix: 'Set openWorldHint: true, or constrain the target with an enum or pattern.',
    sources: [OAI_GUIDE],
  },
  (snap) => perTool(snap, (t, name) => {
    if (annotations(t).openWorldHint !== false) return undefined;
    const toks = tokenize(name);
    const sends = toolKind(t) === 'write' && toks.some((x) => MESSAGE_TOKENS.has(x));
    const tok = toks.find((x) => WEB_TOKENS.has(x)) ?? (sends ? toks.find((x) => MESSAGE_TOKENS.has(x)) : undefined);
    if (tok) return { message: `openWorldHint: false but name mentions "${tok}"` };
    let prop: string | undefined;
    walkSchema(t.inputSchema, (v) => {
      if (prop || !v.viaProperty) return;
      const n = v.node;
      const free = (n.type === 'string' || n.type === undefined) && n.enum === undefined && n.pattern === undefined && !(isStr(n.format) && DATE_FORMATS.has(n.format));
      // `to` is a recipient only on a tool that sends messages (a date range or a graph edge also has `to`).
      const target = TARGET_PROP.test(v.name) || n.format === 'uri' || (sends && (RECIPIENT_PROP.test(v.name) || n.format === 'email'));
      if (free && target) prop = v.rawName;
    });
    return prop ? { message: `openWorldHint: false but free-form "${prop}" parameter reaches arbitrary targets` } : undefined;
  }),
);

export const annotationRules = [TOOL_010, TOOL_011, TOOL_012, TOOL_013, TOOL_014, TOOL_015];
