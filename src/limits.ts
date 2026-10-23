// Input caps (W1-8): several heuristics run regexes whose cost grows with the input, so oversized strings
// are truncated before the rules see them, and every truncation is reported.
import type { Snapshot } from './snapshot.js';
import { isObj, isStr, toolName } from './rules/util/access.js';

/** Tool, prompt and resource metadata strings (descriptions, schema text, instructions). */
export const TEXT_CAP = 16 * 1024;
/** UI resource content (resources/read text or base64 blob, decoded size). */
export const HTML_CAP = 2 * 1024 * 1024;
/** SDK error messages (they can carry a whole HTML error page) before cleanErrorMessage. */
export const ERROR_BODY_CAP = 64 * 1024;

type Truncated = NonNullable<Snapshot['limits']>['truncated'];

/** Truncate every string over `cap` inside `value` (in place); reports `where` once per object with the largest length. */
function capStrings(value: unknown, cap: number, where: string, out: Truncated): unknown {
  let longest = 0;
  const walk = (v: unknown, depth: number): unknown => {
    if (isStr(v)) {
      if (v.length <= cap) return v;
      longest = Math.max(longest, v.length);
      return v.slice(0, cap);
    }
    if (depth > 64 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = walk(v[i], depth + 1);
      return v;
    }
    for (const [k, x] of Object.entries(v)) (v as Record<string, unknown>)[k] = walk(x, depth + 1);
    return v;
  };
  const r = walk(value, 0);
  if (longest) out.push({ where, length: longest, cap });
  return r;
}

/** Apply TEXT_CAP to listed metadata and HTML_CAP to read UI content; returns the truncations (also on snap.limits). */
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
    }
  }
  if (out.length) (snap.limits ??= { truncated: [] }).truncated.push(...out);
  return out;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${n / (1024 * 1024)} MB` : `${Math.round(n / 1024)} KB`);

/** "2 oversized inputs truncated before pattern checks: tool x (81920 chars, cap 16 KB), …" or undefined. */
export function limitsNotice(snap: Snapshot): string | undefined {
  const parts: string[] = [];
  const t = snap.limits?.truncated ?? [];
  if (t.length) {
    const shown = t.slice(0, 3).map((x) => `${x.where} (${x.length} chars, cap ${kb(x.cap)})`).join(', ');
    parts.push(`${t.length} oversized input${t.length === 1 ? '' : 's'} truncated before pattern checks: ${shown}${t.length > 3 ? ', …' : ''}`);
  }
  const s = snap.limits?.stopped;
  if (s) parts.push(`stopped by --max-duration ${s.maxDurationMs} ms during ${s.phase}; later checks did not run`);
  return parts.length ? `${parts.join('. ')}.` : undefined;
}
