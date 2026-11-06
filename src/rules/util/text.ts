// Text helpers shared by many rules (§1.5).
import type { Snapshot } from '../../snapshot.js';
import { ALL_VERBS, READ_VERBS, WRITE_VERBS } from '../lexicon.js';
import { annotations, isObj, isStr, toolName, type Obj } from './access.js';
import { walkSchema } from './schemaWalk.js';
import { MESSAGE_CAP, PATH_CAP, POINTER_MESSAGE_MAX, POINTER_SHOWN } from '../../limits.js';

export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ') // linear form of /([A-Z]+)([A-Z][a-z])/ (see snakeCase)
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .split(/[_\-.\s/:]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

export function firstVerb(name: string): string | undefined {
  return tokenize(name).find((t) => ALL_VERBS.has(t));
}

const CONJUNCTIONS = new Set(['and', 'or', 'then']);

/**
 * A write verb joined to the name by a conjunction (search_and_replace, get_or_create, find_then_delete): such a tool
 * writes whatever its first verb says. A write word without a conjunction (get_order, list_posts) is a noun.
 */
export function compoundWriteVerb(name: string): string | undefined {
  const toks = tokenize(name);
  for (let i = 1; i < toks.length - 1; i++) if (CONJUNCTIONS.has(toks[i]) && WRITE_VERBS.has(toks[i + 1])) return toks[i + 1];
  return undefined;
}

export type ToolKind = 'read' | 'write' | 'unknown';

/**
 * The shared read/write classifier: annotations first (readOnlyHint true → read; readOnlyHint false or
 * destructiveHint true → write), then the first verb of the name, where a joined write verb (search_and_replace)
 * makes a read verb a write tool. Rules use this so they never disagree.
 */
export function toolKind(t: Obj): ToolKind {
  const a = annotations(t);
  if (a.readOnlyHint === true) return 'read';
  if (a.readOnlyHint === false || a.destructiveHint === true) return 'write';
  const v = firstVerb(toolName(t));
  if (v && READ_VERBS.has(v)) return compoundWriteVerb(toolName(t)) ? 'write' : 'read';
  if (v && WRITE_VERBS.has(v)) return 'write';
  return 'unknown';
}

export function nfkc(text: string): string {
  return text.normalize('NFKC');
}

const EMOJI = /\p{Extended_Pictographic}/u;
// What may end the emoji before a joiner: the pictograph, a skin-tone modifier or the emoji presentation selector.
const EMOJI_END = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;

const cpAt = (cps: string[], i: number): number => cps[i]?.codePointAt(0) ?? -1;
const isVariationSelector = (cp: number) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
/** Bases a standardized or emoji variation sequence (U+FE00–FE0F) is defined on: emoji, keycap bases, symbols, CJK, Mongolian. */
const VS_BASE = /[\p{Emoji}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Sm}\p{So}\p{Script=Han}\p{Script=Mongolian}\p{Script=Phags_Pa}\p{Script=Myanmar}]/u;
/** Bases of an ideographic variation sequence (U+E0100–E01EF): CJK ideographs. */
const IVS_BASE = /\p{Script=Han}/u;
const inRange = (cp: number, ...ranges: Array<[number, number]>) => ranges.some(([a, b]) => cp >= a && cp <= b);

/**
 * Invisible code points outside \p{Cf} (A05-02), by severity, or undefined for a visible or legitimate use:
 * - a run of two or more variation selectors (U+FE00–FE0F, U+E0100–E01EF) carries data after a base, the
 *   "emoji smuggling" form of tag characters → hard;
 * - a single variation selector on a base it is not defined for (a Latin letter) → soft; on its own base (❤️, 1️⃣,
 *   a CJK ideograph) it is fine;
 * - Hangul fillers U+3164 and U+FFA0, U+115F/U+1160 outside a conjoining-jamo syllable, the Braille blank U+2800 outside
 *   Braille text, the combining grapheme joiner U+034F and the Khmer inherent vowels U+17B4/U+17B5 → soft. They render
 *   as blanks or nothing and split words for the regex rules.
 */
export function invisibleOutsideCf(cps: string[], i: number): 'hard' | 'soft' | undefined {
  const cp = cpAt(cps, i);
  if (isVariationSelector(cp)) {
    if (isVariationSelector(cpAt(cps, i - 1)) || isVariationSelector(cpAt(cps, i + 1))) return 'hard';
    const base = cps[i - 1] ?? '';
    if (cp <= 0xfe0f ? VS_BASE.test(base) : IVS_BASE.test(base)) return undefined;
    return 'soft';
  }
  if (cp === 0x3164 || cp === 0xffa0 || cp === 0x034f || cp === 0x17b4 || cp === 0x17b5) return 'soft';
  // Conjoining jamo: the choseong filler before a real vowel, the jungseong filler after a real initial consonant.
  if (cp === 0x115f) return inRange(cpAt(cps, i + 1), [0x1161, 0x11a7], [0xd7b0, 0xd7c6]) ? undefined : 'soft';
  if (cp === 0x1160) return inRange(cpAt(cps, i - 1), [0x1100, 0x115e], [0xa960, 0xa97c]) ? undefined : 'soft';
  // The Braille blank is the word space of Braille text.
  if (cp === 0x2800) return inRange(cpAt(cps, i - 1), [0x2801, 0x28ff]) || inRange(cpAt(cps, i + 1), [0x2801, 0x28ff]) ? undefined : 'soft';
  return undefined;
}

/**
 * The form the regex rules scan (INJ-003..010, DATA, POL): NFKC, then invisible characters folded so they cannot split
 * a keyword (A05-02). Format characters, control characters other than whitespace, combining joiners and variation
 * selectors are removed ("ig\u200Bnore" reads "ignore"; whitespace stays); blanks that render as a space (Hangul fillers, the Braille blank)
 * become a space ("Ignore\u3164previous" reads "Ignore previous"). INJ-001 still reports each of them on the raw text.
 */
export function scanForm(text: string): string {
  return foldInvisible(nfkc(text));
}

const SCAN_MEMO = new WeakMap<CorpusEntry, string>();
/** scanForm of a corpus entry, computed once per entry (the regex rules each read every entry). */
export function scanEntry(e: CorpusEntry): string {
  let t = SCAN_MEMO.get(e);
  if (t === undefined) { t = scanForm(e.text); SCAN_MEMO.set(e, t); }
  return t;
}

/** scanForm without NFKC: for INJ-002, where NFKC would erase the fullwidth and mathematical letters it looks for. */
// U+FEFF is \s in JavaScript but invisible, so only real whitespace is kept (review R110-Q1-02).
const FOLD_BLANK = /[\u3164\uFFA0\u115F\u1160\u2800]/gu;
const FOLD_DROP = /(?![\t\n\v\f\r ])[\p{Cf}\p{Cc}\u034F\u17B4\u17B5\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
export function foldInvisible(text: string): string {
  return text.replace(FOLD_BLANK, ' ').replace(FOLD_DROP, '');
}

/**
 * The note a regex finding adds when its snippet quotes the folded text: the hidden characters the scan form removed
 * or turned into spaces, as \u{...} codes, so the evidence still shows them (review R110-Q1-04). Empty when none.
 *
 * `match` is the [index, index + length) range of the match on the scan form. The note is added only when a folded
 * character falls inside that range (A10-04): a hidden character elsewhere in the text, or the emoji presentation
 * selector of ❤️, did not shape the match. A variation selector on a base it is defined for is never named.
 */
export function foldNote(raw: string, match?: { index: number; length: number }): string {
  if (match !== undefined && !foldedWithin(raw, match.index, match.index + match.length)) return '';
  // From the raw text: NFKC rewrites some of them (U+3164 becomes U+1160), and the note should name what the server sent.
  const legit = (m: RegExpMatchArray) => {
    const cp = m[0].codePointAt(0)!;
    if (!isVariationSelector(cp)) return false;
    const before = [...raw.slice(Math.max(0, (m.index ?? 0) - 2), m.index)];
    const after = [...raw.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 2)].slice(0, 1);
    const cps = [...before.slice(-1), m[0], ...after];
    return invisibleOutsideCf(cps, before.length ? 1 : 0) === undefined;
  };
  const codes = [...new Set([...raw.matchAll(FOLD_BLANK), ...[...raw.matchAll(FOLD_DROP)].filter((m) => !legit(m))].map((m) => `\\u{${m[0].codePointAt(0)!.toString(16).toUpperCase()}}`))];
  if (!codes.length) return '';
  return ` (matched with hidden characters folded: ${codes.length > 8 ? `${codes.slice(0, 8).join(' ')} … (+${codes.length - 8} more)` : codes.join(' ')})`;
}

/**
 * Whether scanForm(raw) folded a character inside the scan-form range [start, end): a removed character between two
 * matched characters, or a blank turned into a matched space. Walks the NFKC text once with the same classes as
 * foldInvisible, keeping the scan-form offset.
 */
function foldedWithin(raw: string, start: number, end: number): boolean {
  let pos = 0;
  for (const ch of nfkc(raw)) {
    if (pos >= end) return false;
    if (ch.replace(FOLD_BLANK, ' ') !== ch) {
      if (pos >= start) return true;
      pos += 1;
    } else if (ch.replace(FOLD_DROP, '') === '') {
      if (pos > start) return true;
    } else pos += ch.length;
  }
  return false;
}

/** Escape invisible / control characters as \u{...} for display. A zero-width joiner inside an emoji sequence (👨‍💻) is kept. */
export function escapeHidden(text: string): string {
  const chars = [...text];
  let out = '';
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0)!;
    const emojiJoiner = cp === 0x200d && i > 0 && EMOJI_END.test(chars[i - 1]) && EMOJI.test(chars[i + 1] ?? '');
    if ((/[\p{Cf}\p{Cc}]/u.test(ch) && ch !== '\n' && ch !== '\t' && !emojiJoiner) || invisibleOutsideCf(chars, i)) out += `\\u{${cp.toString(16).toUpperCase()}}`;
    else out += ch;
  });
  return out;
}

/** A display snippet of at most `max` characters around [index, index+len). */
export function snippet(text: string, index = 0, len = text.length, max = 120): string {
  const chars = [...text];
  // convert UTF-16 index to code point index approximately
  const cpIndex = [...text.slice(0, index)].length;
  const cpLen = Math.max(1, [...text.slice(index, index + len)].length);
  const pad = Math.max(0, Math.floor((max - cpLen) / 2));
  const start = Math.max(0, cpIndex - pad);
  const end = Math.min(chars.length, start + max);
  let s = chars.slice(start, end).join('').replace(/\s+/g, ' ');
  if (start > 0) s = '…' + s;
  if (end < chars.length) s += '…';
  return escapeHidden(s);
}

export type CorpusWhere =
  | 'tool.name' | 'tool.title' | 'tool.annotations.title' | 'tool.description' | 'param.description'
  | 'param.title' | 'param.enum' | 'param.default' | 'param.examples' | 'param.name'
  | 'instructions' | 'prompt.description' | 'prompt.argument.description' | 'resource.description'
  | 'resourceTemplate.description';

export interface CorpusEntry {
  text: string;
  where: CorpusWhere;
  tool?: string;
  path?: string;
  subject?: string;
}

/**
 * Which schema-carried strings a rule reads besides the descriptions and titles (A05-01). Hosts send the whole
 * inputSchema to the model, so text in any of these reaches it:
 * - `values`: string `enum` and `const` values (`param.enum`), on by default;
 * - `samples`: string `default`, `examples` and `example` values, nested ones included (`param.default`,
 *   `param.examples`). They are sample user data (a base64 body, a coupon code), so only the hidden-character, markup
 *   and explicit-override rules read them;
 * - `keys`: property names (`param.name`), read by INJ-001 only (TOOL-033 does not cover their characters).
 * Schema `title`s (`param.title`) are always in.
 */
export interface CorpusScope { values?: boolean; samples?: boolean; keys?: boolean }

const SCHEMA_VALUE: ReadonlySet<CorpusWhere> = new Set(['param.enum']);
const SCHEMA_SAMPLE: ReadonlySet<CorpusWhere> = new Set(['param.default', 'param.examples']);
/** String leaves taken from one `default` or `examples` value (a large object default is data, not prose). */
const SAMPLE_LEAVES = 200;

/** The string leaves of a JSON value, with their pointer suffixes, depth- and count-bounded. */
function stringLeaves(value: unknown, path: string, out: Array<[string, string]>, depth = 0): void {
  if (out.length >= SAMPLE_LEAVES || depth > 8) return;
  if (isStr(value)) out.push([value, path]);
  else if (Array.isArray(value)) value.forEach((x, i) => stringLeaves(x, `${path}/${i}`, out, depth + 1));
  else if (isObj(value)) for (const [k, x] of Object.entries(value)) stringLeaves(x, `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, out, depth + 1);
}

/**
 * The corpus is built once per snapshot and shared by the rules that read it (up to 16 per run, which each rebuilt it
 * before 1.1.0). A captured snapshot is not changed, but a test may replace a list or the instructions between runs, so
 * the memo is keyed by the raw tools array, checked against the identity and length of what it was built from, and
 * dropped at the end of the synchronous run that built it (so an in-place edit is seen by the next run). The
 * engine gives each rule of a stopped run its own read-tracking view of the snapshot; the memo is keyed by the raw
 * tools array (the view returns it unwrapped), so those views share one corpus (A09-06), and the signature is still
 * read through the view, so each rule is still tracked on the lists it depends on.
 */
const CORPUS_MEMO = new WeakMap<object, { sig: unknown[]; entries: CorpusEntry[] }>();
const corpusSig = (snap: Snapshot): unknown[] =>
  [snap.tools, snap.tools.length, snap.prompts, snap.prompts.length, snap.resources, snap.resources.length, snap.resourceTemplates, snap.resourceTemplates.length, snap.instructions];

export function corpus(snap: Snapshot, scope: CorpusScope = {}): CorpusEntry[] {
  const sig = corpusSig(snap);
  const key = snap.tools;
  let memo = CORPUS_MEMO.get(key);
  if (!memo || memo.sig.some((x, i) => x !== sig[i])) {
    const built = { sig, entries: buildCorpus(snap) };
    memo = built;
    CORPUS_MEMO.set(key, built);
    // runRules is synchronous, so one run shares the memo; it expires after the current task, so a tool object changed
    // in place before a later run is read afresh (review R110-Q1-06).
    queueMicrotask(() => { if (CORPUS_MEMO.get(key) === built) CORPUS_MEMO.delete(key); });
  }
  const all = memo.entries;
  const { values = true, samples = false, keys = false } = scope;
  return all.filter((e) => (values || !SCHEMA_VALUE.has(e.where)) && (samples || !SCHEMA_SAMPLE.has(e.where)) && (keys || e.where !== 'param.name'));
}

function buildCorpus(snap: Snapshot): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  const push = (text: unknown, where: CorpusWhere, extra: Partial<CorpusEntry> = {}) => {
    if (isStr(text) && text.length > 0) out.push({ text, where, ...extra });
  };
  for (const t of snap.tools) {
    const name = toolName(t);
    push(t.name, 'tool.name', { tool: name });
    push(t.title, 'tool.title', { tool: name });
    if (isObj(t.annotations)) push(t.annotations.title, 'tool.annotations.title', { tool: name });
    push(t.description, 'tool.description', { tool: name });
    walkSchema(t.inputSchema, (v) => {
      const n = v.node;
      const at = v.path === '/' ? '' : v.path;
      if (v.viaProperty) push(n.description, 'param.description', { tool: name, path: v.path });
      push(n.title, 'param.title', { tool: name, path: `${at}/title` });
      if (Array.isArray(n.enum)) n.enum.forEach((x, i) => push(x, 'param.enum', { tool: name, path: `${at}/enum/${i}` }));
      push(n.const, 'param.enum', { tool: name, path: `${at}/const` });
      for (const [key, where] of [['default', 'param.default'], ['examples', 'param.examples'], ['example', 'param.examples']] as const) {
        if (n[key] === undefined) continue;
        const leaves: Array<[string, string]> = [];
        stringLeaves(n[key], `${at}/${key}`, leaves);
        for (const [text, path] of leaves) push(text, where, { tool: name, path });
      }
      if (isObj(n.properties)) for (const k of Object.keys(n.properties)) push(k, 'param.name', { tool: name, path: `${at}/properties/${k.replace(/~/g, '~0').replace(/\//g, '~1')}` });
    });
  }
  push(snap.instructions, 'instructions');
  for (const p of snap.prompts) {
    const name = isStr(p.name) ? p.name : undefined;
    push(p.description, 'prompt.description', { subject: name });
    if (Array.isArray(p.arguments)) {
      for (const a of p.arguments) if (isObj(a)) push(a.description, 'prompt.argument.description', { subject: name, path: isStr(a.name) ? a.name : undefined });
    }
  }
  for (const r of snap.resources) push(r.description, 'resource.description', { subject: isStr(r.uri) ? r.uri : undefined });
  for (const r of snap.resourceTemplates) push(r.description, 'resourceTemplate.description', { subject: isStr(r.uriTemplate) ? r.uriTemplate : undefined });
  return out;
}

/**
 * Where a corpus entry sits, for the finding message. A prompt entry names its prompt (`prompt "summarize" description`,
 * `prompt "summarize" argument topic description`): a prompt finding has no tool or resource subject, so without the
 * name the reader cannot tell which of the server's prompts it is about.
 */
export function locationOf(e: CorpusEntry): string {
  if (e.where.startsWith('prompt.') && e.subject !== undefined) {
    const prompt = `prompt ${JSON.stringify(e.subject)}`;
    if (e.where === 'prompt.argument.description') return `${prompt} argument${e.path ? ` ${shortPointer(e.path)}` : ''} description`;
    return `${prompt} description`;
  }
  return e.path ? `${e.where} ${shortPointer(e.path)}` : e.where;
}

/**
 * A pointer as a finding message shows it (A09-08): in full up to POINTER_MESSAGE_MAX characters, past that its first
 * and last POINTER_SHOWN characters around an ellipsis. Property names are server-chosen and a nested pointer repeats
 * every ancestor's name, so an uncut one makes a message (and every report format) many times the input size.
 */
/** The first and last n UTF-16 units of s around an ellipsis, never splitting a surrogate pair. */
function ends(s: string, n: number): string {
  let a = n, b = s.length - n;
  if (/[\uD800-\uDBFF]/.test(s[a - 1])) a--;
  if (/[\uDC00-\uDFFF]/.test(s[b])) b++;
  return `${s.slice(0, a)}\u2026${s.slice(b)}`;
}

export function shortPointer(p: string): string {
  return p.length <= POINTER_MESSAGE_MAX ? p : ends(p, POINTER_SHOWN);
}

/** A finding message cut to MESSAGE_CAP characters, ending in an ellipsis when cut (A09-08). */
export function capMessage(m: string): string {
  if (m.length <= MESSAGE_CAP) return m;
  let end = MESSAGE_CAP - 1;
  if (/[\uD800-\uDBFF]/.test(m[end - 1])) end--; // do not split a surrogate pair
  return `${m.slice(0, end)}\u2026`;
}

/** The finding `path` field cut to PATH_CAP characters, its start and end kept around an ellipsis (A09-08). */
export function capPath(p: string): string {
  if (p.length <= PATH_CAP) return p;
  return ends(p, Math.floor((PATH_CAP - 1) / 2));
}

const GENERIC_ERROR =
  /^(error|internal (server )?error|bad request|an? (unknown|unexpected) error( occurred)?|something went wrong|invalid (input|request|params|arguments)|failed|request failed|500|400|undefined|null|\[object Object\])\.?$/i;

/** A generic error phrase with no detail. Short but specific messages ("month required") are not generic. */
export function isGenericError(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || GENERIC_ERROR.test(t);
}

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

// Scripts written without spaces between words: whitespace splitting counts a whole sentence as one word.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
let segmenter: Intl.Segmenter | undefined;

/** The number of words, by Unicode word segmentation for Chinese, Japanese, Thai and similar scripts. */
export function wordCount(text: string): number {
  if (!UNSPACED.test(text)) return words(text).length;
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  let n = 0;
  for (const seg of segmenter.segment(text)) if (seg.isWordLike) n++;
  return n;
}
