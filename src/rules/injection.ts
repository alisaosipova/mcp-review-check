// INJ: prompt injection and model manipulation (§2.4). Scope: corpus(snap).
import type { Snapshot } from '../snapshot.js';
import { defineRule, type RawFinding, type Severity } from './types.js';
import { isObj, isStr, toolNames } from './util/access.js';
import { corpus, foldInvisible, foldNote, invisibleOutsideCf, locationOf, scanEntry, snippet, type CorpusEntry, type CorpusScope } from './util/text.js';

const CLAUDE_POLICY = 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy';
const OAI_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';
const CLAUDE_REVIEW = 'https://claude.com/docs/connectors/building/review-criteria';

export interface Pattern {
  re: RegExp;
  severity?: Severity;
  /** Appended to the finding message (e.g. why a match is only informational). */
  note?: string;
  /** INJ-007: skip when every referenced identifier is one of the server's own tools. */
  ownToolExempt?: boolean;
  /**
   * INJ-007: the capture group that names the referenced software ("this", "Slack", "Acme Billing"). It replaces the
   * word after the call verb as the reference, and may also match the server's own name.
   */
  refGroup?: number;
  /** Skip the match when this tests true on the matched text plus the next 40 characters. */
  unless?: RegExp;
  /** Skip the match when this tests true on the matched text alone (e.g. the object between a verb and "the user"). */
  unlessInMatch?: RegExp;
}

/** Run one pattern, honoring `unless`. */
export function matchPattern(p: Pattern, text: string): RegExpExecArray | null {
  const m = p.re.exec(text);
  if (!m || (p.unless && p.unless.test(text.slice(m.index, m.index + m[0].length + 40)))) return null;
  if (p.unlessInMatch?.test(m[0])) return null;
  return m;
}

function finding(e: CorpusEntry, text: string, m: RegExpExecArray, extra: Partial<RawFinding> = {}): RawFinding {
  return { tool: e.tool, resource: e.where.startsWith('resource') ? e.subject : undefined, path: e.path, message: `${locationOf(e)}: "${snippet(text, m.index, m[0].length)}"${text === e.text ? '' : foldNote(e.text, { index: m.index, length: m[0].length })}`, evidence: m[0].slice(0, 120), ...extra };
}

/**
 * Run patterns over the scan form of the corpus; one finding per entry (the first matching pattern wins, an informational
 * one only when no other matches). Without a filter the winning match depends on the text alone, so a text repeated
 * across tools (a shared enum value or parameter description) is matched once per rule.
 */
export function scanCorpus(
  snap: Snapshot, patterns: Pattern[],
  filter?: (e: CorpusEntry, m: RegExpExecArray, p: Pattern) => boolean,
  decorate?: (e: CorpusEntry) => Partial<RawFinding>,
  scope?: CorpusScope,
): RawFinding[] {
  const out: RawFinding[] = [];
  const seen = new Map<string, { m: RegExpExecArray; p: Pattern } | null>();
  const pick = (e: CorpusEntry, text: string): { m: RegExpExecArray; p: Pattern } | null => {
    let hit: { m: RegExpExecArray; p: Pattern } | null = null;
    for (const p of patterns) {
      const m = matchPattern(p, text);
      if (!m || (filter && !filter(e, m, p))) continue;
      if (p.severity === 'info') { hit ??= { m, p }; continue; } // a later pattern may still match harder wording
      return { m, p }; // one finding per entry
    }
    return hit;
  };
  for (const e of corpus(snap, scope)) {
    const text = scanEntry(e);
    let hit = filter ? undefined : seen.get(text);
    if (hit === undefined) { hit = pick(e, text); if (!filter) seen.set(text, hit); }
    if (!hit) continue;
    const f = finding(e, text, hit.m, { ...decorate?.(e), ...(hit.p.severity ? { severity: hit.p.severity } : {}) });
    if (hit.p.note) f.message += ` (${hit.p.note})`;
    out.push(f);
  }
  return out;
}

// ---- INJ-001 hidden characters (raw text) ----

const PICTO = /\p{Extended_Pictographic}/u;
/** Variation selectors and skin-tone modifiers sit between a pictograph and its ZWJ (❤️‍🔥, 👩🏽‍💻, 🏳️‍🌈). */
const EMOJI_TAIL = /^[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}]$/u;

/** The nearest code point from `i` in direction `step` that is not a variation selector or skin-tone modifier. */
function emojiNeighbor(cps: string[], i: number, step: 1 | -1): string {
  let j = i + step;
  while (j >= 0 && j < cps.length && EMOJI_TAIL.test(cps[j])) j += step;
  return cps[j] ?? '';
}

/** Printable ASCII and ordinary whitespace: no hidden character and no other script, the common case, skipped fast. */
const PLAIN_ASCII = /^[\x20-\x7e\t\n\r]*$/;

/**
 * Code point indexes of the tag characters of an RGI subdivision flag (A05-07): U+1F3F4 followed by the tag spelling
 * of gbeng, gbsct or gbwls and the cancel tag U+E007F (England, Scotland, Wales). Every other tag run stays hard.
 */
const RGI_SUBDIVISIONS = new Set(['gbeng', 'gbsct', 'gbwls']);
function subdivisionFlagTags(cps: string[]): Set<number> {
  const out = new Set<number>();
  cps.forEach((ch, i) => {
    if (ch !== '\u{1F3F4}') return;
    let tag = '';
    for (let j = i + 1; j <= i + 5; j++) {
      const cp = cps[j]?.codePointAt(0) ?? 0;
      if (cp < 0xe0061 || cp > 0xe007a) return; // tag a..z
      tag += String.fromCharCode(cp - 0xe0000);
    }
    if (RGI_SUBDIVISIONS.has(tag) && cps[i + 6] === '\u{E007F}') for (let j = i + 1; j <= i + 6; j++) out.add(j);
  });
  return out;
}

/** Letters and marks of scripts whose spelling uses ZWNJ/ZWJ: the joining scripts and the Brahmic (Indic) scripts. */
/** ZWNJ breaks a cursive join: the joining scripts only. */
const ZWNJ_SCRIPT = /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Mandaic}]$/u;
/** ZWJ selects a conjunct or half form: the Brahmic scripts only. */
const ZWJ_SCRIPT = /^[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]$/u;
/** At most this many ZWNJ/ZWJ in one word count as spelling; more is a smuggling run. */
const MAX_JOINERS_PER_WORD = 2;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
/** Letters of the right-to-left scripts, beside which LRM/RLM/ALM fix punctuation placement. */
const RTL_LETTER = /^[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}]$/u;
const scriptLetter = (re: RegExp, c: string | undefined) => !!c && LETTER_OR_MARK.test(c) && re.test(c);

/** Indexes of ZWNJ/ZWJ in words (runs of letters, marks and joiners) holding more than MAX_JOINERS_PER_WORD of them. */
function crowdedJoiners(cps: string[]): Set<number> {
  const out = new Set<number>();
  let run: number[] = [];
  const flush = () => { if (run.length > MAX_JOINERS_PER_WORD) for (const j of run) out.add(j); run = []; };
  cps.forEach((ch, i) => {
    if (ch === '\u200C' || ch === '\u200D') run.push(i);
    else if (!LETTER_OR_MARK.test(ch)) flush();
  });
  flush();
  return out;
}
const rtlLetter = (c: string | undefined) => !!c && /^\p{L}$/u.test(c) && RTL_LETTER.test(c);

/**
 * A format character that spelling needs (A05-08): ZWNJ or ZWJ between two letters (or a letter and a virama) of a
 * joining or Indic script (Persian "می‌خواهم", Devanagari "क्‍ष"), or LRM/RLM/ALM next to a right-to-left letter. The
 * same characters inside a Latin word or in a run are still reported.
 */
function orthographicFormat(cps: string[], i: number, cp: number, crowded: () => Set<number>): boolean {
  if (cp === 0x200c || cp === 0x200d) {
    const re = cp === 0x200c ? ZWNJ_SCRIPT : ZWJ_SCRIPT;
    return scriptLetter(re, cps[i - 1]) && scriptLetter(re, cps[i + 1]) && !crowded().has(i);
  }
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c) return rtlLetter(cps[i - 1]) || rtlLetter(cps[i + 1]);
  return false;
}

export function hiddenChars(text: string): { hard: string[]; soft: string[] } {
  if (PLAIN_ASCII.test(text)) return { hard: [], soft: [] };
  const cps = [...text];
  const hard: string[] = [];
  const soft: string[] = [];
  const flagTags = text.includes('\u{1F3F4}') ? subdivisionFlagTags(cps) : undefined;
  let crowded: Set<number> | undefined;
  cps.forEach((ch, i) => {
    const cp = ch.codePointAt(0)!;
    const hex = `\\u{${cp.toString(16).toUpperCase()}}`;
    if ((cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) {
      if (!flagTags?.has(i)) hard.push(hex);
    } else if (/\p{Cf}/u.test(ch)) {
      if (cp === 0x200d && PICTO.test(emojiNeighbor(cps, i, -1)) && PICTO.test(emojiNeighbor(cps, i, 1))) return; // emoji ZWJ sequence
      if (orthographicFormat(cps, i, cp, () => (crowded ??= crowdedJoiners(cps)))) return;
      soft.push(hex);
    } else {
      // Variation-selector runs, Hangul fillers, the Braille blank, CGJ (A05-02).
      const kind = invisibleOutsideCf(cps, i);
      if (kind === 'hard') hard.push(hex);
      else if (kind === 'soft') soft.push(hex);
    }
  });
  return { hard: [...new Set(hard)], soft: [...new Set(soft)] };
}

/** At most 16 code points in a message: a smuggled run can hold hundreds of distinct variation selectors. */
const codeList = (xs: string[]) => (xs.length > 16 ? `${xs.slice(0, 16).join(' ')} … (+${xs.length - 16} more)` : xs.join(' '));

export const INJ_001 = defineRule(
  {
    id: 'INJ-001', title: 'Hidden or invisible characters', severity: { claude: 'error', chatgpt: 'error' }, needs: ['tools'],
    rationale: 'Invisible characters can smuggle instructions past human reviewers.',
    fix: 'Remove invisible, bidi control and stray variation-selector characters from names, descriptions and schema text.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap, { samples: true, keys: true })) {
      const { hard, soft } = hiddenChars(e.text);
      const base = { tool: e.tool, path: e.path };
      if (hard.length) out.push({ ...base, message: `${locationOf(e)}: ${hard.some((h) => /^\\u\{(FE0|E01)/.test(h)) ? 'tag, bidi control or variation selector' : 'tag or bidi control'} characters ${codeList(hard)}: "${snippet(e.text)}"` });
      if (soft.length) out.push({ ...base, severity: 'warning', message: `${locationOf(e)}: invisible format characters ${codeList(soft)}` });
    }
    return out;
  },
);

// Greek letters that pass for Latin ones. μ, Ω, Δ, π and σ do not, so units such as "μs", "kΩ" and "ΔT" are fine.
const GREEK_LOOKALIKE = /[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧαγικνορυχϲϳ]/u;

/**
 * Biomedical notation: Latin capitals with lowercase Greek letters after them (TNFα, NFκB, PPARγ, ERα, IκBα). A
 * homoglyph swaps a letter inside a word of the same case ("pαypal", "PΑYPAL"); a lowercase Greek letter among capitals
 * reads as itself. Written without nested quantifiers: the classes are disjoint, so each character has one way to
 * match and the test is linear on any word.
 */
const GREEK_NOTATION = /^[A-Z]+[α-ω][A-Zα-ω]*$/u;
/**
 * The same notation led by lowercase Greek (A05-09): NF-κB (the word "κB"), αSMA, γH2AX ("γH"), αKG, and the integrin
 * form αvβ3 ("αvβ"). Only Greek letters that do not pass for Latin ones (no ο ι ν ρ υ χ), so "ιOS", "οPENAI",
 * "ρAYPAL" and "νISA" are still a mix; lowercase Latin after the capitals is not allowed ("ιPhone").
 */
const GREEK_PREFIX_NOTATION = /^[αβγδεζηθκλμξπστφψω]+[A-Z][A-Zαβγδεζηθκλμξπστφψω]*$|^[αβ][a-z][αβ]$/u;

/** Fullwidth Latin letters (Script=Latin) and Mathematical Alphanumeric letters (Script=Common): "Ｇoogle", "𝐏aypal" (A05-10). */
const FULLWIDTH_OR_MATH = /[\uFF21-\uFF3A\uFF41-\uFF5A\u{1D400}-\u{1D6A5}]/u;

/**
 * A word mixing Latin with Cyrillic, Armenian or Cherokee (whose letters pass for Latin: Armenian "օ" is "o", Cherokee
 * "Ꮪ" is "S"), with a Greek letter that looks Latin, or ASCII letters with fullwidth or mathematical ones. A word
 * written wholly in fullwidth letters ("ＰＤＦ" in Japanese text) is one style, not a mix.
 */
export function mixedScript(word: string): boolean {
  if (/[A-Za-z]/.test(word) && FULLWIDTH_OR_MATH.test(word)) return true;
  if (!/\p{Script=Latin}/u.test(word)) return false;
  if (/[\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Cherokee}]/u.test(word)) return true;
  return GREEK_LOOKALIKE.test(word) && !GREEK_NOTATION.test(word) && !GREEK_PREFIX_NOTATION.test(word);
}

export const INJ_002 = defineRule(
  {
    id: 'INJ-002', title: 'Mixed-script words (homoglyphs)', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Words mixing Latin with Cyrillic, Greek, Armenian or Cherokee letters, or with fullwidth or mathematical letters, are a homoglyph-spoofing signal.',
    fix: 'Use a single script per word.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap)) {
      if (PLAIN_ASCII.test(e.text)) continue;
      // Invisible characters removed first: a zero-width space must not split "Gо\u200Bogle" into two clean words.
      for (const m of foldInvisible(e.text).matchAll(/\p{L}+/gu)) {
        const w = m[0];
        if (mixedScript(w)) {
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
/** The tag is named as markup ("Returns the <Secret> element of the KeyVault XML response"), not used as one. */
const NAMED_AS_MARKUP = /^\s+(xml |html )?(elements?|tags?|nodes?|attributes?|fields?)\b/i;

const PSEUDO_TAG_ALL = new RegExp(PSEUDO_TAG.source, 'gi');
/** `<secret-name>`, `<admin_host>`: one hyphenated or underscored word, no whitespace, no attributes. */
const PLACEHOLDER = /^<([A-Za-z]+[-_][\w-]*)>$/;

/** A character next to a placeholder in a URL or command line. */
const URL_OR_CLI = /[/.:=]/;

/**
 * The first pseudo-system tag, read for placeholders (A05-11). A `<name-word>` (no whitespace, no attributes) with no
 * closing `</name-word` in the text is a placeholder: skipped when a neighbouring character is URL- or CLI-like
 * ("https://<vault>.vault.azure.net/secrets/<secret-name>", "--host=<admin-host>"), otherwise reported at info
 * ("<system-prompt> You are ..." may still be a pseudo-tag). Any other match wins at its own severity.
 */
function pseudoTag(text: string): { m: RegExpExecArray; placeholder: boolean } | null {
  PSEUDO_TAG_ALL.lastIndex = 0;
  let closers: Set<string> | undefined; // every `</name-word` of the text, collected once (linear on many placeholders)
  let soft: RegExpExecArray | undefined;
  for (let m = PSEUDO_TAG_ALL.exec(text); m; m = PSEUDO_TAG_ALL.exec(text)) {
    const ph = PLACEHOLDER.exec(m[0]);
    if (!ph) return { m, placeholder: false };
    closers ??= new Set([...text.matchAll(/<\/([A-Za-z]+[-_][\w-]*)/g)].map((c) => c[1].toLowerCase()));
    if (closers.has(ph[1].toLowerCase())) return { m, placeholder: false };
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[0].length] ?? '';
    if (!URL_OR_CLI.test(before) && !URL_OR_CLI.test(after)) soft ??= m;
  }
  return soft ? { m: soft, placeholder: true } : null;
}

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
    fix: 'Remove comments and pseudo-system tags from descriptions and schema text.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap, { samples: true })) {
      const text = scanEntry(e);
      if (!text.includes('<')) continue; // both forms start with '<'
      const comment = htmlComment(text);
      const tag = comment ? null : pseudoTag(text);
      const m = comment ?? tag?.m;
      if (!m) continue;
      const f = finding(e, text, m);
      if (tag?.placeholder) {
        f.severity = 'info';
        f.message += ' (an unclosed <name-word> reads as a placeholder: fine when it stands for a value)';
      } else if (!comment && NAMED_AS_MARKUP.test(text.slice(m.index + m[0].length))) {
        f.severity = 'info';
        f.message += ' (named as a markup element: fine when it documents a data format)';
      }
      out.push(f);
    }
    return out;
  },
);

/**
 * A base64 run that decodes to mostly printable text. Decoded JSON (a pagination cursor, a JWT segment) is data,
 * not a payload, unless it carries instruction-like text.
 */
export function encodedPayload(run: string): boolean {
  const decoded = Buffer.from(run, 'base64').toString('latin1');
  if (!decoded.length) return false;
  const printable = [...decoded].filter((c) => c >= ' ' && c <= '~').length;
  if (printable / decoded.length < 0.7) return false;
  // Unpadded base64 may cut the last characters, so a JSON object or array prefix is enough.
  if (/^\s*(\{\s*"|\[\s*[{"\d\]])/.test(decoded)) return INJ_005_PATTERNS.some((p) => matchPattern(p, decoded));
  return true;
}

/**
 * An escape run that hides text. A percent-encoded run that decodes to UTF-8 without any ASCII letter is a
 * non-Latin word in a URL example (%D0%BF%D1%80%D0%B8... is Russian), not a payload.
 */
export function escapePayload(run: string): boolean {
  if (!/^(%[0-9a-f]{2})+$/i.test(run)) return true;
  try {
    return /[A-Za-z]/.test(decodeURIComponent(run));
  } catch {
    return true; // not UTF-8: raw bytes
  }
}

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
      const text = scanEntry(e);
      if (text.length < 24) continue; // shorter than the shortest run (8 escapes of 3 characters, 40 base64 characters)
      let hit: RegExpExecArray | null = null;
      for (const m of text.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
        if (encodedPayload(m[0])) { hit = m as RegExpExecArray; break; }
      }
      if (!hit) {
        for (const m of text.matchAll(/(\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|%[0-9a-f]{2}){8,}/gi)) {
          if (escapePayload(m[0])) { hit = m as RegExpExecArray; break; }
        }
      }
      if (hit) out.push(finding(e, text, hit));
    }
    return out;
  },
);

// Protecting the user's secrets is not hiding behavior ("Never reveal the user's password hash").
const SECRET_OBJECT = /\b(passwords?|passphrases?|secrets?|tokens?|api[ _-]?keys?|keys?|credentials?|hash(es)?|pii|ssn|card numbers?)\b/i;
// Neither is presentation guidance about raw data ("Never show raw note IDs to the user; show titles instead").
const RAW_DATA_OBJECT = /\b(raw|ids?|identifiers?|uuids?|json|stack ?traces?|debug|error codes?|fields?|metadata|urls?|markup|html|markdown)\b/i;

// Only explicit markers are errors (§1.2, C9): "ignore previous instructions", attacks on system/platform/safety
// instructions, and "don't tell the user". Broader wording is a regex heuristic, so it is a warning.
export const INJ_005_PATTERNS: Pattern[] = [
  { re: /ignore (all |any )?(previous|prior|above|earlier|system) (instructions|prompts?|rules)/i },
  { re: /\b(disregard|override|bypass|forget)\b[^.]{0,30}\b((system|platform|host|assistant'?s?|model'?s?) (instructions|prompts?|rules|message|safeguards|guardrails)|safety (instructions|rules|guidelines|guardrails|filters|policies)|(your|all|any|previous|prior|earlier) instructions)\b/i },
  { re: /\b(do not|don't|never) (tell|inform|notify|alert) the user\b/i, unless: SECRET_OBJECT },
  { re: /\b(disregard|override|bypass|forget)\b[^.]{0,30}\b(instructions|system prompt|guardrails)\b/i, severity: 'warning' },
  // "user" must be the addressee, not a modifier: "Do not show user avatars larger than 64px" is layout guidance.
  { re: /\b(do not|don't|never) (tell|inform|mention|reveal|show|disclose)[^.]{0,30}\b(the )?user\b(?![- ](avatars?|names?|ids?|generated|input|profiles?|photos?|pictures?|images?|data|content|accounts?|interface|agents?|groups?|roles?|settings|records?|emails?|handles?)\b)/i, severity: 'warning', unless: SECRET_OBJECT, unlessInMatch: RAW_DATA_OBJECT },
  { re: /\bwithout (asking|telling|confirming with) the user\b/i, severity: 'warning' },
  // A role change, not a status report: "You are now connected to the workspace" is not a persona switch.
  { re: /\b(you are now(?! (connected|signed|logged|authenticated|authorized|subscribed|registered|enrolled|ready|done|online|offline|disconnected)\b)|from now on,? you)\b/i, severity: 'warning' },
  { re: /\b(system prompt|developer message)\b/i, severity: 'warning' },
];

export const INJ_005 = defineRule(
  {
    id: 'INJ-005', title: 'Overriding system instructions or hiding behavior from the user', severity: { claude: 'error', chatgpt: 'error' }, needs: ['tools'],
    rationale: 'Tool metadata must not override the host or hide actions from the user.',
    fix: 'Describe the tool factually; never instruct the model to ignore rules or keep things from the user.',
    sources: [CLAUDE_REVIEW, OAI_GUIDE],
  },
  // Defaults and examples too (A05-01): an explicit override in a sample value still reaches the model.
  (snap) => scanCorpus(snap, INJ_005_PATTERNS, undefined, undefined, { samples: true }),
);

const MEASURE = String.raw`\s+(the |a |an |its |their |your )?((given|specified|configured|previous|current|minimum|maximum|target|expected|required) )?((thresholds?|average|baseline|median|mean|minimum|maximum|min|max|limits?|targets?|cutoffs?|benchmarks?|scores?|ratings?|values?|expected|previous|last|before|zero|chance|random)\b|[-+<>=%$.\d])`;
const SELF = String.raw`(this|these|our)(\s+(tool|skill|server|plugin|connector|app|resource|prompt|function)s?)?`;
const CONDITIONAL = String.raw`${SELF}(\s+first)?\s+(when(ever)?|if|for|to|before|after|whenever)\b`;

export const INJ_006_PATTERNS: Pattern[] = [
  // "Do NOT use it for other MCP servers" restricts this tool's own scope (Kiwi): the object after the verb must not be a self reference.
  { re: /\b(do not|don't|never|avoid)\b[^.]{0,40}\b(use|call|invoke|trust)\b(?!\s+(it|this|me|these|them)\b)[^.]{0,40}\b(other|any other|another|competing|third[- ]party)\b[^.]{0,20}\b(tools?|servers?|connectors?|plugins?|apps?|mcp)/i },
  // The object is a tool or a way of searching: "rather than the default full web page" describes an output format.
  { re: /\b(instead of|rather than)\b[^.]{0,40}\b(other|built-?in|default|any)\b[^.]{0,20}\b(tools?|search|web[- ]?search|browsing|browser|plugins?)\b/i },
  { re: /\bonly (use|call) this (tool|server|plugin)\b(?!\s+(when|if|for|to)\b)/i },
  // "Always use this tool when/to/for ..." says when the tool applies (MS Learn, Hugging Face skills): informational.
  { re: new RegExp(String.raw`\balways (use|call|prefer) ${CONDITIONAL}`, 'i'), severity: 'info', note: 'conditional: fine when it describes when this applies' },
  // The conditional form above is not matched again here, so "better than ..." next to it is still a warning.
  // A comparison with a number, threshold or statistic ("rating better than the given threshold") is not disparagement.
  { re: new RegExp(String.raw`\b(always (use|call|prefer) (?!${CONDITIONAL})(this|these|our)\b|prefer (this|our) (tool|plugin|server)|(better than|superior to)(?!${MEASURE})|unlike (other|competitor))`, 'i') },
];

/** The fix for the kind of object that was flagged: a tool, a skill (skill:// resource), another resource, a prompt or the instructions. */
export function steeringFix(e: CorpusEntry): string {
  if (e.where.startsWith('resource')) {
    return e.subject?.startsWith('skill://')
      ? 'Describe when this skill applies; do not tell the model to always load it or to avoid other tools.'
      : 'Describe what this resource contains; do not tell the model to prefer it over other sources.';
  }
  if (e.where.startsWith('prompt')) return 'Describe what this prompt does; do not steer the model away from other tools.';
  if (e.where === 'instructions') return 'Describe how your own tools work together; do not tell the model to avoid other tools or servers.';
  return 'Describe when to use this tool without steering the model away from other tools.';
}

export const INJ_006 = defineRule(
  {
    id: 'INJ-006', title: 'Steering the model away from other tools', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Servers must not interfere with other tools or disparage competitors.',
    fix: 'Describe when to use this tool without steering the model away from other tools.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => scanCorpus(snap, INJ_006_PATTERNS, undefined, (e) => ({ fix: steeringFix(e) })),
);

export const INJ_007_PATTERNS: Pattern[] = [
  { re: /\b(always|first|must|you should|be sure to)\b[^.]{0,60}\b(call|invoke|use|run)\b[^.]{0,40}\b(tool|function|server|mcp|connector|plugin)\b/i, ownToolExempt: true },
  { re: /before (using|calling|answering)[^.]{0,40}\b(call|invoke|use)\b/i, ownToolExempt: true },
  // "Use this app to track workouts" is the app describing itself, so the self-reference exemption applies here too.
  { re: /\b(use|call|invoke|ask) (the )?([\w\- ]{1,30}) (connector|plugin|app|integration)\b/i, ownToolExempt: true, refGroup: 3 },
  // A first-party server may name its own brand ("Post via the Slack connector" from the Slack server).
  { re: /(google drive|gmail|slack|notion|github|outlook) (tool|connector)/i, ownToolExempt: true, refGroup: 1 },
];

/**
 * Identifiers referenced in the matched sentence: every quoted string (a multi-word title such as
 * 'Query Documentation' counts as one reference) plus the unquoted word after call/use/invoke/run.
 */
export function referencedIdentifiers(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(/[`'"]([^`'"\n]{1,80})[`'"]/g)) ids.push(m[1].trim());
  // The article is never the identifier: in "call the `x` tool" the optional (?:the\s+) backtracks when a quote follows,
  // and without the lookahead 'the' would be captured as a referenced name.
  for (const m of text.matchAll(/\b(?:call|invoke|use|run|using|calling)\s+(?:the\s+)?(?!(?:the|a|an)\b)([A-Za-z0-9_.-]+)/gi)) ids.push(m[1]);
  return ids;
}

/** Words that refer to the tool, app or server being described. */
const SELF_REFS = new Set(['this', 'it', 'me', 'these', 'our']);

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function ownToolFilter(snap: Snapshot) {
  const own = new Set<string>();
  for (const t of snap.tools) {
    for (const v of [t.name, t.title, isObj(t.annotations) ? t.annotations.title : undefined]) if (isStr(v)) own.add(v.trim().toLowerCase());
  }
  for (const n of toolNames(snap)) own.add(n.toLowerCase());
  const isOwn = (id: string) => own.has(id) || SELF_REFS.has(id);
  // A named product ("Slack", "Google Drive") is the server's own when every word of it appears in serverInfo.name or title.
  const serverWords = new Set([snap.serverInfo?.name, snap.serverInfo?.title].filter(isStr).flatMap(words));
  const isOwnProduct = (id: string) => isOwn(id) || (words(id).length > 0 && words(id).every((w) => serverWords.has(w)));
  return (_e: CorpusEntry, m: RegExpExecArray, p: Pattern): boolean => {
    if (!p.ownToolExempt) return true;
    if (p.refGroup !== undefined) {
      const quoted = [...m[0].matchAll(/[`'"]([^`'"\n]{1,80})[`'"]/g)].map((q) => q[1].trim().toLowerCase());
      const ref = m[p.refGroup]?.trim().toLowerCase().replace(/^(this|these|our)\s+/, ''); // "our Acme" is Acme
      return !(ref && isOwnProduct(ref) && quoted.every(isOwnProduct));
    }
    const ids = referencedIdentifiers(m[0]).map((id) => id.toLowerCase());
    return !(ids.length > 0 && ids.every(isOwn));
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

const NOT_TOPIC = String.raw`(?!\s+([\w-]+\s+){0,2}(about|regarding|related to|concerning|involving)\b)`;

export const INJ_008 = defineRule(
  {
    id: 'INJ-008', title: 'Overly broad triggering', severity: { chatgpt: 'warning', claude: 'info' }, needs: ['tools'],
    rationale: 'Tools must not claim every request.',
    fix: 'Describe the specific situations where the tool applies.',
    sources: [OAI_GUIDE],
  },
  // "for every query" counts only after a call verb in the same clause: "returns at most 20 matches for any query" is a limit, not a claim.
  // A topic after the quantifier narrows the trigger: "for any question about billing" is a scope hint.
  (snap) => scanCorpus(snap, [{ re: new RegExp(String.raw`(use|call|invoke|run) (this|me)( tool)? (for|on|with|whenever|before) (any|every|all)\b${NOT_TOPIC}|\b(use|call|invoke|run|trigger)\b[^.;:]{0,40}\bfor (every|any|all) (request|message|query|question|prompt|conversation)s?\b${NOT_TOPIC}|\b(should|must) be (used|called|invoked) (for|on) (every|any|all) (request|message|query|question|prompt|conversation)s?\b${NOT_TOPIC}|call (this|me) first|at the start of every`, 'i') }]),
);

export const INJ_009_PATTERNS: Pattern[] = [
  // The source must be fetched or returned content: "follow the setup instructions in the README" and "load rules from a
  // YAML file" are documentation and configuration.
  { re: /\b(follow|obey|execute|apply|load)\b[^.]{0,40}\b(instructions?|rules|directives|system prompt)\b[^.]{0,40}\b(from|at|in|returned by)\s+(the |a |an |any |each |every |this |that )?(responses?|results?|output|(web ?)?pages?|websites?|sites?|urls?|links?|documents?|file contents?|contents?|fetched|returned|retrieved|tool (output|results?)|e-?mails?|messages?|comments?|issues?|tickets?|remote|server)\b/i },
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
