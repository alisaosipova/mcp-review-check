// Hostile-shape fuzz over the whole rule catalog (1.2.0, review round 4 I-A13-1, A13-01; spec §1.5, §4.2): every
// server-controlled field is set in turn to null, a number, an array, {}, an object whose toString is not a function,
// and a parsed `__proto__` object. No rule may throw (no INTERNAL finding, no internalErrors), and the connect-side
// name helpers stay total.
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { safeStr, SAFE_STR_MAX, toolName, toolNames } from '../src/rules/util/access.js';
import type { Snapshot } from '../src/snapshot.js';
import { snap, tool } from './helpers.js';

type Obj = Record<string, unknown>;

const HOSTILE: Array<[string, () => unknown]> = [
  ['null', () => null],
  ['number', () => 42],
  ['boolean', () => true],
  ['array', () => ['a', 1, null]],
  ['empty object', () => ({})],
  ['toString object', () => ({ toString: 'x' })],
  ['toString+valueOf object', () => ({ toString: 'x', valueOf: 'y' })],
  ['__proto__ object', () => JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":1}}')],
  ['__proto__ string', () => '__proto__'],
  ['constructor string', () => 'constructor'],
];

const UI = 'ui://widget/main.html';
const MIME = 'text/html;profile=mcp-app';

/** A snapshot on which nearly every rule runs: HTTP, tools (one with a UI), a UI resource that was read, a prompt. */
function base(): Snapshot {
  return snap({
    url: 'https://mcp.acme.test/mcp',
    tools: [
      tool(),
      tool({ name: 'show_widget', _meta: { ui: { resourceUri: UI }, 'openai/outputTemplate': UI }, outputSchema: { type: 'object', properties: { id: { type: 'string' } } } }),
    ],
    resources: [{ uri: UI, name: 'widget', mimeType: MIME, _meta: { ui: { csp: { connectDomains: ['https://api.acme.test'] } } } }],
    prompts: [{ name: 'summarize', description: 'Summarize a note', arguments: [{ name: 'id', required: true }] }],
    set: (s) => {
      s.instructions = 'Use search_notes to find notes.';
      s.capabilities = { tools: { listChanged: true }, resources: {}, prompts: {}, logging: {}, extensions: { 'io.modelcontextprotocol/ui': {} } };
      s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: s.capabilities, serverInfo: s.serverInfo, instructions: s.instructions };
      s.resourceReads[UI] = { ok: true, durationMs: 5, raw: { contents: [{ uri: UI, mimeType: MIME, text: '<!doctype html><html><body>w</body></html>', _meta: { ui: { csp: {} } } }] } };
    },
  });
}

/** Where the server's own values sit in the snapshot (each set to every hostile shape in turn). */
const PATHS: Array<Array<string | number>> = [
  ...['name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations', '_meta', 'icons', 'execution'].map((k) => ['tools', 0, k]),
  ['tools', 0, 'inputSchema', 'properties'], ['tools', 0, 'inputSchema', 'required'], ['tools', 0, 'inputSchema', 'type'],
  ['tools', 0, 'inputSchema', '$defs'], ['tools', 0, 'inputSchema', 'properties', 'keywords'],
  ['tools', 0, 'inputSchema', 'properties', 'keywords', 'description'], ['tools', 0, 'inputSchema', 'properties', 'keywords', 'type'],
  ['tools', 0, 'inputSchema', 'properties', 'fields', 'items'], ['tools', 0, 'inputSchema', 'properties', 'limit', 'enum'],
  ['tools', 0, 'annotations', 'readOnlyHint'], ['tools', 0, 'annotations', 'title'], ['tools', 0, 'annotations', 'destructiveHint'],
  ['tools', 1, 'name'], ['tools', 1, '_meta', 'ui'], ['tools', 1, '_meta', 'ui', 'resourceUri'], ['tools', 1, '_meta', 'openai/outputTemplate'],
  ['tools', 1, 'outputSchema', 'properties'],
  ...['uri', 'name', 'title', 'description', 'mimeType', '_meta', 'icons', 'annotations'].map((k) => ['resources', 0, k]),
  ['resources', 0, '_meta', 'ui'], ['resources', 0, '_meta', 'ui', 'csp'], ['resources', 0, '_meta', 'ui', 'csp', 'connectDomains'],
  ...['name', 'title', 'description', 'arguments', '_meta', 'icons'].map((k) => ['prompts', 0, k]),
  ['prompts', 0, 'arguments', 0], ['prompts', 0, 'arguments', 0, 'name'],
  ['serverInfo'], ...['name', 'title', 'version', 'description', 'icons', 'websiteUrl'].map((k) => ['serverInfo', k]),
  ['capabilities'], ...['tools', 'resources', 'prompts', 'logging', 'extensions', 'experimental', 'completions'].map((k) => ['capabilities', k]),
  ['capabilities', 'extensions', 'io.modelcontextprotocol/ui'],
  ['instructions'], ['initializeRaw'], ['initializeRaw', '_meta'], ['initializeRaw', 'protocolVersion'],
  ['resourceReads', UI, 'raw'], ['resourceReads', UI, 'raw', 'contents'], ['resourceReads', UI, 'raw', 'contents', 0, 'text'],
  ['resourceReads', UI, 'raw', 'contents', 0, 'mimeType'], ['resourceReads', UI, 'raw', 'contents', 0, '_meta'],
];

function setPath(root: Snapshot, path: Array<string | number>, value: unknown): void {
  let o = root as unknown as Obj;
  for (const k of path.slice(0, -1)) o = o[k] as Obj;
  // defineProperty, so a "__proto__" key is an own data property as JSON.parse makes it, not a prototype change.
  Object.defineProperty(o, path[path.length - 1], { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Rules whose body still throws on a hostile shape: handed off to the package that owns the rule file. Empty means
 * none; an entry that no longer throws fails the test (stale list).
 */
// Empty: P4 replaced String(r.uri) / String(p.name) in src/rules/spec.ts (SPEC-017, SPEC-018) with safeStr.
const KNOWN_THROWERS: Record<string, string> = {};

describe('hostile-shape fuzz over the catalog (I-A13-1)', () => {
  it('no rule throws on any hostile value of any server field', () => {
    const clean = runRules(base(), RULES); // the base runs most of the catalog and nothing throws on it
    expect(clean.internalErrors).toBeUndefined();
    expect(clean.rulesRun).toBeGreaterThan(80);
    const thrown = new Map<string, string>();
    let cases = 0;
    for (const path of PATHS) {
      for (const [label, make] of HOSTILE) {
        const s = base();
        setPath(s, path, make());
        const r = runRules(s, RULES);
        cases++;
        for (const f of r.findings.filter((x) => x.ruleId === 'INTERNAL')) {
          const id = f.message.split(' ')[0];
          if (!thrown.has(id)) thrown.set(id, `${path.join('.')} = ${label}: ${f.message}`);
        }
      }
    }
    expect(cases).toBeGreaterThan(500);
    const unexpected = [...thrown].filter(([id]) => !KNOWN_THROWERS[id]).map(([, v]) => v);
    expect(unexpected).toEqual([]);
    expect(Object.keys(KNOWN_THROWERS).filter((id) => !thrown.has(id))).toEqual([]);
  });

  it('toolName and toolNames are total (connect.ts maps the re-list with them, A13-01)', () => {
    for (const [label, make] of HOSTILE) {
      const t = { name: make() } as Obj;
      expect(() => toolName(t), label).not.toThrow();
      expect(typeof toolName(t), label).toBe('string');
    }
    expect(toolName({ name: { toString: 'x' } })).toBe('{"toString":"x"}');
    expect(toolNames(base())).toEqual(['search_notes', 'show_widget']);
  });
});

describe('safeStr (A13-01)', () => {
  it('returns a string as is and never throws', () => {
    expect(safeStr('a b')).toBe('a b');
    expect(safeStr(undefined)).toBe('undefined');
    expect(safeStr(null)).toBe('null');
    expect(safeStr(7)).toBe('7');
    expect(safeStr(10n)).toBe('10');
    expect(safeStr({ toString: 'x' })).toBe('{"toString":"x"}');
    const cyclic: Obj = {}; cyclic.self = cyclic;
    expect(safeStr(cyclic)).toBe('[object Object]');
    const hostile = { toString: 'x', toJSON() { throw new Error('no'); } };
    expect(safeStr(hostile)).toBe('[object Object]');
  });

  it('caps the length of a non-string value', () => {
    const long = safeStr({ a: 'x'.repeat(5000) });
    expect(long.length).toBe(SAFE_STR_MAX + 3);
    expect(long.endsWith('...')).toBe(true);
    expect(safeStr('y'.repeat(5000))).toHaveLength(5000); // a string is the server's own text: rules cut it themselves
  });
});
