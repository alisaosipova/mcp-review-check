// Text helpers shared by many rules (§1.5).
import type { Snapshot } from '../../snapshot.js';
import { ALL_VERBS, READ_VERBS, WRITE_VERBS } from '../lexicon.js';
import { annotations, isObj, isStr, toolName, type Obj } from './access.js';
import { walkSchema } from './schemaWalk.js';

export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .split(/[_\-.\s/:]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

export function firstVerb(name: string): string | undefined {
  return tokenize(name).find((t) => ALL_VERBS.has(t));
}

export type ToolKind = 'read' | 'write' | 'unknown';

/**
 * The shared read/write classifier: annotations first (readOnlyHint true → read; readOnlyHint false or
 * destructiveHint true → write), then the first verb of the name. Rules use this so they never disagree.
 */
export function toolKind(t: Obj): ToolKind {
  const a = annotations(t);
  if (a.readOnlyHint === true) return 'read';
  if (a.readOnlyHint === false || a.destructiveHint === true) return 'write';
  const v = firstVerb(toolName(t));
  if (v && READ_VERBS.has(v)) return 'read';
  if (v && WRITE_VERBS.has(v)) return 'write';
  return 'unknown';
}

export function nfkc(text: string): string {
  return text.normalize('NFKC');
}

/** Escape invisible / control characters as \u{...} for display. */
export function escapeHidden(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (/[\p{Cf}\p{Cc}]/u.test(ch) && ch !== '\n' && ch !== '\t') out += `\\u{${cp.toString(16).toUpperCase()}}`;
    else out += ch;
  }
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
  | 'instructions' | 'prompt.description' | 'prompt.argument.description' | 'resource.description'
  | 'resourceTemplate.description';

export interface CorpusEntry {
  text: string;
  where: CorpusWhere;
  tool?: string;
  path?: string;
  subject?: string;
}

export function corpus(snap: Snapshot): CorpusEntry[] {
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
      if (v.viaProperty) push(v.node.description, 'param.description', { tool: name, path: v.path });
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

export function locationOf(e: CorpusEntry): string {
  return e.path ? `${e.where} ${e.path}` : e.where;
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
