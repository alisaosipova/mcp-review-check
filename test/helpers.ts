// Snapshot builders for rule unit tests.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import type { Finding, Rule } from '../src/rules/types.js';
import { emptySnapshot, type HttpExchange, type Snapshot } from '../src/snapshot.js';

type Obj = Record<string, unknown>;

/** Load a hand-written JSON snapshot from test/fixtures/snapshots (target.url is rebuilt). */
export function loadSnapshot(name: string): Snapshot {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/snapshots/${name}.json`, import.meta.url), 'utf8'));
  if (raw.target.kind === 'http') raw.target.url = new URL(raw.target.urlAsEntered);
  return raw as Snapshot;
}

export const GOOD_TOOL: Obj = {
  name: 'search_notes',
  title: 'Search notes',
  description: 'Search the user notes in the Acme Notes API by keyword and return matching note ids and titles.',
  inputSchema: {
    type: 'object',
    properties: {
      keywords: { type: 'string', description: 'Words to search for' },
      limit: { type: 'integer', description: 'Maximum number of results' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Fields to include' },
    },
    required: ['keywords'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

export function tool(over: Obj = {}): Obj {
  return { ...structuredClone(GOOD_TOOL), ...over };
}

/** A tool with given input properties (all described unless noted). */
export function toolWithProps(name: string, props: Obj, over: Obj = {}): Obj {
  return tool({ name, inputSchema: { type: 'object', properties: props }, ...over });
}

export interface SnapInput {
  url?: string;
  tools?: Obj[];
  resources?: Obj[];
  prompts?: Obj[];
  target?: 'claude' | 'chatgpt' | 'all';
  active?: boolean;
  activeAuth?: boolean;
  set?: (s: Snapshot) => void;
}

export function snap(p: SnapInput = {}): Snapshot {
  const target: Snapshot['target'] = p.url
    ? { kind: 'http', urlAsEntered: p.url, url: new URL(p.url) }
    : { kind: 'stdio', command: 'node', args: ['server.js'] };
  const s = emptySnapshot(target, { target: p.target ?? 'all', active: !!p.active, activeAuth: !!p.activeAuth });
  s.era = 'legacy';
  s.protocolVersion = '2025-11-25';
  s.localMode = !p.url;
  s.serverInfo = { name: 'acme-notes', title: 'Acme Notes', version: '1.0.0' };
  s.capabilities = { tools: {}, ...(p.resources ? { resources: {} } : {}), ...(p.prompts ? { prompts: {} } : {}) };
  s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: s.capabilities, serverInfo: s.serverInfo };
  s.tools = p.tools ?? [tool()];
  s.listMeta.tools = { pages: 1, rawPages: [{ tools: s.tools }] };
  if (p.resources) { s.resources = p.resources; s.listMeta.resources = { pages: 1, rawPages: [{ resources: p.resources }] }; }
  if (p.prompts) { s.prompts = p.prompts; s.listMeta.prompts = { pages: 1, rawPages: [{ prompts: p.prompts }] }; }
  if (p.url) s.transport.kind = 'streamable-http';
  p.set?.(s);
  return s;
}

export function exchange(over: Partial<HttpExchange> = {}): HttpExchange {
  return { label: 'probe', method: 'POST', url: 'https://mcp.acme.test/mcp', requestHeaders: {}, durationMs: 10, ...over };
}

/** Run one rule through the engine (needs, platform filtering and severity apply). */
export function evaluate(rule: Rule, s: Snapshot, allowSkip = false): Finding[] {
  const r = runRules(s, [rule]);
  const skipped = r.skipped.find((x) => x.ruleId === rule.id);
  if (skipped && !allowSkip) throw new Error(`${rule.id} skipped: ${skipped.reason}`);
  return r.findings.filter((f) => f.ruleId === rule.id);
}

export interface Case {
  pos: Snapshot | (() => Snapshot);
  neg: Snapshot | (() => Snapshot);
  /** Optional expectations on the first positive finding. */
  severity?: Finding['severity'];
  match?: RegExp;
}

const get = (x: Snapshot | (() => Snapshot)) => (typeof x === 'function' ? x() : x);

export function checkCase(rule: Rule, c: Case): void {
  const pos = evaluate(rule, get(c.pos));
  expect(pos.length, `${rule.id} positive case should produce findings`).toBeGreaterThan(0);
  if (c.severity) expect(pos.map((f) => f.severity), `${rule.id} severity`).toContain(c.severity);
  if (c.match) expect(pos.map((f) => f.message).join('\n'), `${rule.id} message`).toMatch(c.match);
  const neg = evaluate(rule, get(c.neg), true); // a skipped rule (need not met) is a valid negative
  expect(neg.map((f) => f.message), `${rule.id} negative case should be clean`).toEqual([]);
}
