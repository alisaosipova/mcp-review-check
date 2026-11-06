// Tool-definition drift (0.4.0): a SHA-256 fingerprint of each tool's definition, written into every JSON report
// (`toolFingerprints`), so a report saved with --save-baseline records what the tools looked like; --baseline compares
// them with this run and reports the added, removed and changed tools ("Changed tool definitions"). Informational:
// it never changes the verdicts or the exit code, unless --fail-on-drift.
import { createHash } from 'node:crypto';
import type { Snapshot } from '../snapshot.js';
import { toolName } from '../rules/util/access.js';
import { subjectOf } from '../rules/engine.js';
import { visibleText } from './index.js';

/** The fields of a tool definition that make its fingerprint, in this order (MCP Tool: name, title, description,
 *  inputSchema, outputSchema, annotations, _meta). Anything else a server adds to a tool is left out. */
export const TOOL_FIELDS = ['name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations', '_meta'] as const;
export type ToolField = (typeof TOOL_FIELDS)[number];

/** The rule ID of a drift result in SARIF. Not a catalog rule: it is not in --list-rules, explain or --ignore. */
export const DRIFT_RULE = { id: 'BASE-001', title: 'Tool definition changed since baseline' } as const;

export interface ToolFingerprint {
  name: string;
  /** SHA-256 (hex) of the canonical JSON of the tool's TOOL_FIELDS that are present. */
  sha256: string;
  /** SHA-256 of the canonical JSON of each present field; an absent field has no entry. */
  fields: Partial<Record<ToolField, string>>;
}

export interface ToolChanges {
  added: string[];
  removed: string[];
  changed: Array<{ name: string; fields: ToolField[] }>;
}

/** The comparison with the baseline: `toolChanges` null when it could not be made, with the reason in `notCompared`. */
export interface Drift {
  toolChanges: ToolChanges | null;
  notCompared?: string;
  /** Which side made the comparison impossible: the baseline (re-save it) or this run (fix the run first). */
  notComparedBy?: 'baseline' | 'run';
  /** The number of tools of this run that were compared (for the "no change" line). */
  tools: number;
}

/** JSON with every object's keys sorted (by UTF-16 code unit), no whitespace; undefined members are left out, as
 *  JSON.stringify does. No recursion: a server may nest an inputSchema thousands of levels deep. */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  // Work items, last first: a value to write, or a literal piece of punctuation.
  const todo: Array<{ v: unknown } | string> = [{ v: value }];
  while (todo.length) {
    const item = todo.pop()!;
    if (typeof item === 'string') { out.push(item); continue; }
    const v = item.v;
    if (v === null || typeof v !== 'object') { out.push(JSON.stringify(v) ?? 'null'); continue; }
    const next: Array<{ v: unknown } | string> = [];
    if (Array.isArray(v)) {
      next.push('[');
      v.forEach((x, i) => { if (i) next.push(','); next.push({ v: x === undefined ? null : x }); });
      next.push(']');
    } else {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      next.push('{');
      keys.forEach((k, i) => next.push(`${i ? ',' : ''}${JSON.stringify(k)}:`, { v: o[k] }));
      next.push('}');
    }
    for (let i = next.length - 1; i >= 0; i--) todo.push(next[i]);
  }
  return out.join('');
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** TOOL_FIELDS in canonical key order (by UTF-16 code unit), so the whole-tool string is built from the field strings. */
const SORTED_FIELDS = [...TOOL_FIELDS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The fingerprint of one tool. Each present field is canonicalized once; the whole-tool canonical JSON is assembled
 * from those strings in sorted key order, which is byte for byte what canonicalJson of the picked fields gives (I-A09-5).
 */
export function toolFingerprint(t: Record<string, unknown>): ToolFingerprint {
  const canon = new Map<ToolField, string>();
  for (const f of TOOL_FIELDS) if (t[f] !== undefined) canon.set(f, canonicalJson(t[f]));
  const whole = `{${SORTED_FIELDS.filter((f) => canon.has(f)).map((f) => `${JSON.stringify(f)}:${canon.get(f)}`).join(',')}}`;
  return {
    name: toolName(t),
    sha256: sha256(whole),
    fields: Object.fromEntries([...canon].map(([f, c]) => [f, sha256(c)])),
  };
}

/** Why this run's tools/list is not the server's whole tool list, or undefined when it is. */
export function incompleteTools(snap: Snapshot): string | undefined {
  // A listing-only run lists no tools: [] would read as "a server with no tools" (every baseline tool removed).
  if (snap.target.kind === 'listing') return 'no server was checked (a listing-only run)';
  if (snap.fatal) return 'the run did not connect';
  if (snap.listMeta.tools?.error) return 'tools/list failed';
  const level = snap.coverage.toolLevel;
  if (level === 'stopped') {
    const done = (snap.limits?.stopped ?? snap.limits?.budgetExhausted)?.completed?.includes('listing');
    return done ? undefined : snap.limits?.budgetExhausted ? 'the snapshot budget ran out before tools/list finished' : 'the run stopped before tools/list finished';
  }
  return level === 'ok' ? undefined : `the check is partial (${level})`;
}

/** Fingerprints set by pinFingerprints for a (redacted) report snapshot. */
const pinned = new WeakMap<Snapshot, ToolFingerprint[] | null>();
/** The report snapshot's own fingerprints, kept by pinFingerprints for compareTools (the 1.0.0 form). */
const own = new WeakMap<Snapshot, ToolFingerprint[] | null>();

/** The fingerprints of the snapshot as it is, ignoring a pin (computed once per snapshot when pinned). */
function ownFingerprints(snap: Snapshot): ToolFingerprint[] | null {
  if (own.has(snap)) return own.get(snap)!;
  return incompleteTools(snap) ? null : snap.tools.map(toolFingerprint);
}

/**
 * Sets the fingerprints of the report's snapshot `report` from `rules`, the snapshot the rules saw (strong secrets
 * scrubbed, strings over the input cap cut, but no run-specific --env values redacted), so that a non-secret --env
 * value echoed in a tool does not make the digest depend on the command line (A01-05). The names stay the report's
 * (redacted), as the JSON report and the drift lines print them. Each snapshot is fingerprinted once per run: the
 * report's own fingerprints are kept for compareTools (I-A09-5).
 */
export function pinFingerprints(report: Snapshot, rules: Snapshot): void {
  const raw = ownFingerprints(rules);
  const shown = ownFingerprints(report);
  own.set(report, shown);
  pinned.set(report, raw && shown && raw.length === shown.length ? raw.map((f, i) => ({ ...f, name: shown[i].name })) : shown);
}

/** The fingerprints of the snapshot's tools, in tools/list order, or null when tools/list did not finish (or no server
 *  was checked). Computed over the snapshot the rules saw when the CLI pinned them, else over `snap` as it is. */
export function toolFingerprints(snap: Snapshot): ToolFingerprint[] | null {
  return pinned.has(snap) ? pinned.get(snap)! : ownFingerprints(snap);
}

/** The fields whose digest differs, or that one side has and the other not, in TOOL_FIELDS order. */
function changedFields(a: ToolFingerprint, b: ToolFingerprint): ToolField[] {
  return TOOL_FIELDS.filter((f) => a.fields[f] !== b.fields[f]);
}

/**
 * `baseline`: the baseline's fingerprints; undefined when the baseline report has none (0.3 or older), null when its
 * tools/list did not finish. Tools are paired by name; two tools with one name pair in their tools/list order, and
 * the extra ones are added or removed. `baselineListingOnly`: the baseline is a listing-only report.
 */
export function compareTools(baseline: ToolFingerprint[] | null | undefined, snap: Snapshot, baselineListingOnly = false): Drift {
  const now = toolFingerprints(snap);
  if (baseline === undefined) return { toolChanges: null, notCompared: 'tool fingerprints were not recorded in the baseline (a report of mcp-review-check 0.3 or older); write it again with --save-baseline', notComparedBy: 'baseline', tools: 0 };
  // A listing-only baseline checked no server: said as such, not as a run that failed to list (A01-04).
  if (baseline === null && baselineListingOnly) return { toolChanges: null, notCompared: 'the baseline is a listing-only report (no server was checked), so it recorded no tool fingerprints', notComparedBy: 'baseline', tools: 0 };
  if (baseline === null) return { toolChanges: null, notCompared: 'the baseline run did not list every tool, so it recorded no tool fingerprints', notComparedBy: 'baseline', tools: 0 };
  if (now === null) return { toolChanges: null, notCompared: `this run did not list every tool: ${incompleteTools(snap)}`, notComparedBy: 'run', tools: 0 };
  // A baseline written by 1.0.0 hashed the report's snapshot (run-specific --env values redacted): a tool whose digest
  // matches that form is unchanged too, so a pinned run never reports a change 1.0.0 would not have.
  const alt = pinned.has(snap) ? ownFingerprints(snap) : null;
  // Tools with one name pair in tools/list order: a queue per name with a read index (no shift, no copies).
  const before = new Map<string, { list: ToolFingerprint[]; next: number }>();
  for (const t of baseline) {
    const q = before.get(t.name);
    if (q) q.list.push(t);
    else before.set(t.name, { list: [t], next: 0 });
  }
  const changes: ToolChanges = { added: [], removed: [], changed: [] };
  now.forEach((t, i) => {
    const q = before.get(t.name);
    const old = q && q.next < q.list.length ? q.list[q.next++] : undefined;
    const other = alt?.[i];
    if (!old) changes.added.push(t.name);
    else if (old.sha256 !== t.sha256 && old.sha256 !== other?.sha256) {
      const fields = changedFields(old, t).filter((f) => !other || old.fields[f] !== other.fields[f]);
      changes.changed.push({ name: t.name, fields: fields.length ? fields : changedFields(old, t) });
    }
  });
  for (const q of before.values()) for (let k = q.next; k < q.list.length; k++) changes.removed.push(q.list[k].name);
  return { toolChanges: changes, tools: now.length };
}

export const driftCount = (d: Drift | undefined) => (d?.toolChanges ? d.toolChanges.added.length + d.toolChanges.removed.length + d.toolChanges.changed.length : 0);

export interface DriftItem { kind: 'added' | 'removed' | 'changed'; name: string; fields?: ToolField[] }

export function driftItems(d: Drift): DriftItem[] {
  const c = d.toolChanges;
  if (!c) return [];
  return [
    ...c.added.map((name): DriftItem => ({ kind: 'added', name })),
    ...c.removed.map((name): DriftItem => ({ kind: 'removed', name })),
    ...c.changed.map((x): DriftItem => ({ kind: 'changed', name: x.name, fields: x.fields })),
  ];
}

/** "changed: description, inputSchema", "added", "removed". */
export const driftWhat = (i: DriftItem) => (i.kind === 'changed' ? `changed: ${i.fields!.join(', ')}` : i.kind);

/** One line for a run with nothing to list: no change, or why there was no comparison. Undefined when there are changes. */
export function driftSummary(d: Drift): string | undefined {
  if (!d.toolChanges) return `Tool definitions not compared: ${d.notCompared}.`;
  return driftCount(d) ? undefined : `Tool definitions: no change since baseline (${d.tools} tool${d.tools === 1 ? '' : 's'}).`;
}

/** The heading of the section, with the count, and the note that --fail-on-drift failed the run. */
export function driftHeading(d: Drift, failOnDrift = false): string {
  const n = driftCount(d);
  return `Changed tool definitions (${n} since baseline)${failOnDrift ? ' · fails the run (--fail-on-drift)' : ''}`;
}

/** Plain lines of the section, server text made visible (tool names are the redacted report's). */
export function driftLines(d: Drift): string[] {
  return driftItems(d).map((i) => visibleText(`${i.kind === 'added' ? '+' : i.kind === 'removed' ? '-' : '~'} ${subjectOf({ tool: i.name })}: ${driftWhat(i)}`));
}

/** The `baseline` member of the JSON report. */
export function driftJson(d: Drift): Record<string, unknown> {
  return { toolChanges: d.toolChanges, ...(d.notCompared ? { notCompared: d.notCompared } : {}) };
}
