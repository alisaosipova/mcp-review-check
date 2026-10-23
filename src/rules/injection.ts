// INJ: prompt injection and model manipulation (§2.4). Scope: corpus(snap).
import type { Snapshot } from '../snapshot.js';
import { defineRule, type RawFinding, type Severity } from './types.js';
import { isObj, isStr, toolNames } from './util/access.js';
import { corpus, locationOf, nfkc, snippet, type CorpusEntry } from './util/text.js';

const CLAUDE_POLICY = 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy';
const OAI_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';
const CLAUDE_REVIEW = 'https://claude.com/docs/connectors/building/review-criteria';

export interface Pattern {
  re: RegExp;
  severity?: Severity;
  /** INJ-007: skip when every referenced identifier is one of the server's own tools. */
  ownToolExempt?: boolean;
  /** Skip the match when this tests true on the matched text plus the next 40 characters. */
  unless?: RegExp;
}

/** Run one pattern, honoring `unless`. */
export function matchPattern(p: Pattern, text: string): RegExpExecArray | null {
  const m = p.re.exec(text);
  if (!m || (p.unless && p.unless.test(text.slice(m.index, m.index + m[0].length + 40)))) return null;
  return m;
}

function finding(e: CorpusEntry, text: string, m: RegExpExecArray, extra: Partial<RawFinding> = {}): RawFinding {
  return { tool: e.tool, resource: e.where.startsWith('resource') ? e.subject : undefined, path: e.path, message: `${locationOf(e)}: "${snippet(text, m.index, m[0].length)}"`, evidence: m[0].slice(0, 120), ...extra };
}

/** Run patterns over the NFKC-normalized corpus; one finding per entry and pattern. */
export function scanCorpus(snap: Snapshot, patterns: Pattern[], filter?: (e: CorpusEntry, m: RegExpExecArray, p: Pattern) => boolean): RawFinding[] {
  const out: RawFinding[] = [];
  for (const e of corpus(snap)) {
    const text = nfkc(e.text);
    for (const p of patterns) {
      const m = matchPattern(p, text);
      if (!m || (filter && !filter(e, m, p))) continue;
      out.push(finding(e, text, m, p.severity ? { severity: p.severity } : {}));
      break; // one finding per entry
    }
  }
  return out;
}

// ---- INJ-001 hidden characters (raw text) ----

const PICTO = /\p{Extended_Pictographic}/u;

export function hiddenChars(text: string): { hard: string[]; soft: string[] } {
  const cps = [...text];
  const hard: string[] = [];
  const soft: string[] = [];
  cps.forEach((ch, i) => {
    const cp = ch.codePointAt(0)!;
    const hex = `\\u{${cp.toString(16).toUpperCase()}}`;
    if ((cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) hard.push(hex);
    else if (/\p{Cf}/u.test(ch)) {
      if (cp === 0x200d && PICTO.test(cps[i - 1] ?? '') && PICTO.test(cps[i + 1] ?? '')) return; // emoji ZWJ sequence
      soft.push(hex);
    }
  });
  return { hard: [...new Set(hard)], soft: [...new Set(soft)] };
}

export const INJ_001 = defineRule(
  {
    id: 'INJ-001', title: 'Hidden or invisible characters', severity: { claude: 'error', chatgpt: 'error' }, needs: ['tools'],
    rationale: 'Invisible characters can smuggle instructions past human reviewers.',
    fix: 'Remove invisible and bidi control characters from names and descriptions.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap)) {
      const { hard, soft } = hiddenChars(e.text);
      const base = { tool: e.tool, path: e.path };
      if (hard.length) out.push({ ...base, message: `${locationOf(e)}: tag or bidi control characters ${hard.join(' ')}: "${snippet(e.text)}"` });
      if (soft.length) out.push({ ...base, severity: 'warning', message: `${locationOf(e)}: invisible format characters ${soft.join(' ')}` });
    }
    return out;
  },
);

export const INJ_002 = defineRule(
  {
    id: 'INJ-002', title: 'Mixed-script words (homoglyphs)', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Words mixing Latin with Cyrillic or Greek letters are a homoglyph-spoofing signal.',
    fix: 'Use a single script per word.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap)) {
      for (const m of e.text.matchAll(/\p{L}+/gu)) {
        const w = m[0];
        if (/\p{Script=Latin}/u.test(w) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(w)) {
          out.push({ tool: e.tool, path: e.path, message: `${locationOf(e)}: mixed-script word "${w}"` });
          break;
        }
      }
    }
    return out;
  },
);

// Bounded so that server-controlled text with many '<system' openers and no '>' cannot backtrack quadratically.
const PSEUDO_TAG = /<\/?(system|important|instructions?|admin|assistant|secret|hidden)\b[^>]{0,200}>/i;

/** First `<!-- ... -->` comment, found with indexOf (a lazy regex is quadratic on many '<!--' without '-->'). */
export function htmlComment(text: string): RegExpExecArray | null {
  const start = text.indexOf('<!--');
  if (start < 0) return null;
  const end = text.indexOf('-->', start + 4);
  if (end < 0) return null;
  return Object.assign([text.slice(start, end + 3)], { index: start, input: text }) as unknown as RegExpExecArray;
}

export const INJ_003 = defineRule(
  {
    id: 'INJ-003', title: 'Markup hidden from humans, or pseudo-system tags', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'HTML comments and fake system tags are common injection carriers.',
    fix: 'Remove comments and pseudo-system tags from descriptions.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap)) {
      const text = nfkc(e.text);
      const m = htmlComment(text) ?? PSEUDO_TAG.exec(text);
      if (m) out.push(finding(e, text, m));
    }
    return out;
  },
);

export const INJ_004 = defineRule(
  {
    id: 'INJ-004', title: 'Encoded payloads', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Encoded text hides instructions from reviewers.',
    fix: 'Remove encoded blobs from descriptions.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap)) {
      const text = nfkc(e.text);
      let hit: RegExpExecArray | null = null;
      for (const m of text.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
        const decoded = Buffer.from(m[0], 'base64').toString('latin1');
        const printable = [...decoded].filter((c) => c >= ' ' && c <= '~').length;
        if (decoded.length && printable / decoded.length >= 0.7) { hit = m as RegExpExecArray; break; }
      }
      hit ??= /(\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|%[0-9a-f]{2}){8,}/i.exec(text);
      if (hit) out.push(finding(e, text, hit));
    }
    return out;
  },
);

// Protecting the user's secrets is not hiding behavior ("Never reveal the user's password hash").
const SECRET_OBJECT = /\b(passwords?|passphrases?|secrets?|tokens?|api[ _-]?keys?|keys?|credentials?|hash(es)?|pii|ssn|card numbers?)\b/i;

// Only explicit markers are errors (§1.2, C9): "ignore previous instructions", attacks on system/platform/safety
// instructions, and "don't tell the user". Broader wording is a regex heuristic, so it is a warning.
export const INJ_005_PATTERNS: Pattern[] = [
  { re: /ignore (all |any )?(previous|prior|above|earlier|system) (instructions|prompts?|rules)/i },
  { re: /\b(disregard|override|bypass|forget)\b[^.]{0,30}\b((system|platform|host|assistant'?s?|model'?s?) (instructions|prompts?|rules|message|safeguards|guardrails)|safety (instructions|rules|guidelines|guardrails|filters|policies)|(your|all|any|previous|prior|earlier) instructions)\b/i },
  { re: /\b(do not|don't|never) (tell|inform|notify|alert) the user\b/i, unless: SECRET_OBJECT },
  { re: /\b(disregard|override|bypass|forget)\b[^.]{0,30}\b(instructions|system prompt|guardrails)\b/i, severity: 'warning' },
  { re: /\b(do not|don't|never) (tell|inform|mention|reveal|show|disclose)[^.]{0,30}\b(the )?user\b/i, severity: 'warning', unless: SECRET_OBJECT },
  { re: /\bwithout (asking|telling|confirming with) the user\b/i, severity: 'warning' },
  { re: /\b(you are now|from now on,? you)\b/i, severity: 'warning' },
  { re: /\b(system prompt|developer message)\b/i, severity: 'warning' },
];

export const INJ_005 = defineRule(
  {
    id: 'INJ-005', title: 'Overriding system instructions or hiding behavior from the user', severity: { claude: 'error', chatgpt: 'error' }, needs: ['tools'],
    rationale: 'Tool metadata must not override the host or hide actions from the user.',
    fix: 'Describe the tool factually; never instruct the model to ignore rules or keep things from the user.',
    sources: [CLAUDE_REVIEW, OAI_GUIDE],
  },
  (snap) => scanCorpus(snap, INJ_005_PATTERNS),
);

export const INJ_006_PATTERNS: Pattern[] = [
  { re: /\b(do not|don't|never|avoid)\b[^.]{0,40}\b(use|call|invoke|trust)\b[^.]{0,40}\b(other|any other|another|competing|third[- ]party)\b[^.]{0,20}\b(tools?|servers?|connectors?|plugins?|apps?|mcp)/i },
  { re: /\b(instead of|rather than)\b[^.]{0,40}\b(other|built-?in|default|any)\b[^.]{0,20}(tools?|search|web|plugins?)/i },
  { re: /\bonly (use|call) this (tool|server|plugin)\b(?!\s+(when|if|for|to)\b)/i },
  { re: /\b(always (use|call|prefer) (this|these|our)\b|prefer (this|our) (tool|plugin|server)|better than|superior to|unlike (other|competitor))/i },
];

export const INJ_006 = defineRule(
  {
    id: 'INJ-006', title: 'Steering the model away from other tools', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Servers must not interfere with other tools or disparage competitors.',
    fix: 'Describe when to use this tool without referring to other tools.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => scanCorpus(snap, INJ_006_PATTERNS),
);

export const INJ_007_PATTERNS: Pattern[] = [
  { re: /\b(always|first|must|you should|be sure to)\b[^.]{0,60}\b(call|invoke|use|run)\b[^.]{0,40}\b(tool|function|server|mcp|connector|plugin)\b/i, ownToolExempt: true },
  { re: /before (using|calling|answering)[^.]{0,40}\b(call|invoke|use)\b/i, ownToolExempt: true },
  { re: /\b(use|call|invoke|ask) (the )?[\w\- ]{1,30} (connector|plugin|app|integration)\b/i },
  { re: /(google drive|gmail|slack|notion|github|outlook) (tool|connector)/i },
];

/**
 * Identifiers referenced in the matched sentence: every quoted string (a multi-word title such as
 * 'Query Documentation' counts as one reference) plus the unquoted word after call/use/invoke/run.
 */
export function referencedIdentifiers(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(/[`'"]([^`'"\n]{1,80})[`'"]/g)) ids.push(m[1].trim());
  for (const m of text.matchAll(/\b(?:call|invoke|use|run|using|calling)\s+(?:the\s+)?([A-Za-z0-9_.-]+)/gi)) ids.push(m[1]);
  return ids;
}

/** Words that refer to the tool being described. */
const SELF_REFS = new Set(['this', 'it', 'me', 'these']);

export function ownToolFilter(snap: Snapshot) {
  const own = new Set<string>();
  for (const t of snap.tools) {
    for (const v of [t.name, t.title, isObj(t.annotations) ? t.annotations.title : undefined]) if (isStr(v)) own.add(v.trim().toLowerCase());
  }
  for (const n of toolNames(snap)) own.add(n.toLowerCase());
  return (_e: CorpusEntry, m: RegExpExecArray, p: Pattern): boolean => {
    if (!p.ownToolExempt) return true;
    const ids = referencedIdentifiers(m[0]).map((id) => id.toLowerCase());
    return !(ids.length > 0 && ids.every((id) => own.has(id) || SELF_REFS.has(id)));
  };
}

export const INJ_007 = defineRule(
  {
    id: 'INJ-007', title: 'Coercing calls to tools or software the user did not request', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Metadata must not push the model into calls the user did not ask for.',
    fix: 'Remove imperative call instructions; workflow hints between your own tools are fine.',
    sources: [CLAUDE_REVIEW, OAI_GUIDE],
  },
  (snap) => scanCorpus(snap, INJ_007_PATTERNS, ownToolFilter(snap)),
);

export const INJ_008 = defineRule(
  {
    id: 'INJ-008', title: 'Overly broad triggering', severity: { chatgpt: 'warning', claude: 'info' }, needs: ['tools'],
    rationale: 'Tools must not claim every request.',
    fix: 'Describe the specific situations where the tool applies.',
    sources: [OAI_GUIDE],
  },
  (snap) => scanCorpus(snap, [{ re: /(use|call|invoke|run) (this|me)( tool)? (for|on|with|whenever|before) (any|every|all)\b|for (every|any|all) (request|message|query|question|prompt|conversation)|call (this|me) first|at the start of every/i }]),
);

export const INJ_009_PATTERNS: Pattern[] = [
  { re: /\b(follow|obey|execute|apply|load)\b[^.]{0,40}\b(instructions?|rules|directives|system prompt)\b[^.]{0,40}\b(from|at|in|returned by)\b/i },
  { re: /instructions? (in|from) the (response|result|output)/i },
  { re: /\b(follow|do) what(ever)? the (response|result) says\b/i },
];

export const INJ_009 = defineRule(
  {
    id: 'INJ-009', title: 'Pulling instructions from external sources', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Following instructions from fetched content enables indirect prompt injection.',
    fix: 'Treat tool output as data, never as instructions.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => scanCorpus(snap, INJ_009_PATTERNS),
);

export const INJ_010 = defineRule(
  {
    id: 'INJ-010', title: 'Safety-guardrail circumvention language', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Language about evading safety systems is not allowed.',
    fix: 'Remove circumvention language.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => scanCorpus(snap, [{ re: /\b(jailbreak|circumvent|evade|bypass|disable)\b[^.]{0,40}\b(safety|guardrails?|content policy|sandbox|moderation)\b/i }, { re: /\b(DAN mode|developer mode)\b/i }]),
);

export const injectionRules = [INJ_001, INJ_002, INJ_003, INJ_004, INJ_005, INJ_006, INJ_007, INJ_008, INJ_009, INJ_010];
