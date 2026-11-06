// Input caps: several heuristics run regexes whose cost grows with the input, so oversized strings
// are truncated before the rules see them, and every truncation is reported.
import type { Snapshot } from './snapshot.js';
import { isObj, isStr, toolName } from './rules/util/access.js';

/** Tool, prompt and resource metadata strings (descriptions, schema text, instructions). */
export const TEXT_CAP = 16 * 1024;
/** Identifiers and structural schema strings (names, URIs, patterns, property names): the rules compare, count and
 *  compile them, so a cut at TEXT_CAP would make false duplicates, wrong lengths and broken regexes; this bound only
 *  keeps memory and the rules' run time finite. */
export const ID_CAP = 1024 * 1024;
/** UI resource content (resources/read text or base64 blob, decoded size). */
export const HTML_CAP = 2 * 1024 * 1024;
/** SDK error messages (they can carry a whole HTML error page) before cleanErrorMessage. */
export const ERROR_BODY_CAP = 64 * 1024;
/** TOOL-034, linter-defined: more tools than this in tools/list is reported as a context budget concern. */
export const TOOL_LIST_MAX_COUNT = 40;
/** TOOL-034, linter-defined: JSON.stringify(tools).length (UTF-16 code units, about bytes for ASCII) above this is reported. */
export const TOOL_LIST_MAX_BYTES = 64 * 1024;
/** A JSON pointer longer than this is shown in a finding message as its first and last POINTER_SHOWN characters (A09-08). */
export const POINTER_MESSAGE_MAX = 1024;
export const POINTER_SHOWN = 60;
/** A finding message that lists pointers is cut to this many characters (A09-08). */
export const MESSAGE_CAP = 2 * 1024;
/** The finding `path` field is cut to this many characters, keeping its start and end (A09-08). */
export const PATH_CAP = 4 * 1024;
/** UI resources read per run (resources/read for every ui:// URI the tools and resources list). */
export const UI_READS_CAP = 50;

/** Bytes of server data one run may read and keep, over every response and connection (F146): HTTP bodies, the SDK's
 *  HTTP responses and its stdio messages. Past it the read that crossed it stops, nothing more is read, and the rules
 *  run on what the snapshot has (limits.budgetExhausted). */
export const SNAPSHOT_BUDGET = 64 * 1024 * 1024;

/** The run's byte budget: every reader charges what it keeps; `exhausted` is set once, by the read that crossed it. */
export interface ByteBudget {
  readonly bytes: number;
  used: number;
  /** Set by the first charge past the budget: how many bytes of that read were over it. */
  exhausted?: { overBytes: number };
  /** Called once, when the budget runs out (connect.ts stops the run there). */
  onExhausted?: () => void;
}

export function createBudget(bytes = SNAPSHOT_BUDGET): ByteBudget {
  return { bytes, used: 0 };
}

/** Bytes left in `b` (Infinity without a budget). */
export function budgetLeft(b: ByteBudget | undefined): number {
  return b ? Math.max(0, b.bytes - b.used) : Infinity;
}

/**
 * Charge `n` bytes to `b`: true while they fit. The charge that does not fit takes the rest of the budget, records the
 * bytes over it and calls onExhausted once; every later charge fails. Without a budget everything fits.
 */
export function charge(b: ByteBudget | undefined, n: number): boolean {
  if (!b) return true;
  if (b.exhausted) return n <= 0;
  if (b.used + n <= b.bytes) { b.used += n; return true; }
  b.exhausted = { overBytes: Math.max(1, b.used + n - b.bytes) };
  b.used = b.bytes;
  b.onExhausted?.();
  return false;
}

/** Keys whose string values identify something or are schema syntax rather than prose. */
const ID_KEYS = new Set([
  'name', 'uri', 'uriTemplate', 'resourceUri', 'ui/resourceUri', 'outputTemplate', 'openai/outputTemplate',
  'pattern', '$ref', '$id', '$schema', '$anchor', '$dynamicRef', '$dynamicAnchor', 'format',
]);

type Truncated = NonNullable<Snapshot['limits']>['truncated'];

/** `key` cut to ID_CAP, made unique among `taken` (a cut can make two keys equal). */
function cutKey(key: string, taken: Set<string>): string {
  const base = key.slice(0, ID_CAP);
  let k = base;
  for (let i = 2; taken.has(k); i++) k = `${base}~${i}`;
  return k;
}

/** Truncate every string over `cap` inside `value` (in place); identifiers (ID_KEYS values, object keys) at ID_CAP;
 * reports `where` once per object with the largest length.
 * Iterative and without a depth limit: the schema walkers go deeper than any fixed JSON depth. */
export function capStrings(value: object, cap: number, where: string, out: Truncated): void {
  let longest = 0;
  let unit = cap;
  const stack: object[] = [value];
  const seen = new Set<object>();
  for (let o = stack.pop(); o; o = stack.pop()) {
    if (seen.has(o)) continue;
    seen.add(o);
    const rec = o as Record<string, unknown>;
    let keys = Object.keys(rec);
    if (!Array.isArray(o) && keys.some((k) => k.length > ID_CAP)) {
      // Rebuilt in order: a long property name (or patternProperties regex) is cut like any identifier.
      const entries = keys.map((k) => [k, rec[k]] as const);
      for (const k of keys) delete rec[k];
      const taken = new Set<string>();
      for (const [k, v] of entries) {
        let nk = k;
        if (k.length > ID_CAP) { if (k.length > longest) { longest = k.length; unit = ID_CAP; } nk = cutKey(k, taken); }
        taken.add(nk);
        rec[nk] = v;
      }
      keys = Object.keys(rec);
    }
    for (const k of keys) {
      const v = rec[k];
      const limit = ID_KEYS.has(k) && !Array.isArray(o) ? ID_CAP : cap;
      if (isStr(v) && v.length > limit) {
        if (v.length > longest) { longest = v.length; unit = limit; }
        rec[k] = v.slice(0, limit);
      } else if (v !== null && typeof v === 'object') stack.push(v);
    }
  }
  if (longest) out.push({ where, length: longest, cap: unit });
}

/** Apply TEXT_CAP to listed metadata (and the raw pages, the text-only list and tool call results the rules also
 *  read) and HTML_CAP to read UI content; returns the truncations (also on snap.limits). */
export function capSnapshot(snap: Snapshot): Truncated {
  const out: Truncated = [];
  for (const t of snap.tools) capStrings(t, TEXT_CAP, `tool ${toolName(t).slice(0, 80)}`, out);
  for (const p of snap.prompts) capStrings(p, TEXT_CAP, `prompt ${String(p.name ?? '?').slice(0, 80)}`, out);
  for (const r of snap.resources) capStrings(r, TEXT_CAP, `resource ${String(r.uri ?? '?').slice(0, 80)}`, out);
  for (const r of snap.resourceTemplates) capStrings(r, TEXT_CAP, `resource template ${String(r.uriTemplate ?? '?').slice(0, 80)}`, out);
  if (snap.serverInfo) capStrings(snap.serverInfo, TEXT_CAP, 'serverInfo', out);
  if (isStr(snap.instructions) && snap.instructions.length > TEXT_CAP) {
    out.push({ where: 'instructions', length: snap.instructions.length, cap: TEXT_CAP });
    snap.instructions = snap.instructions.slice(0, TEXT_CAP);
  }
  // The same items as listed above, in the raw pages (a separate copy after redaction): SPEC-018 scans them.
  for (const [key, meta] of Object.entries(snap.listMeta)) capStrings(meta.rawPages, TEXT_CAP, `${key} list pages`, out);
  if (snap.toolsWithoutUi) capStrings(snap.toolsWithoutUi, TEXT_CAP, 'text-only tools/list', out);
  for (const c of snap.active?.calls ?? []) {
    if (c.result !== null && typeof c.result === 'object') capStrings(c.result, TEXT_CAP, `tools/call ${c.tool.slice(0, 80)} result`, out);
    else if (isStr(c.result) && c.result.length > TEXT_CAP) { out.push({ where: `tools/call ${c.tool.slice(0, 80)} result`, length: c.result.length, cap: TEXT_CAP }); c.result = c.result.slice(0, TEXT_CAP); }
    // The arguments sent (synthesized from the schema or given with --tool-args) and what came back instead of a
    // result: RT-001 scans the error text with regexes, RT-005 quotes the transport error in its message.
    c.args = capValue(c.args, TEXT_CAP, `tools/call ${c.tool.slice(0, 80)} args`, out);
    if (c.jsonRpcError !== undefined) c.jsonRpcError = capValue(c.jsonRpcError, TEXT_CAP, `tools/call ${c.tool.slice(0, 80)} JSON-RPC error`, out);
    if (c.transportError !== undefined) c.transportError = capValue(c.transportError, TEXT_CAP, `tools/call ${c.tool.slice(0, 80)} transport error`, out);
  }
  // Every field of each entry (message, and a code or id of the wrong type, which SPEC-016 quotes); one record for all.
  if (snap.transport.observedErrors) capStrings(snap.transport.observedErrors, TEXT_CAP, 'observed JSON-RPC errors', out);
  if (snap.transport.modernResults) capStrings(snap.transport.modernResults, TEXT_CAP, '2026-07-28 results', out);
  // A UI URI over ID_CAP is cut in the tool that links it: the read is filed under the same cut URI.
  for (const uri of Object.keys(snap.resourceReads)) {
    if (uri.length <= ID_CAP) continue;
    const read = snap.resourceReads[uri];
    delete snap.resourceReads[uri];
    snap.resourceReads[uri.slice(0, ID_CAP)] ??= read;
  }
  for (const [uri, read] of Object.entries(snap.resourceReads)) {
    const contents = isObj(read.raw) && Array.isArray(read.raw.contents) ? read.raw.contents : [];
    for (const c of contents) {
      if (!isObj(c)) continue;
      if (isStr(c.text) && c.text.length > HTML_CAP) {
        out.push({ where: `UI resource ${uri.slice(0, 80)}`, length: c.text.length, cap: HTML_CAP });
        c.text = c.text.slice(0, HTML_CAP);
      }
      const blobCap = Math.ceil(HTML_CAP / 3) * 4;
      if (isStr(c.blob) && c.blob.length > blobCap) {
        out.push({ where: `UI resource ${uri.slice(0, 80)} (blob)`, length: Math.floor((c.blob.length * 3) / 4), cap: HTML_CAP });
        c.blob = c.blob.slice(0, blobCap);
      }
      // Every other field of the item (A09-03): uri at ID_CAP, mimeType and _meta at TEXT_CAP, like listed metadata.
      const { text, blob, ...rest } = c;
      const before = Object.keys(rest);
      capStrings(rest, TEXT_CAP, `UI resource ${uri.slice(0, 80)} item`, out);
      if (Object.keys(rest).some((k, i) => k !== before[i])) for (const k of before) delete c[k];
      Object.assign(c, rest);
    }
  }
  if (out.length) (snap.limits ??= { truncated: [] }).truncated.push(...out);
  return out;
}

/** `value` with every string over `cap` cut: a string itself, or each string inside an object or array (in place, the
 *  structure kept); records `where` in `out` as capStrings does. Other values come back unchanged. */
export function capValue<T>(value: T, cap: number, where: string, out: Truncated): T {
  if (isStr(value)) {
    if (value.length <= cap) return value;
    out.push({ where, length: value.length, cap });
    return value.slice(0, cap) as T;
  }
  if (value !== null && typeof value === 'object') capStrings(value, cap, where, out);
  return value;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${n / (1024 * 1024)} MB` : `${Math.round(n / 1024)} KB`);

/** "2 oversized inputs truncated before pattern checks: tool x (81920 chars, cap 16 KB), …" or undefined. */
export function limitsNotice(snap: Snapshot): string | undefined {
  const parts: string[] = [];
  const t = snap.limits?.truncated ?? [];
  if (t.length) {
    const size = (x: (typeof t)[number]) => (x.unit === 'items' ? `${x.length} items, cap ${x.cap}`
      : x.unit === 'bytes' ? `${x.length} bytes, cap ${x.cap >= 1024 ? kb(x.cap) : `${x.cap} bytes`}` : `${x.length} chars, cap ${kb(x.cap)}`);
    const shown = t.slice(0, 3).map((x) => `${x.where} (${size(x)})`).join(', ');
    parts.push(`${t.length} oversized input${t.length === 1 ? '' : 's'} truncated before pattern checks: ${shown}${t.length > 3 ? ', …' : ''}`);
  }
  const s = snap.limits?.stopped;
  if (s) parts.push(`stopped by --max-duration ${s.maxDurationMs} ms during ${s.phase}; later checks did not run`);
  const b = snap.limits?.budgetExhausted;
  if (b) parts.push(`snapshot budget of ${kb(b.bytes)} exhausted during ${b.phase} (${b.overBytes} bytes over); later reads were skipped`);
  return parts.length ? `${parts.join('. ')}.` : undefined;
}
