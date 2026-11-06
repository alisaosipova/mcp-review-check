// Review round 4, package P7 (1.2.0; spec s5.1-s5.3): --fail-on-drift reads FAIL in every format (A01-01), JSON and
// SARIF escape C1 and format characters (A07-03), SARIF message text escapes link syntax (A07-07), an unchecked
// listing platform is INCOMPLETE (A10-02), FIX SNIPPETS and markdown collapse repeats (A10-05), a baselined run labels
// its score and verdicts (C-06), counts are pluralised (I-A07-4), markdown verdict rows carry counts (I-A07-5), a
// listing-only header names the plugin (I-A10-5), a rule that threw makes the report partial (A13-02), and JUnit
// skips a `transport` rule on a failed connect from its need.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderSarifWithBaseline } from '../src/baseline.js';
import { runCli } from '../src/cli.js';
import { compareTools, toolFingerprints } from '../src/report/drift.js';
import { annotations } from '../src/report/github.js';
import { applyDrift, buildReport, stringifyReport, type Report } from '../src/report/index.js';
import { renderJunit } from '../src/report/junit.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { sarifText, toSarif } from '../src/report/sarif.js';
import { FIX_SNIPPETS, renderText } from '../src/report/text.js';
import { runRules } from '../src/rules/engine.js';
import { defineRule, type Finding, type RuleMeta } from '../src/rules/types.js';
import { emptySnapshot } from '../src/snapshot.js';
import { snap } from './helpers.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const fixture = (name: string) => join(REPO, 'test', 'fixtures', name);
const GOOD = ['--stdio', '--', process.execPath, fixture('good-server.mjs')];

let dir = '';
beforeEach(() => {
  // Scratch under the repo's ignored .captures/, not the system temp folder.
  mkdirSync(join(REPO, '.captures'), { recursive: true });
  dir = mkdtempSync(join(REPO, '.captures', 'r111-p7-'));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const run = (args: string[], env: Record<string, string> = {}) => runCli(['--no-config', ...args], env, false);
const at = (name: string) => join(dir, name);
const T0 = new Date('2026-11-05T00:00:00Z');

const finding = (over: Partial<Finding> = {}): Finding => ({
  ruleId: 'TOOL-006', title: 'Tool title', severity: 'error', platforms: ['claude'], message: 'no title', tool: 'search_notes', fix: 'Add a title.', docs: ['https://claude.com/docs'], ...over,
});
const result = (findings: Finding[], over: Record<string, unknown> = {}) => ({ findings, ignored: [], skipped: [], rulesRun: 10, ...over });

/** A baseline from good-server with the first tool's description digest changed: one "changed" drift. */
async function driftBaseline(): Promise<string> {
  const base = at('base.json');
  const saved = await run(['--save-baseline', base, ...GOOD]);
  expect(saved.code, saved.stderr).toBe(0);
  const doc = JSON.parse(readFileSync(base, 'utf8'));
  doc.toolFingerprints[0].sha256 = '0'.repeat(64);
  doc.toolFingerprints[0].fields.description = '0'.repeat(64);
  writeFileSync(base, JSON.stringify(doc));
  return base;
}

describe('A01-01: a --fail-on-drift failure reads FAIL in every format, with the same exit code', () => {
  it('text, JSON, markdown, JUnit and the GitHub annotations', async () => {
    const base = await driftBaseline();
    const b = ['--baseline', base, '--fail-on-drift', ...GOOD];
    const [text, json, md, junit, gh] = await Promise.all([
      run(b), run(['--format', 'json', ...b]), run(['--format', 'markdown', ...b]), run(['--format', 'junit', ...b]),
      run(['--format', 'sarif', ...b], { GITHUB_ACTIONS: 'true' }),
    ]);
    for (const r of [text, json, md, junit, gh]) expect(r.code, r.stderr).toBe(1);
    expect(text.stdout).toMatch(/Result: FAIL \(--fail-on-drift\) \u00B7 tool definitions changed since baseline\n/);
    const doc = JSON.parse(json.stdout);
    expect(doc.summary.failed).toBe(true);
    expect(doc.summary.gate.reason).toBe('tool definitions changed since baseline (--fail-on-drift)');
    expect(md.stdout).toContain('| Result | FAIL (--fail-on-drift) \u00B7 tool definitions changed since baseline |');
    // One failed test case per suite (claude, chatgpt), naming the change.
    expect(junit.stdout.match(/<failure message="tool definitions changed since baseline \(--fail-on-drift\)" type="drift">~ search_notes: changed: description<\/failure>/g)).toHaveLength(2);
    expect(junit.stdout).toMatch(/<testsuites [^>]*failures="2"/);
    expect(gh.stderr).toContain('::error title=mcp-review-check::Tool definitions changed since baseline (--fail-on-drift): search_notes\n');
  });

  it('a comparison that could not be made says "not compared"; without --fail-on-drift nothing changes', async () => {
    const base = at('old.json');
    await run(['--save-baseline', base, ...GOOD]);
    const old = JSON.parse(readFileSync(base, 'utf8'));
    delete old.toolFingerprints; // a 0.3 baseline
    writeFileSync(base, JSON.stringify(old));
    const failing = await run(['--format', 'json', '--baseline', base, '--fail-on-drift', ...GOOD]);
    expect(failing.code).toBe(1);
    expect(JSON.parse(failing.stdout).summary).toMatchObject({ failed: true, gate: { reason: 'tool definitions not compared (--fail-on-drift)' } });
    const plain = await run(['--format', 'json', '--baseline', await driftBaseline(), ...GOOD]);
    expect(plain.code).toBe(0);
    expect(JSON.parse(plain.stdout).summary).toMatchObject({ failed: false, gate: { reason: null } });
  });

  it('applyDrift leaves a failed connect and a stop alone, and keeps a findings reason first', () => {
    const fatal = snap();
    fatal.fatal = 'spawn ENOENT';
    const r1 = buildReport(fatal, result([]), [], 'error', T0, 1, false, false, { drift: { failOn: true, changes: 0, notCompared: 'the run did not connect' } });
    expect(r1.driftFails).toBeUndefined();
    const r2 = buildReport(snap(), result([finding()]), [], 'error', T0, 1, false, false, { drift: { failOn: true, changes: 2, tools: ['a', 'b'] } });
    expect(r2.summary.gate.reason).toBe('claude: 1 error (TOOL-006); tool definitions changed since baseline (--fail-on-drift)');
    expect(renderText(r2, { color: false, verbose: false })).toContain('Result: FAIL (--fail-on error) \u00B7 claude: 1 error (TOOL-006); tool definitions changed since baseline (--fail-on-drift)');
    const r3 = applyDrift(buildReport(snap(), result([]), [], 'error', T0, 1), { failOn: false, changes: 3 });
    expect(r3.summary.failed).toBe(false);
  });
});

describe('review fix: a baseline entry with a forged whole digest', () => {
  it('equal field digests are no change, so changed.fields is never empty', () => {
    const s = snap();
    const fp = toolFingerprints(s)![0];
    const forged = [{ ...fp, sha256: '0'.repeat(64) }];
    const d = compareTools(forged, s);
    expect(d.toolChanges).toEqual({ added: [], removed: [], changed: [] });
    // A real field change is still reported with its field.
    const changed = compareTools([{ ...fp, sha256: '0'.repeat(64), fields: { ...fp.fields, description: '0'.repeat(64) } }], s);
    expect(changed.toolChanges!.changed).toEqual([{ name: fp.name, fields: ['description'] }]);
  });
});

describe('A07-03: JSON and SARIF carry no raw C1, bidi or line-separator characters', () => {
  it('stringifyReport escapes them as \\uXXXX, the same value to a parser', () => {
    const value = 'a\u009B31m\u0085b\u202Ec\u2066d\u2028e\u007Ff\u{E0041}g';
    const out = stringifyReport({ value }, 'json', 0);
    expect(out).not.toMatch(/[\u007F-\u009F\u202E\u2066\u2028\u{E0041}]/u);
    expect(out).toContain('\\u009B');
    expect(JSON.parse(out).value).toBe(value);
    // Plain text, including an emoji and a tab, is unchanged.
    expect(stringifyReport({ v: 'ok \u00e9 \u{1F600}' }, 'json', 0)).toBe('{\n  "v": "ok \u00e9 \u{1F600}"\n}\n');
  });

  it('a server with C1 and bidi controls in its name and tools: no raw ones on stdout', async () => {
    const args = ['--stdio', '--', process.execPath, fixture('r111-p7-evil-server.mjs')];
    for (const format of ['json', 'sarif']) {
      const r = await run(['--format', format, ...args]);
      expect(r.stdout).not.toMatch(/[\u0080-\u009F\u202E\u2066\u2069]/);
      expect(r.stdout).toContain('\\u009B');
      if (format === 'json') expect(JSON.parse(r.stdout).server.serverInfo.name).toBe('srv\u009B31mRED\u0085x');
    }
  });
});

describe('A07-07: SARIF message text cannot form an embedded link', () => {
  it('sarifText escapes backslash and brackets', () => {
    expect(sarifText('see_[docs](https://evil.test/login) a\\b')).toBe('see_\\[docs\\](https://evil.test/login) a\\\\b');
    expect(sarifText('plain text')).toBe('plain text');
  });

  it('results and BASE-001 drift results; logicalLocations keep the raw name', async () => {
    const r = await run(['--format', 'sarif', '--stdio', '--', process.execPath, fixture('r111-p7-evil-server.mjs')]);
    const results = JSON.parse(r.stdout).runs[0].results as Array<{ message: { text: string }; locations: Array<{ logicalLocations?: Array<{ name: string }> }> }>;
    const linked = results.filter((x) => x.message.text.startsWith('see_'));
    expect(linked.length).toBeGreaterThan(0);
    for (const x of linked) expect(x.message.text).not.toMatch(/(?<!\\)\[[^\]]*(?<!\\)\]\(/);
    expect(linked[0].message.text.startsWith('see_\\[docs\\](https://evil.test/login)')).toBe(true);
    expect(linked[0].locations[0].logicalLocations?.[0].name).toBe('see_[docs](https://evil.test/login)');

    const s = snap({ tools: [{ name: 'x_[a](https://evil.test)', inputSchema: { type: 'object' } }] });
    const drift = compareTools([], s);
    const sarif = JSON.parse(renderSarifWithBaseline(buildReport(s, result([]), [], 'error', T0, 1), [], undefined, drift));
    const base = sarif.runs[0].results.find((x: { ruleId: string }) => x.ruleId === 'BASE-001');
    expect(base.message.text).toBe('x_\\[a\\](https://evil.test): tool definition added since baseline');
  });
});

describe('A10-02 / I-A10-5: a listing-only run', () => {
  it('--plugin-dir: ChatGPT is INCOMPLETE (not checked), the header names the plugin; the exit code is unchanged', async () => {
    const dirArgs = ['--plugin-dir', fixture('listing/plugin-valid')];
    const [text, md, json, strict] = await Promise.all([run(dirArgs), run(['--format', 'markdown', ...dirArgs]), run(['--format', 'json', ...dirArgs]), run(['--format', 'json', '--fail-on-incomplete', ...dirArgs])]);
    expect(text.stdout).toContain('\nPlugin acme-notes \u00B7 listing-only (no server checked)\n');
    expect(text.stdout).toContain('Claude: NO AUTOMATED BLOCKERS \u00B7 ChatGPT: INCOMPLETE (not checked: no --openai-manifest) \u00B7 Result: PASS');
    expect(md.stdout.startsWith('# Plugin acme-notes\n')).toBe(true);
    expect(md.stdout).toContain('| ChatGPT | INCOMPLETE (not checked: no --openai-manifest) |');
    const doc = JSON.parse(json.stdout);
    expect(doc.summary.verdicts.chatgpt.verdict).toBe('INCOMPLETE');
    expect(doc.coverage.toolLevel).toBe('ok');
    for (const r of [text, json, strict]) expect(r.code).toBe(0);
    expect(JSON.parse(strict.stdout).summary.failed).toBe(false);
  });

  it('--openai-manifest: Claude is INCOMPLETE', async () => {
    const r = await run(['--openai-manifest', fixture('listing/openai-valid/plugin.json')]);
    expect(r.stdout).toContain('Claude: INCOMPLETE (not checked: no --plugin-dir) \u00B7 ChatGPT: NO AUTOMATED BLOCKERS');
    expect(r.code).toBe(0);
  });
});

describe('A10-05: a server with 400 tools', () => {
  it('text shows 10 fix snippets and how many more; --verbose shows all; markdown is grouped and small; JSON keeps every finding', async () => {
    const args = ['--fail-on', 'never', '--stdio', '--', process.execPath, fixture('many-tools-server.mjs')];
    const [text, verbose, md, json] = await Promise.all([run(args), run(['--verbose', ...args]), run(['--format', 'markdown', ...args]), run(['--format', 'json', ...args])]);
    const snippets = (s: string) => s.split('\n').filter((l) => /^ {2}tool_\d+: \{/.test(l)).length;
    expect(FIX_SNIPPETS).toBe(10);
    expect(snippets(text.stdout)).toBe(10);
    expect(text.stdout).toContain('  \u2026 +390 more (--verbose for all)');
    expect(snippets(verbose.stdout)).toBe(400);
    expect(Buffer.byteLength(md.stdout)).toBeLessThan(50 * 1024);
    expect(md.stdout).toMatch(/\| tool\\_0, tool\\_1, tool\\_10, \+397 more \|| 400 tools: tool\\_0, tool\\_1, tool\\_10, \+397 more \|/);
    expect(JSON.parse(json.stdout).findings.length).toBeGreaterThan(1200);
  }, 60_000);
});

describe('C-06: a baselined run labels the score and the verdicts in text and markdown; JSON is unchanged', () => {
  it('--diff-only keeps the known count', async () => {
    const base = at('bad.json');
    const bad = ['--stdio', '--', process.execPath, fixture('bad-server.mjs')];
    await run(['--fail-on', 'never', '--save-baseline', base, ...bad]);
    const b = ['--baseline', base, '--diff-only', ...bad];
    const [text, md, json] = await Promise.all([run(b), run(['--format', 'markdown', ...b]), run(['--format', 'json', ...b])]);
    const known = JSON.parse(json.stdout).summary.baselined as number;
    expect(known).toBeGreaterThan(10);
    expect(text.stdout).toMatch(new RegExp(`Score \\d+/100 \\(all findings, ${known} known\\) \u00B7 \\d+ root causes \u00B7 0 new errors \u00B7 0 new warnings \u00B7 0 new info\\n`));
    expect(text.stdout).toContain('Claude: NO NEW AUTOMATED BLOCKERS \u00B7 ChatGPT: NO NEW AUTOMATED BLOCKERS');
    expect(md.stdout).toContain(`(all findings, ${known} known)`);
    expect(md.stdout).toContain('| Claude | NO NEW AUTOMATED BLOCKERS |');
    // The JSON verdict is a closed enum: its value does not change.
    expect(JSON.parse(json.stdout).summary.verdicts.claude.verdict).toBe('NO AUTOMATED BLOCKERS');
  }, 60_000);

  it('without a baseline the labels are as before', () => {
    const r = buildReport(snap(), result([]), [], 'error', T0, 1);
    const text = renderText(r, { color: false, verbose: false });
    expect(text).toContain('Score 100/100 \u00B7 0 root causes \u00B7 0 errors \u00B7 0 warnings \u00B7 0 info');
    expect(text).toContain('Claude: NO AUTOMATED BLOCKERS');
  });
});

describe('I-A07-4 / I-A07-5: counts are pluralised, markdown verdict rows carry them', () => {
  it('"1 error" in text and markdown, "| Claude | BLOCKED (1 error) |"', () => {
    const r = buildReport(snap(), result([finding(), finding({ ruleId: 'TOOL-011', severity: 'warning', platforms: ['chatgpt'] }), finding({ ruleId: 'TOOL-012', severity: 'warning', platforms: ['chatgpt'], tool: 'b' })]), [], 'error', T0, 1);
    const text = renderText(r, { color: false, verbose: false });
    expect(text).toMatch(/ \u00B7 1 error \u00B7 2 warnings \u00B7 0 info\n/);
    expect(text).not.toContain('1 errors');
    const md = renderMarkdown(r);
    expect(md).toContain('| Findings | 1 error \u00B7 2 warnings \u00B7 0 info |');
    expect(md).toContain('| Claude | BLOCKED (1 error) |');
    expect(md).toContain('| ChatGPT | NEEDS ATTENTION (2 warnings) |');
  });
});

describe('A13-02: a rule that threw makes the report partial, never failed', () => {
  const meta: RuleMeta = { id: 'TEST-201', title: 't', severity: { claude: 'warning', chatgpt: 'warning', spec: 'info' }, needs: [], rationale: 'r', fix: 'f', sources: ['https://x.test'] };
  const boom = defineRule(meta, () => { throw new Error('boom'); });

  it('INCOMPLETE verdicts, score null, summary.internalErrors; toolLevel, failed and the gate unchanged', () => {
    const s = snap();
    const res = runRules(s, [boom]);
    expect(res.internalErrors).toBe(1);
    for (const failOnIncomplete of [false, true]) {
      const r = buildReport(s, res, [], 'error', T0, 1, false, failOnIncomplete);
      expect(r.summary.verdicts.claude?.verdict).toBe('INCOMPLETE');
      expect(r.summary.score).toBeNull();
      expect(r.summary.internalErrors).toBe(1);
      expect(r.summary.failed).toBe(false);
      expect(r.incompleteFails).toBe(false);
      expect(r.snap.coverage.toolLevel).toBe('ok');
      const text = renderText(r, { color: false, verbose: false });
      expect(text).toContain('Score n/a (internal error: 1 rule threw)');
      expect(text).toContain('Result: PASS (--fail-on error)');
    }
  });

  it('a report without a thrown rule has no internalErrors and a score', () => {
    const r = buildReport(snap(), result([]), [], 'error', T0, 1);
    expect(r.summary).not.toHaveProperty('internalErrors');
    expect(r.summary.score).toBe(100);
  });
});

describe('JUnit: a `transport` rule after a failed connect is skipped from its need', () => {
  it('SRV-003 is skipped "could not connect" in the directory suites', () => {
    const s = emptySnapshot({ kind: 'http', urlAsEntered: 'https://down.test/mcp', url: new URL('https://down.test/mcp') }, { target: 'all', active: false, activeAuth: false });
    s.fatal = 'getaddrinfo ENOTFOUND down.test';
    s.coverage = { toolLevel: 'connect-failed', reason: 'getaddrinfo ENOTFOUND down.test' };
    const r: Report = buildReport(s, result([]), [], 'error', T0, 1);
    expect(renderJunit(r)).toMatch(/<testcase classname="claude" name="SRV-003 [^"]*">\n {6}<skipped message="could not connect"\/>/);
  });
});

describe('the SARIF summary carries internalErrors as the JSON one does', () => {
  it('runs[0].properties.summary', () => {
    const s = snap();
    const r = buildReport(s, runRules(s, [defineRule({ id: 'TEST-202', title: 't', severity: { spec: 'info' }, needs: [], rationale: 'r', fix: 'f', sources: ['https://x.test'] }, () => { throw new Error('x'); })]), [], 'error', T0, 1);
    const sarif = toSarif(r) as { runs: Array<{ properties: { summary: { internalErrors?: number } } }> };
    expect(sarif.runs[0].properties.summary.internalErrors).toBe(1);
    expect(annotations(r).some((a) => a.startsWith('::error'))).toBe(false);
  });
});
