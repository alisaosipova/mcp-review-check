// --baseline <report.json>: the findings of an earlier JSON report (--format json) are known; only new findings count
// toward --fail-on and the verdicts. The reporters are unchanged: the CLI renders the new findings as usual and this
// module adds the known ones to each format (JSON `baselined`, SARIF `baselineState`, one line in text and markdown),
// and the tool-definition drift against the baseline's `toolFingerprints` (JSON `baseline`, SARIF BASE-001 results).
import { createHash } from 'node:crypto';
import { decodeText, inputFileProblem, readInputFile } from './input-file.js';
import { sortFindings } from './rules/engine.js';
import type { Finding } from './rules/types.js';
import { REDACTED_MARK } from './rules/util/net.js';
import { JSON_SCHEMA_VERSION, toJson } from './report/json.js';
import { artifactUri, SARIF_LOCATION, sarifText, toSarif } from './report/sarif.js';
import { stringifyReport, type Report } from './report/index.js';
import { DRIFT_RULE, driftItems, driftJson, driftWhat, TOOL_FIELDS, type Drift, type ToolFingerprint } from './report/drift.js';

/** What identifies a finding across runs: the rule, the platforms it applies to and its subject; the message only
 *  decides between findings on the same subject. */
export type FindingKey = Pick<Finding, 'ruleId' | 'platforms' | 'tool' | 'resource' | 'path'> & { message?: string };

/** A usage error (exit 2): the file is missing, unreadable or not a JSON report of mcp-review-check. Never quotes the file. */
export class BaselineError extends Error {}

const isOptStr = (v: unknown) => v === undefined || v === null || typeof v === 'string';

/** What a baseline report holds: its findings, and its tool fingerprints (undefined: not recorded, a 0.3 or older
 *  report; null: that run did not list every tool). */
export interface Baseline {
  findings: FindingKey[];
  tools: ToolFingerprint[] | null | undefined;
  /** The baseline is a listing-only report (no server was checked), so its tools are null (A01-04). */
  listingOnly?: boolean;
}

/**
 * Reads a JSON report as `--format json` writes it (UTF-8 with or without a BOM, or UTF-16LE or UTF-16BE with its BOM, as
 * Windows editors save it) and returns the identity of each of its findings. Ignored findings and manual items are not known.
 */
export function loadBaseline(file: string): FindingKey[] {
  return readBaseline(file).findings;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** loadBaseline, with the tool fingerprints of the report. */
export function readBaseline(file: string): Baseline {
  let raw: Buffer;
  try { raw = readInputFile(file); } catch (e) {
    throw new BaselineError(`cannot read --baseline: ${inputFileProblem(e)}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(decodeText(raw));
  } catch {
    // A JSON syntax error message quotes the file: name the problem only.
    throw new BaselineError('--baseline is not valid JSON; give a report written by mcp-review-check --format json');
  }
  const notReport = (why: string) => new BaselineError(`--baseline is not a JSON report of mcp-review-check (${why}); write one with --format json --output <file>`);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw notReport('not a JSON object');
  const d = doc as Record<string, unknown>;
  if ((d.tool as { name?: unknown } | undefined)?.name !== 'mcp-review-check') throw notReport('tool.name is not mcp-review-check');
  if (typeof d.schemaVersion !== 'number' || d.schemaVersion < 1 || d.schemaVersion > JSON_SCHEMA_VERSION) throw notReport(`schemaVersion is not 1 to ${JSON_SCHEMA_VERSION}`);
  if (!Array.isArray(d.findings)) throw notReport('no findings array');
  let tools: ToolFingerprint[] | null | undefined;
  // A listing-only report of 1.0.0 recorded toolFingerprints [] although no server was checked: that is no tool list.
  const listingOnly = (d.server as { listingOnly?: unknown } | undefined)?.listingOnly === true;
  if (d.toolFingerprints === null || listingOnly) tools = null;
  else if (d.toolFingerprints !== undefined) {
    if (!Array.isArray(d.toolFingerprints)) throw notReport('toolFingerprints is not an array');
    tools = d.toolFingerprints.map((t: unknown, i): ToolFingerprint => {
      const x = (t ?? {}) as Record<string, unknown>;
      const fields = x.fields as Record<string, unknown> | undefined;
      const ok = typeof x.name === 'string' && typeof x.sha256 === 'string' && HEX64.test(x.sha256)
        && typeof fields === 'object' && fields !== null && !Array.isArray(fields)
        && Object.entries(fields).every(([k, v]) => (TOOL_FIELDS as readonly string[]).includes(k) && typeof v === 'string' && HEX64.test(v));
      if (!ok) throw notReport(`toolFingerprints[${i}] lacks a name, a SHA-256 or its field digests`);
      return { name: x.name as string, sha256: x.sha256 as string, fields: fields as ToolFingerprint['fields'] };
    });
  }
  const findings = d.findings.map((f: unknown, i): FindingKey => {
    const x = (f ?? {}) as Record<string, unknown>;
    const ok = typeof x.ruleId === 'string' && Array.isArray(x.platforms) && x.platforms.every((p) => typeof p === 'string')
      && isOptStr(x.tool) && isOptStr(x.resource) && isOptStr(x.path) && isOptStr(x.message);
    if (!ok) throw notReport(`findings[${i}] lacks ruleId, platforms or a string tool, resource or path`);
    return { ruleId: x.ruleId as string, platforms: x.platforms as Finding['platforms'], tool: (x.tool ?? undefined) as string | undefined, resource: (x.resource ?? undefined) as string | undefined, path: (x.path ?? undefined) as string | undefined, message: (x.message ?? undefined) as string | undefined };
  });
  return { findings, tools, ...(listingOnly ? { listingOnly } : {}) };
}

/** Rule, tool or resource and path: the SARIF partialFingerprints basis. Messages are left out, as their wording and
 *  numbers (sizes, counts, timings) change between runs and releases. */
const subjectKey = (f: FindingKey) => JSON.stringify([f.ruleId, f.tool ?? null, f.resource ?? null, f.path ?? null]);

/** The message with every number as "#": "12 KB" and "13 KB" are the same wording. */
const wording = (m: string | undefined) => (m ?? '').replace(/\d+(\.\d+)?/g, '#');

/** The unused entries of one bucket, in baseline order: `first` moves only forward, past used entries. */
type Cursor = { idx: number[]; first: number };
/** The baseline entries of one subject with one platform set: all of them, and by wording. */
type Group = { platforms: Set<string>; all: Cursor; byWord: Map<string, Cursor> };

/** A baseline entry whose subject holds the redaction mark: its subject and wording split on the mark. */
type WildEntry = { i: number; b: FindingKey; pieces: string[]; words: string[] };
/** The wildcard entries with one rule, literal prefix and literal suffix; `first` moves only forward past used entries. */
type WildBucket = { list: WildEntry[]; first: number };

/**
 * Whether `s` is the literal `pieces` with a non-empty gap at each split (the mark stood for a value there), as the
 * regex ^p0(?:G)+?p1...pn$ would say, in linear time: each piece is taken at its leftmost place after the previous one
 * (indexOf), which is correct for a glob of "*" gaps. With `inString` (a subject key, a JSON array of strings) a gap is
 * also confined to one JSON string: it holds no unescaped '"' and does not end inside a backslash escape.
 */
export function globMatch(pieces: readonly string[], s: string, inString: boolean): boolean {
  const last = pieces.length - 1;
  if (last === 0) return s === pieces[0];
  if (!s.startsWith(pieces[0]) || !s.endsWith(pieces[last])) return false;
  const end = s.length - pieces[last].length; // where the last piece starts
  let pos = pieces[0].length; // the start of the current gap
  for (let p = 1; p <= last; p++) {
    // The gap runs from pos to the next piece; a scanner walks it once, moving only forward over the candidates.
    let scan = pos;
    let at = p === last ? (end >= pos + 1 ? end : -1) : s.indexOf(pieces[p], pos + 1);
    for (;;) {
      if (at < 0 || at > end) return false;
      if (!inString) break;
      let ok = true;
      while (scan < at) {
        const c = s.charCodeAt(scan);
        if (c === 0x22) return false; // a '"' closes the string: no later place of the piece can help
        scan += c === 0x5c ? 2 : 1;
      }
      if (scan > at) ok = false; // the place splits a backslash escape: try the next one
      if (ok) break;
      if (p === last) return false;
      at = s.indexOf(pieces[p], at + 1);
    }
    pos = at + pieces[p].length;
    if (p < last && pos > end) return false;
  }
  return true;
}

/**
 * Which findings are known: each one takes an unused baseline finding with the same rule and subject whose platforms
 * include all of its own (a baseline for --target all covers a run for --target claude, not the reverse). Two findings
 * with the same subject need two baseline entries, so a repeat that appears is new; between them, the entry with the
 * same wording (numbers aside) is taken first, so the finding that appeared is the new one, and a reworded message
 * still matches a free entry. `findings` should be redacted as the baseline report was, so that a subject with a
 * secret in it compares equal; `alt`, when given, is a second form of the same findings tried for those still new.
 * Last, a baseline entry whose subject holds «redacted» (a value the baseline run redacted, such as a non-secret
 * --env value this run does not pass or passes changed) takes a still-new finding whose subject is the same around
 * it (A01-05). SRV-020 (the protocol era, an info note text and markdown show in their header) is never known.
 */
export function knownFindings(findings: FindingKey[], baseline: FindingKey[], alt?: FindingKey[]): boolean[] {
  // Buckets by subject, then by platform set (few per subject) and by wording: a finding looks only where an entry
  // can match, and each bucket's cursor moves only forward past used entries, so matching stays linear also for many
  // findings on one subject that match no entry (no array copies, no splice, no rescans).
  const pool = new Map<string, Map<string, Group>>();
  const used = baseline.map(() => false);
  baseline.forEach((b, i) => {
    const k = subjectKey(b);
    let groups = pool.get(k);
    if (!groups) pool.set(k, groups = new Map());
    const pk = [...new Set(b.platforms)].sort().join(',');
    let g = groups.get(pk);
    if (!g) groups.set(pk, g = { platforms: new Set(b.platforms), all: { idx: [], first: 0 }, byWord: new Map() });
    g.all.idx.push(i);
    const w = wording(b.message);
    const c = g.byWord.get(w);
    if (c) c.idx.push(i); else g.byWord.set(w, { idx: [i], first: 0 });
  });
  const next = (c: Cursor) => {
    while (c.first < c.idx.length && used[c.idx[c.first]]) c.first++;
    return c.first < c.idx.length ? c.idx[c.first] : -1;
  };
  const known = findings.map(() => false);
  // The first free entry in baseline order among the groups whose platforms include the finding's.
  const take = (sameWording: boolean, list = findings) => list.forEach((f, n) => {
    if (known[n] || f.ruleId === 'SRV-020') return;
    const groups = pool.get(subjectKey(f));
    if (!groups) return;
    const w = sameWording ? wording(f.message) : '';
    let best = -1;
    for (const g of groups.values()) {
      if (!f.platforms.every((p) => g.platforms.has(p))) continue;
      const c = sameWording ? g.byWord.get(w) : g.all;
      const j = c ? next(c) : -1;
      if (j >= 0 && (best < 0 || j < best)) best = j;
    }
    if (best < 0) return;
    used[best] = true;
    known[n] = true;
  });
  take(true);
  take(false);
  // `alt`: the same findings in another redaction (the CLI passes them as the rules wrote them, without the run's
  // --env values redacted); a finding the first form left new may still take a free entry in that form (A01-05).
  const forms = alt && alt.length === findings.length ? [findings, alt] : [findings];
  if (alt && forms.length > 1) {
    take(true, alt);
    take(false, alt);
  }
  // A redacted value in a baseline subject stands for any value inside the same JSON string. Tried last, only for
  // findings still new and against free entries, so no finding that matched before becomes new. Linear (A01-05 of
  // review round 4): a glob match by indexOf, and the entries indexed by rule, literal prefix and literal suffix, so a
  // finding looks only at entries whose ends fit it.
  // Buckets: rule -> "prefix length,suffix length" -> prefix NUL suffix -> the entries in baseline order.
  const wild = new Map<string, Map<string, Map<string, WildBucket>>>();
  let wildCount = 0;
  baseline.forEach((b, i) => {
    const k = subjectKey(b);
    if (!k.includes(REDACTED_MARK)) return;
    const pieces = k.split(REDACTED_MARK);
    const [head, tail] = [pieces[0], pieces[pieces.length - 1]];
    let byShape = wild.get(b.ruleId);
    if (!byShape) wild.set(b.ruleId, byShape = new Map());
    const shape = `${head.length},${tail.length}`;
    let byEnds = byShape.get(shape);
    if (!byEnds) byShape.set(shape, byEnds = new Map());
    const ends = `${head}\u0000${tail}`;
    const entry: WildEntry = { i, b, pieces, words: wording(b.message).split(REDACTED_MARK) };
    const bucket = byEnds.get(ends);
    if (bucket) bucket.list.push(entry); else byEnds.set(ends, { list: [entry], first: 0 });
    wildCount++;
  });
  if (wildCount && known.includes(false)) {
    for (const sameWording of [true, false]) for (const list of forms) list.forEach((f, n) => {
      if (known[n] || f.ruleId === 'SRV-020') return;
      const byShape = wild.get(f.ruleId);
      if (!byShape) return;
      const k = subjectKey(f);
      const w = sameWording ? wording(f.message) : '';
      // The first free entry in baseline order among those whose literal prefix and suffix fit the subject.
      let best: WildEntry | undefined;
      for (const [shape, byEnds] of byShape) {
        const [hl, tl] = shape.split(',').map(Number);
        if (hl + tl + 1 > k.length) continue;
        const bucket = byEnds.get(`${k.slice(0, hl)}\u0000${k.slice(k.length - tl)}`);
        if (!bucket) continue;
        while (bucket.first < bucket.list.length && used[bucket.list[bucket.first].i]) bucket.first++;
        for (let j = bucket.first; j < bucket.list.length; j++) {
          const x = bucket.list[j];
          if (best && x.i > best.i) break; // a bucket is in baseline order
          if (used[x.i] || !f.platforms.every((p) => x.b.platforms.includes(p))) continue;
          if (!globMatch(x.pieces, k, true) || (sameWording && !globMatch(x.words, w, false))) continue;
          best = x;
          break;
        }
      }
      if (!best) return;
      used[best.i] = true;
      known[n] = true;
    });
  }
  return known;
}

/** The new and the known findings in the report's order; `known` holds the known ones by identity. */
function everything(report: Report, known: Finding[]): { all: Finding[]; isKnown: Set<Finding> } {
  return { all: sortFindings([...report.findings, ...known]), isKnown: new Set(known) };
}

/** JSON: every finding, each with `baselined`, `summary.baselined` (the counts and verdicts are of the new ones) and,
 *  with `drift`, `baseline.toolChanges` (null with `baseline.notCompared` when no comparison could be made). */
export function renderJsonWithBaseline(report: Report, known: Finding[], drift?: Drift): string {
  const { all, isKnown } = everything(report, known);
  const doc = toJson({ ...report, findings: all });
  doc.findings = (doc.findings as Record<string, unknown>[]).map((f, i) => ({ ...f, baselined: isKnown.has(all[i]) }));
  doc.summary = { ...(doc.summary as Record<string, unknown>), baselined: known.length };
  if (drift) doc.baseline = driftJson(drift);
  return stringifyReport(doc, 'json', all.length + report.ignored.length);
}

/** The SARIF rule entry for BASE-001 (not a catalog rule), added to the driver only when there is a drift result. */
const DRIFT_SARIF_RULE = {
  id: DRIFT_RULE.id,
  shortDescription: { text: DRIFT_RULE.title },
  fullDescription: { text: 'A tool was added, removed or changed (name, title, description, inputSchema, outputSchema, annotations or _meta) since the --baseline report. A changed tool definition may need a new directory review; this result is informational and not a rule of the catalog.' },
  help: { text: 'Check that the change is intended; refresh the baseline with --save-baseline once it is.' },
  properties: { platforms: [] as string[], synthetic: true },
};

/** SARIF: every result, with the SARIF 2.1.0 `baselineState` "unchanged" (known) or "new", and one `note` result
 *  per tool-definition change under BASE-001 (`baselineState` "new"; the summary counts are of the findings only). */
export function renderSarifWithBaseline(report: Report, known: Finding[], location?: string, drift?: Drift): string {
  const { all, isKnown } = everything(report, known);
  const doc = toSarif({ ...report, findings: all }, location);
  const run = (doc.runs as Record<string, unknown>[])[0];
  run.results = (run.results as Record<string, unknown>[]).map((r, i) => ({ ...r, baselineState: isKnown.has(all[i]) ? 'unchanged' : 'new' }));
  const items = drift ? driftItems(drift) : [];
  if (items.length) {
    const results = run.results as Record<string, unknown>[];
    const uri = artifactUri(location ?? SARIF_LOCATION);
    const seen = new Map<string, number>();
    for (const i of items) {
      const key = [DRIFT_RULE.id, i.kind, i.name].join('|');
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      results.push({
        ruleId: DRIFT_RULE.id,
        partialFingerprints: { 'mcpReviewCheck/v1': createHash('sha256').update(n ? `${key}|${n}` : key).digest('hex') },
        level: 'note',
        message: { text: sarifText(`${i.name || '(empty name)'}: tool definition ${driftWhat(i)} since baseline`) },
        locations: [{ physicalLocation: { artifactLocation: { uri } }, logicalLocations: [{ name: i.name, kind: 'function' }] }],
        baselineState: 'new',
        properties: { change: i.kind, ...(i.fields ? { fields: i.fields } : {}) },
      });
    }
    ((run.tool as { driver: { rules: unknown[] } }).driver.rules).push(DRIFT_SARIF_RULE);
  }
  const props = run.properties as Record<string, unknown>;
  props.summary = { ...(props.summary as Record<string, unknown>), baselined: known.length };
  if (drift) props.baseline = driftJson(drift);
  return stringifyReport(doc, 'sarif', (run.results as unknown[]).length);
}

/** "TOOL-011 ×2, AUTH-005": rule IDs only (no server text), most frequent first, at most 8. */
function ruleTally(known: Finding[]): string {
  const by = new Map<string, number>();
  for (const f of known) by.set(f.ruleId, (by.get(f.ruleId) ?? 0) + 1);
  const ids = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id, n]) => (n > 1 ? `${id} ×${n}` : id));
  return `${ids.slice(0, 8).join(', ')}${ids.length > 8 ? `, +${ids.length - 8} more` : ''}`;
}

/** The one collapsed line for the known findings, or '' without any. */
export function baselineLine(known: Finding[]): string {
  return known.length ? `${known.length} known finding(s) from baseline, not listed: ${ruleTally(known)}` : '';
}

/** Text: the collapsed line above the Score line (not with --quiet, which prints only findings, Score and Result). */
export function addBaselineToText(text: string, known: Finding[], quiet = false): string {
  const line = baselineLine(known);
  return line && !quiet ? text.replace(/^Score /m, `${line}\n\nScore `) : text;
}

/** Markdown: the collapsed line as a "Baseline" row of the summary table, under "Findings". */
export function addBaselineToMarkdown(markdown: string, known: Finding[]): string {
  const line = baselineLine(known);
  return line ? markdown.replace(/^(\| Findings \|[^\n]*)$/m, `$1\n| Baseline | ${line} |`) : markdown;
}
