// Small typed accessors over raw (unvalidated) server payloads.
import type { Snapshot } from '../../snapshot.js';

export type Obj = Record<string, unknown>;

export const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
export const isStr = (x: unknown): x is string => typeof x === 'string';
export const isNonEmptyStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
export const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);

/** The longest text safeStr returns for a value that is not a string. */
export const SAFE_STR_MAX = 200;

/**
 * Any server value as text, without throwing (A13-01): a string as is, anything else as JSON or String(), cut to
 * SAFE_STR_MAX characters. String() alone throws for an object such as {"toString":"x"}, and JSON.stringify throws for a
 * BigInt or a cycle; both fall back to the Object.prototype.toString tag.
 */
export function safeStr(x: unknown): string {
  if (typeof x === 'string') return x;
  let s: string;
  try {
    s = JSON.stringify(x) ?? String(x);
  } catch {
    try { s = String(x); } catch { s = Object.prototype.toString.call(x); }
  }
  return s.length > SAFE_STR_MAX ? `${s.slice(0, SAFE_STR_MAX)}...` : s;
}

export function toolName(t: Obj): string {
  return safeStr(t.name);
}

export function annotations(t: Obj): Obj {
  return isObj(t.annotations) ? t.annotations : {};
}

export function metaOf(x: unknown): Obj {
  return isObj(x) && isObj(x._meta) ? x._meta : {};
}

export function uiMeta(x: unknown): Obj {
  const m = metaOf(x);
  return isObj(m.ui) ? m.ui : {};
}

/** UI link of a tool (§2.7): ui.resourceUri, then flat ui/resourceUri, then openai/outputTemplate. */
export function uiUriOf(tool: Obj): unknown {
  const m = metaOf(tool);
  return uiMeta(tool).resourceUri ?? m['ui/resourceUri'] ?? m['openai/outputTemplate'];
}

export function uiTools(snap: Snapshot): Obj[] {
  return snap.tools.filter((t) => uiUriOf(t) !== undefined);
}

export function hasUi(snap: Snapshot): boolean {
  return uiTools(snap).length > 0 || snap.resources.some((r) => isStr(r.uri) && r.uri.startsWith('ui://'));
}

export function toolNames(snap: Snapshot): string[] {
  return snap.tools.map(toolName);
}

export function hostOf(snap: Snapshot): string | undefined {
  return snap.target.kind === 'http' ? snap.target.url.hostname.toLowerCase() : undefined;
}

export function properties(schema: unknown): Obj {
  return isObj(schema) && isObj(schema.properties) ? schema.properties : {};
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function listPreview(items: string[], max = 3): string {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')}, +${items.length - max} more`;
}
