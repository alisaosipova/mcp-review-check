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

export function toolFingerprint(t: Record<string, unknown>): ToolFingerprint {
  const present = TOOL_FIELDS.filter((f) => t[f] !== undefined);
  return {
    name: toolName(t),
    sha256: sha256(canonicalJson(Object.fromEntries(present.map((f) => [f, t[f]])))),
    fields: Object.fromEntries(present.map((f) => [f, sha256(canonicalJson(t[f]))])),
  };
}

/** Why this run's tools/list is not the server's whole tool list, or undefined when it is. */
export function incompleteTools(snap: Snapshot): string | undefined {
  if (snap.fatal) return 'the run did not connect';
  if (snap.listMeta.tools?.error) return 'tools/list failed';
  const level = snap.coverage.toolLevel;
  if (level === 'stopped') return snap.limits?.stopped?.completed?.includes('listing') ? undefined : 'the run stopped before tools/list finished';
  return level === 'ok' ? undefined : `the check is partial (${level})`;
}

/** The fingerprints of the snapshot's tools, in tools/list order, or null when tools/list did not finish. Computed over
 *  the snapshot as the report holds it: secrets redacted and strings over the input cap cut (see limits.truncated). */
export function toolFingerprints(snap: Snapshot): ToolFingerprint[] | null {
  return incompleteTools(snap) ? null : snap.tools.map(toolFingerprint);
}

/** The fields whose digest differs, or that one side has and the other not, in TOOL_FIELDS order. */
function changedFields(a: ToolFingerprint, b: ToolFingerprint): ToolField[] {
  return TOOL_FIELDS.filter((f) => a.fields[f] !== b.fields[f]);
}

/**
 * `baseline`: the baseline's fingerprints; undefined when the baseline report has none (0.3 or older), null when its
 * tools/list did not finish. Tools are paired by name; two tools with one name pair in their tools/list order, and
 * the extra ones are added or removed.
 */
export function compareTools(baseline: ToolFingerprint[] | null | undefined, snap: Snapshot): Drift {
  const now = toolFingerprints(snap);
  if (baseline === undefined) return { toolChanges: null, notCompared: 'tool fingerprints were not recorded in the baseline (a report of mcp-review-check 0.3 or older); write it again with --save-baseline', tools: 0 };
  if (baseline === null) return { toolChanges: null, notCompared: 'the baseline run did not list every tool, so it recorded no tool fingerprints', tools: 0 };
  if (now === null) return { toolChanges: null, notCompared: `this run did not list every tool: ${incompleteTools(snap)}`, tools: 0 };
  const byName = (list: ToolFingerprint[]) => {
    const m = new Map<string, ToolFingerprint[]>();
    for (const t of list) m.set(t.name, [...(m.get(t.name) ?? []), t]);
    return m;
  };
  const before = byName(baseline);
  const changes: ToolChanges = { added: [], removed: [], changed: [] };
  for (const t of now) {
    const old = before.get(t.name)?.shift();
    if (!old) changes.added.push(t.name);
    else if (old.sha256 !== t.sha256) changes.changed.push({ name: t.name, fields: changedFields(old, t) });
  }
  for (const rest of before.values()) for (const t of rest) changes.removed.push(t.name);
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
