// Regression tests for the W6A-cli package (wave 6, 0.4.0): tool-definition drift against --baseline (MARKET §3.3).
// Every JSON report carries `toolFingerprints` (SHA-256 over the canonical JSON of name, title, description,
// inputSchema, outputSchema, annotations, _meta, plus one digest per field); --baseline compares them and reports
// "Changed tool definitions" in every format (SARIF: BASE-001 notes), --fail-on-drift makes a change exit 1, and
// --diff-only keeps text and markdown to the new findings and the drift. A 0.3 baseline without fingerprints still works.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import _Ajv from 'ajv';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaselineError, loadBaseline, readBaseline } from '../src/baseline.js';
import { runCli } from '../src/cli.js';
import { canonicalJson, compareTools, toolFingerprint, type ToolFingerprint } from '../src/report/drift.js';
import { RULES } from '../src/rules/index.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';

const BAD = fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url));
const SECRET = 'sk-live-SYNTHW6ADRIFT0001';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w6a-drift-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const run = (args: string[], env: Record<string, string> = {}) => runCli(args, env, false);
const at = (name: string) => join(dir, name);

/**
 * A raw JSON-RPC stdio server whose tools depend on --variant: "a" (the baseline), "b" (one description changed, one
 * tool removed, one added). Every tool name and description holds the --api-key value, so drift output must redact it.
 */
const SERVER = `
const argv = process.argv.slice(2);
const key = argv[argv.indexOf('--api-key') + 1];
const variant = argv[argv.indexOf('--variant') + 1];
const schema = { type: 'object', properties: { q: { type: 'string' } } };
const tool = (name, description, extra = {}) => ({ name, title: name, description, inputSchema: schema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, ...extra });
const tools = variant === 'a'
  ? [tool('lookup_' + key, 'Looks up a record for ' + key + '.'), tool('stable', 'Never changes.'), tool('old_tool', 'Goes away.')]
  : [tool('lookup_' + key, 'Looks up a record, now with paging, for ' + key + '.'), { ...tool('stable', 'Never changes.'), annotations: { openWorldHint: false, destructiveHint: false, readOnlyHint: true } }, tool('new_' + key, 'Arrived in b.')];
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id === undefined) continue;
    const reply = (x) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...x }) + '\\n');
    if (m.method === 'initialize') reply({ result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'w6a-drift', version: '1.0.0' } } });
    else if (m.method === 'tools/list') reply({ result: { tools } });
    else if (m.method === 'ping') reply({ result: {} });
    else reply({ error: { code: -32601, message: 'Method not found' } });
  }
});
`;

function server(variant: 'a' | 'b'): string[] {
  const file = at('drift-server.mjs');
  writeFileSync(file, SERVER);
  return ['--no-config', '--stdio', '--', process.execPath, file, '--api-key', SECRET, '--variant', variant];
}

const fp = (name: string, over: Partial<Record<string, unknown>> = {}) => toolFingerprint({ name, description: 'd', inputSchema: { type: 'object' }, ...over });
const snapWith = (tools: Record<string, unknown>[], over: Partial<Snapshot> = {}): Snapshot => ({ ...emptySnapshot({ kind: 'stdio', command: 'x', args: [] }, { target: 'all', active: false, activeAuth: false }), tools, era: 'legacy', ...over });

describe('fingerprints: canonical JSON and per-field digests', () => {
  it('canonical JSON sorts keys at every depth, keeps array order and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"x":2,"y":1}]},"b":1}');
    expect(canonicalJson('ü')).toBe('"ü"');
    expect(canonicalJson([1, undefined, [], {}])).toBe('[1,null,[],{}]');
    // No recursion: a schema nested 20000 levels deep (as the leaky fixture's --deep sends) does not overflow the stack.
    let deep: unknown = 'x';
    for (let i = 0; i < 20000; i++) deep = { a: deep };
    expect(canonicalJson(deep)).toHaveLength(20000 * 6 + 3);
  });

  it('key order does not change a fingerprint; any covered field does, fields outside the list do not', () => {
    const a = toolFingerprint({ name: 't', inputSchema: { type: 'object', properties: { a: { type: 'string' } } }, annotations: { readOnlyHint: true, title: 'T' } });
    const b = toolFingerprint({ annotations: { title: 'T', readOnlyHint: true }, inputSchema: { properties: { a: { type: 'string' } }, type: 'object' }, name: 't' });
    expect(b).toEqual(a);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(a.fields)).toEqual(['name', 'inputSchema', 'annotations']);
    expect(toolFingerprint({ name: 't', inputSchema: { type: 'object', properties: { a: { type: 'string' } } }, annotations: { readOnlyHint: true, title: 'T' }, execution: { taskSupport: 'optional' } })).toEqual(a);
    for (const field of ['title', 'description', 'outputSchema', '_meta']) expect(toolFingerprint({ ...{ name: 't' }, [field]: 'x' }).sha256).not.toBe(toolFingerprint({ name: 't' }).sha256);
  });
});

describe('compareTools: added, removed, changed with the changed fields', () => {
  it('pairs tools by name and names the top-level fields that changed (or appeared, or went away)', () => {
    const base: ToolFingerprint[] = [fp('same'), fp('desc'), fp('gone'), fp('meta')];
    const d = compareTools(base, snapWith([
      { name: 'same', description: 'd', inputSchema: { type: 'object' } },
      { name: 'desc', description: 'other', inputSchema: { type: 'object', required: [] } },
      { name: 'meta', description: 'd', inputSchema: { type: 'object' }, _meta: { 'openai/x': 1 } },
      { name: 'fresh' },
    ]));
    expect(d.toolChanges).toEqual({ added: ['fresh'], removed: ['gone'], changed: [{ name: 'desc', fields: ['description', 'inputSchema'] }, { name: 'meta', fields: ['_meta'] }] });
    expect(d.tools).toBe(4);
  });

  it('two tools with one name pair in tools/list order; the extra one is added or removed', () => {
    expect(compareTools([fp('dup'), fp('dup')], snapWith([{ name: 'dup', description: 'd', inputSchema: { type: 'object' } }])).toolChanges).toEqual({ added: [], removed: ['dup'], changed: [] });
    expect(compareTools([fp('dup')], snapWith([{ name: 'dup', description: 'd', inputSchema: { type: 'object' } }, { name: 'dup' }])).toolChanges).toEqual({ added: ['dup'], removed: [], changed: [] });
  });

  it('no comparison without baseline fingerprints, or when either run did not list every tool', () => {
    expect(compareTools(undefined, snapWith([])).notCompared).toMatch(/not recorded in the baseline \(a report of mcp-review-check 0\.3 or older\)/);
    expect(compareTools(null, snapWith([])).notCompared).toMatch(/baseline run did not list every tool/);
    const failed = snapWith([], { coverage: { toolLevel: 'list-failed' }, listMeta: { tools: { pages: 0, rawPages: [], error: 'boom' } } });
    expect(compareTools([fp('a')], failed)).toMatchObject({ toolChanges: null, notCompared: expect.stringMatching(/this run did not list every tool: tools\/list failed/) });
    const stopped = (completed: string[]) => snapWith([{ name: 'a', description: 'd', inputSchema: { type: 'object' } }], { coverage: { toolLevel: 'stopped' }, limits: { truncated: [], stopped: { maxDurationMs: 1, phase: 'wire probes', completed } } });
    expect(compareTools([fp('a')], stopped(['connect', 'listing'])).toolChanges).toEqual({ added: [], removed: [], changed: [] });
    expect(compareTools([fp('a')], stopped(['connect'])).toolChanges).toBeNull();
    expect(compareTools([fp('a')], snapWith([], { coverage: { toolLevel: 'auth-required' } })).notCompared).toMatch(/partial \(auth-required\)/);
  });
});

describe('readBaseline: tool fingerprints of the baseline report', () => {
  const report = { schemaVersion: 1, tool: { name: 'mcp-review-check' }, findings: [] };
  const write = (doc: unknown) => { const p = at('b.json'); writeFileSync(p, JSON.stringify(doc)); return p; };

  it('a 0.3 report has none (undefined), a partial run null; loadBaseline still returns the findings only', () => {
    expect(readBaseline(write(report)).tools).toBeUndefined();
    expect(readBaseline(write({ ...report, toolFingerprints: null })).tools).toBeNull();
    const t = fp('x');
    expect(readBaseline(write({ ...report, toolFingerprints: [t] })).tools).toEqual([t]);
    expect(loadBaseline(write({ ...report, toolFingerprints: [t] }))).toEqual([]);
  });

  it.each([
    ['not an array', { a: 1 }],
    ['an entry without a digest', [{ name: 'x', fields: {} }]],
    ['a short digest', [{ name: 'x', sha256: 'abc', fields: {} }]],
    ['an unknown field', [{ name: 'x', sha256: 'a'.repeat(64), fields: { execution: 'b'.repeat(64) } }]],
  ])('toolFingerprints %s is a BaselineError', (_, value) => {
    expect(() => readBaseline(write({ ...report, toolFingerprints: value }))).toThrow(BaselineError);
  });
});

describe('--baseline end to end: the Changed tool definitions section', () => {
  it('the JSON report always carries fingerprints; a rerun against itself reports no change and exits as before', async () => {
    const base = at('base.json');
    const first = await run(['--fail-on', 'never', '--save-baseline', base, ...server('a')]);
    expect(first.code, first.stderr).toBe(0);
    const saved = JSON.parse(readFileSync(base, 'utf8'));
    expect(saved.toolFingerprints).toHaveLength(3);
    expect(saved.toolFingerprints.every((t: any) => /^[0-9a-f]{64}$/.test(t.sha256))).toBe(true);
    const json = await run(['--format', 'json', '--fail-on-drift', '--baseline', base, ...server('a')]);
    expect(json.code, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout).baseline).toEqual({ toolChanges: { added: [], removed: [], changed: [] } });
    const text = await run(['--fail-on-drift', '--baseline', base, ...server('a')]);
    expect(text.stdout).toMatch(/^Tool definitions: no change since baseline \(3 tools\)\.$/m);
  });

  it('every format reports the changes; drift alone keeps the exit code, --fail-on-drift makes it 1; no secret in any output', async () => {
    const base = at('base.json');
    expect((await run(['--fail-on', 'never', '--save-baseline', base, ...server('a')])).code).toBe(0);
    // --fail-on never: the new tool brings new findings, and only the drift should decide the exit code here.
    const b = ['--fail-on', 'never', '--baseline', base, ...server('b')];
    const [text, md, json, sarif, junit, failing, never] = await Promise.all([
      run(b),
      run(['--format', 'markdown', ...b]),
      run(['--format', 'json', ...b]),
      run(['--format', 'sarif', ...b]),
      run(['--format', 'junit', ...b]),
      run(['--fail-on-drift', '--output', at('r.txt'), ...b]),
      run(['--fail-on-drift', '--format', 'json', ...b]),
    ]);
    const R = '«redacted»';
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain(['CHANGED TOOL DEFINITIONS (3 since baseline)', `  + new_${R}: added`, '  - old_tool: removed', `  ~ lookup_${R}: changed: description`].join('\n'));
    // The key order of the annotations changed, nothing else: the canonical JSON is the same.
    expect(text.stdout).not.toMatch(/~ stable/);
    // After the findings, before the manual checklist line and the Score.
    expect(text.stdout.indexOf('CHANGED TOOL DEFINITIONS')).toBeLessThan(text.stdout.indexOf('manual item'));

    expect(md.code).toBe(0);
    expect(md.stdout).toContain(`## Changed tool definitions (3 since baseline)\n\n| Tool | Change |\n|---|---|\n| new\\_${R} | added |\n| old\\_tool | removed |\n| lookup\\_${R} | changed: description |`);

    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout).baseline.toolChanges).toEqual({ added: [`new_${R}`], removed: ['old_tool'], changed: [{ name: `lookup_${R}`, fields: ['description'] }] });

    expect(sarif.code).toBe(0);
    const runDoc = JSON.parse(sarif.stdout).runs[0];
    const notes = runDoc.results.filter((r: any) => r.ruleId === 'BASE-001');
    expect(notes.map((r: any) => [r.level, r.baselineState, r.properties.change, r.message.text])).toEqual([
      ['note', 'new', 'added', `new_${R}: tool definition added since baseline`],
      ['note', 'new', 'removed', 'old_tool: tool definition removed since baseline'],
      ['note', 'new', 'changed', `lookup_${R}: tool definition changed: description since baseline`],
    ]);
    expect(runDoc.tool.driver.rules.filter((r: any) => r.id === 'BASE-001')).toEqual([expect.objectContaining({ shortDescription: { text: 'Tool definition changed since baseline' } })]);
    expect(new Set(notes.map((r: any) => r.partialFingerprints['mcpReviewCheck/v1'])).size).toBe(3);
    const validate = sarifValidator();
    expect(validate(JSON.parse(sarif.stdout)), JSON.stringify(validate.errors)).toBe(true);
    // BASE-001 is synthetic: not in the catalog, so not in --list-rules, explain or --ignore.
    expect(RULES.some((r) => r.id === 'BASE-001')).toBe(false);
    expect((await run(['--ignore', 'BASE-001', ...b])).code).toBe(2);

    expect(junit.code).toBe(0);
    expect(junit.stdout).toContain(`Changed tool definitions (3 since baseline)\n  + new_${R}: added\n  - old_tool: removed\n  ~ lookup_${R}: changed: description</system-out>`);

    expect(failing.code, failing.stderr).toBe(1);
    expect(failing.stderr).toMatch(/ · 3 tool changes \(--fail-on-drift\) · PASS \(--fail-on never\)/);
    expect(readFileSync(at('r.txt'), 'utf8')).toContain('CHANGED TOOL DEFINITIONS (3 since baseline) · fails the run (--fail-on-drift)');
    expect(never.code).toBe(1); // --fail-on never does not turn --fail-on-drift off
    expect(JSON.parse(never.stdout).summary.failed).toBe(false); // the verdicts and the gate stay about findings

    for (const r of [text, md, json, sarif, junit, failing, never]) expect(r.stdout + r.stderr).not.toContain(SECRET);
    expect(readFileSync(at('r.txt'), 'utf8') + readFileSync(base, 'utf8')).not.toContain(SECRET);
  });

  it('a 0.3 baseline without fingerprints is accepted: the section says so and --fail-on-drift exits 1 with a warning (W6H)', async () => {
    const base = at('base.json');
    await run(['--fail-on', 'never', '--save-baseline', base, ...server('a')]);
    const old = JSON.parse(readFileSync(base, 'utf8'));
    delete old.toolFingerprints;
    delete old.$schema;
    writeFileSync(base, JSON.stringify(old));
    const [text, json] = await Promise.all([
      run(['--fail-on', 'never', '--fail-on-drift', '--baseline', base, ...server('b')]),
      run(['--format', 'json', '--fail-on', 'never', '--baseline', base, ...server('b')]),
    ]);
    expect(text.code, text.stderr).toBe(1);
    expect(text.stderr).toMatch(/--fail-on-drift: tool definitions not compared/);
    expect(text.stdout).toMatch(/^Tool definitions not compared: tool fingerprints were not recorded in the baseline/m);
    expect(JSON.parse(json.stdout).baseline).toEqual({ toolChanges: null, notCompared: expect.stringMatching(/not recorded/) });
  });

  it('--fail-on-drift and --diff-only without --baseline are usage errors (exit 2)', async () => {
    for (const flag of ['--fail-on-drift', '--diff-only']) {
      const r = await run([flag, '--stdio', 'node x.js']);
      expect(r.code, flag).toBe(2);
      expect(r.stderr).toContain(`error: ${flag} needs --baseline <file>`);
    }
  });
});

describe('--diff-only: text and markdown show the new findings and the drift only', () => {
  it('no known-findings line and no manual checklist; JSON, SARIF and JUnit are unchanged', async () => {
    const base = at('base.json');
    const bad = ['--no-config', '--stdio', '--', process.execPath, BAD];
    await run(['--fail-on', 'never', '--save-baseline', base, ...bad]);
    const doc = JSON.parse(readFileSync(base, 'utf8'));
    // Drop one finding with a tool from the baseline, so the rerun has one new finding to show.
    const target = doc.findings.find((f: any) => f.tool && f.severity === 'error');
    const kept = doc.findings.filter((f: any) => f !== target);
    writeFileSync(base, JSON.stringify({ ...doc, findings: kept }));
    const args = ['--baseline', base, ...bad];
    const [text, diffText, md, diffMd, ...machine] = await Promise.all([
      run(args), run(['--diff-only', ...args]),
      run(['--format', 'markdown', ...args]), run(['--format', 'markdown', '--diff-only', ...args]),
      ...['json', 'sarif', 'junit'].flatMap((f) => [run(['--format', f, ...args]), run(['--format', f, '--diff-only', ...args])]),
    ]);
    expect(text.stdout).toMatch(/known finding\(s\) from baseline/);
    expect(text.stdout).toMatch(/manual items?: --checklist to show/);
    expect(diffText.stdout).not.toMatch(/known finding\(s\) from baseline|manual item|MANUAL CHECKLIST/);
    expect(diffText.stdout).toContain(`${target.ruleId} `);
    expect(diffText.stdout).toMatch(/^Tool definitions: no change since baseline/m);
    expect(diffText.code).toBe(text.code);
    expect((await run(['--diff-only', '--checklist', ...args])).stdout).not.toMatch(/MANUAL CHECKLIST/);
    expect(md.stdout).toMatch(/^\| Baseline \| /m);
    expect(md.stdout).toMatch(/^## Manual checklist$/m);
    expect(diffMd.stdout).not.toMatch(/^\| Baseline \| |^## Manual checklist$/m);
    expect(diffMd.stdout).toContain(`| ${target.ruleId} |`);
    const strip = (s: string) => s.replace(/"startedAt": "[^"]*"|"durationMs": \d+|time="[\d.]+"|mcp-review-check\/\.mcp-review-check\/[^"]*"|--diff-only /g, '');
    for (let i = 0; i < machine.length; i += 2) expect(strip(machine[i + 1].stdout)).toBe(strip(machine[i].stdout));
  });
});

/** The SARIF 2.1.0 schema validator, as in sarif.test.ts. */
function sarifValidator(): any {
  const schema = JSON.parse(readFileSync(new URL('./fixtures/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
  delete schema.$schema;
  schema.$id = schema.id;
  delete schema.id;
  const Ajv = ((_Ajv as unknown as { default?: unknown }).default ?? _Ajv) as new (o: object) => any;
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('uri', (x: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]*$/i.test(x) && !/[^\x21-\x7e]/.test(x));
  ajv.addFormat('uri-reference', (x: string) => !/[^\x21-\x7e]/.test(x) && !/[<>"{}|\\^`]/.test(x));
  ajv.addFormat('date-time', (x: string) => !Number.isNaN(Date.parse(x)));
  return ajv.compile(schema);
}
