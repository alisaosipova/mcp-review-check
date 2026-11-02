// --baseline <report.json>: the findings of an earlier JSON report (--format json) are known; only new findings count
// toward --fail-on and the verdicts. The reporters are unchanged: the CLI renders the new findings as usual and this
// module adds the known ones to each format (JSON `baselined`, SARIF `baselineState`, one line in text and markdown),
// and the tool-definition drift against the baseline's `toolFingerprints` (JSON `baseline`, SARIF BASE-001 results).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sortFindings } from './rules/engine.js';
import type { Finding } from './rules/types.js';
import { JSON_SCHEMA_VERSION, toJson } from './report/json.js';
import { artifactUri, SARIF_LOCATION, toSarif } from './report/sarif.js';
import type { Report } from './report/index.js';
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
}

/**
 * Reads a JSON report as `--format json` writes it (UTF-8 with or without a BOM, or UTF-16LE with its BOM, as Windows
 * editors save it) and returns the identity of each of its findings. Ignored findings and manual items are not known.
 */
export function loadBaseline(file: string): FindingKey[] {
  return readBaseline(file).findings;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** loadBaseline, with the tool fingerprints of the report. */
export function readBaseline(file: string): Baseline {
  let raw: Buffer;
  try { raw = readFileSync(file); } catch (e) {
    const code = (e as { code?: string }).code;
    throw new BaselineError(`cannot read --baseline: ${code === 'ENOENT' ? 'no such file' : code === 'EISDIR' ? 'it is a directory' : (code ?? 'read failed')}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse((raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8')).replace(/^\uFEFF/, ''));
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
  if (d.toolFingerprints === null) tools = null;
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
  return { findings, tools };
}

/** Rule, tool or resource and path: the SARIF partialFingerprints basis. Messages are left out, as their wording and
 *  numbers (sizes, counts, timings) change between runs and releases. */
const subjectKey = (f: FindingKey) => JSON.stringify([f.ruleId, f.tool ?? null, f.resource ?? null, f.path ?? null]);

/** The message with every number as "#": "12 KB" and "13 KB" are the same wording. */
const wording = (m: string | undefined) => (m ?? '').replace(/\d+(\.\d+)?/g, '#');

/**
 * Which findings are known: each one takes an unused baseline finding with the same rule and subject whose platforms
 * include all of its own (a baseline for --target all covers a run for --target claude, not the reverse). Two findings
 * with the same subject need two baseline entries, so a repeat that appears is new; between them, the entry with the
 * same wording (numbers aside) is taken first, so the finding that appeared is the new one, and a reworded message
 * still matches a free entry. `findings` should be redacted as the baseline report was, so that a subject with a
 * secret in it compares equal. SRV-020 (the protocol era, an info note text and markdown show in their header) is never known.
 */
export function knownFindings(findings: FindingKey[], baseline: FindingKey[]): boolean[] {
  const pool = new Map<string, FindingKey[]>();
  for (const b of baseline) {
    const k = subjectKey(b);
    pool.set(k, [...(pool.get(k) ?? []), b]);
  }
  const known = findings.map(() => false);
  const take = (sameWording: boolean) => findings.forEach((f, n) => {
    if (known[n] || f.ruleId === 'SRV-020') return;
    const list = pool.get(subjectKey(f)) ?? [];
    const i = list.findIndex((b) => f.platforms.every((p) => b.platforms.includes(p)) && (!sameWording || wording(b.message) === wording(f.message)));
    if (i < 0) return;
    list.splice(i, 1);
    known[n] = true;
  });
  take(true);
  take(false);
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
  return JSON.stringify(doc, null, 2) + '\n';
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
        message: { text: `${i.name || '(empty name)'}: tool definition ${driftWhat(i)} since baseline` },
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
  return JSON.stringify(doc, null, 2) + '\n';
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
