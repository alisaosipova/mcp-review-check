// Regression tests for the W4A-cli remediation (review 2026-11-01): --baseline <report.json> (F168). Findings of an
// earlier JSON report are known: only new ones count toward --fail-on, the verdicts and the annotations; JSON marks
// each finding `baselined`, SARIF sets `baselineState`, text and markdown show one collapsed line. A wrong file is exit 2.
// Unit: knownFindings and loadBaseline; black box: the built CLI (cli) on the BAD and the leaky stdio fixtures.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import _Ajv from 'ajv';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaselineError, knownFindings, loadBaseline, type FindingKey } from '../src/baseline.js';
import { runCli } from '../src/cli.js';
import { BAD, cli, GOOD } from './cli-runner.js';

const LEAKY = fileURLToPath(new URL('./fixtures/leaky-server.mjs', import.meta.url));
const k = (ruleId: string, over: Partial<FindingKey> = {}): FindingKey => ({ ruleId, platforms: ['claude'], ...over });

/** The SARIF 2.1.0 schema validator, set up as in sarif.test.ts. */
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

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w4a-baseline-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const file = (name: string, content: string | Buffer) => { const p = join(dir, name); writeFileSync(p, content); return p; };

describe('knownFindings: identity by rule, subject and platforms, not by message (F168)', () => {
  it('matches rule + tool/resource + path; platforms of the finding must be covered by the baseline entry', () => {
    const base = [k('TOOL-011', { tool: 'a', platforms: ['claude', 'chatgpt'] }), k('RES-001', { resource: 'ui://x', path: 'p' })];
    expect(knownFindings([
      k('TOOL-011', { tool: 'a' }), // --target claude against a baseline for all: known
      k('RES-001', { resource: 'ui://x', path: 'p' }),
      k('RES-001', { resource: 'ui://x', path: 'q' }), // other path: new
      k('TOOL-011', { tool: 'b' }), // other tool: new
    ], base)).toEqual([true, true, false, false]);
    // A platform the baseline did not cover is new.
    expect(knownFindings([k('TOOL-011', { tool: 'a', platforms: ['claude', 'spec'] })], base)).toEqual([false]);
  });

  it('each baseline entry covers one finding: a repeat on the same subject is new', () => {
    expect(knownFindings([k('AUTH-005'), k('AUTH-005'), k('AUTH-005')], [k('AUTH-005'), k('AUTH-005')])).toEqual([true, true, false]);
  });

  it('between findings on one subject, the same wording (numbers aside) is matched first; a reworded one still matches', () => {
    const base = [k('DATA-001', { tool: 't', message: 'asks for 12 fields' })];
    expect(knownFindings([k('DATA-001', { tool: 't', message: 'other problem' }), k('DATA-001', { tool: 't', message: 'asks for 13 fields' })], base)).toEqual([false, true]);
    expect(knownFindings([k('DATA-001', { tool: 't', message: 'reworded in a new release' })], base)).toEqual([true]);
  });

  it('SRV-020 (the era note in the report header) is never known', () => {
    expect(knownFindings([k('SRV-020')], [k('SRV-020')])).toEqual([false]);
  });
});

describe('loadBaseline: only a JSON report of mcp-review-check, never quoting the file', () => {
  const report = { schemaVersion: 1, tool: { name: 'mcp-review-check' }, findings: [{ ruleId: 'TOOL-011', platforms: ['claude'], tool: 't', message: 'm' }] };

  it('reads UTF-8, UTF-8 with a BOM and UTF-16LE with a BOM', () => {
    const text = JSON.stringify(report);
    for (const raw of [text, `\uFEFF${text}`, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`\uFEFF${text}`, 'utf16le').subarray(2)])]) {
      expect(loadBaseline(file('b.json', raw))).toEqual([{ ruleId: 'TOOL-011', platforms: ['claude'], tool: 't', resource: undefined, path: undefined, message: 'm' }]);
    }
  });

  it.each([
    ['missing', null, /no such file/],
    ['not JSON', 'not json sk-live-SYNTHNOTSHOWN0001', /not valid JSON/],
    ['an array', '[]', /not a JSON object/],
    ['another tool', JSON.stringify({ ...report, tool: { name: 'other' } }), /tool\.name/],
    ['a SARIF file', JSON.stringify({ version: '2.1.0', runs: [] }), /tool\.name/],
    ['a newer schema', JSON.stringify({ ...report, schemaVersion: 99 }), /schemaVersion/],
    ['no findings', JSON.stringify({ ...report, findings: undefined }), /no findings array/],
    ['a bad finding', JSON.stringify({ ...report, findings: [{ ruleId: 5 }] }), /findings\[0\]/],
  ])('%s is a BaselineError', (_, content, message) => {
    const p = content === null ? join(dir, 'nope.json') : file('b.json', content);
    expect(() => loadBaseline(p)).toThrow(BaselineError);
    expect(() => loadBaseline(p)).toThrow(message);
  });

  it('the CLI reports a bad --baseline as a usage error (exit 2) before connecting, without the file content', async () => {
    const secret = 'sk-live-SYNTHNOTSHOWN0002';
    for (const p of [join(dir, 'nope.json'), file('bad.json', `{"token": "${secret}"`), file('other.json', JSON.stringify({ tool: { name: 'x' }, findings: [] }))]) {
      const r = await runCli(['--stdio', 'node -e "process.exit(9)"', '--baseline', p], {}, false);
      expect(r.code, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/^error: (cannot read --baseline|--baseline is not)/);
      expect(r.stderr).not.toContain(secret);
    }
    expect((await runCli(['--stdio', 'node x.js', '--baseline='], {}, false)).stderr).toMatch(/--baseline needs a file path/);
  });
});

describe('--baseline end to end (F168)', () => {
  it('a rerun against its own report: every finding known, exit 0, counts and verdicts of the new findings only', async () => {
    const first = await cli(['--stdio', BAD, '--format', 'json']);
    expect(first.code).toBe(1);
    const base = file('base.json', first.stdout);
    const r = await cli(['--stdio', BAD, '--format', 'json', '--baseline', base]);
    expect(r.code, r.stderr).toBe(0);
    const j = r.json;
    const era = j.findings.filter((f: any) => f.ruleId === 'SRV-020').length;
    expect(j.findings).toHaveLength(first.json.findings.length);
    expect(j.findings.filter((f: any) => f.baselined === true)).toHaveLength(first.json.findings.length - era);
    expect(j.summary.baselined).toBe(first.json.findings.length - era);
    expect(j.summary.errors).toBe(0);
    expect(j.summary.warnings).toBe(0);
    expect(j.summary.failed).toBe(false);
    expect(j.summary.score).toBe(first.json.summary.score); // the score keeps every finding
    for (const v of Object.values(j.summary.verdicts) as any[]) expect(v.verdict).toBe('NO AUTOMATED BLOCKERS');
    // The report with --baseline is a baseline itself.
    expect((await cli(['--stdio', BAD, '--format', 'json', '--baseline', file('again.json', r.stdout)])).code).toBe(0);
  });

  it('a finding missing from the baseline is new: it gates the run, is listed and annotated; the known ones are not', async () => {
    const first = (await cli(['--stdio', BAD, '--format', 'json'])).json;
    const target = first.findings.find((f: any) => f.severityByPlatform?.claude === 'error' && f.tool);
    expect(target, 'the BAD fixture has a claude error on a tool').toBeDefined();
    const others = first.findings.filter((f: any) => f !== target);
    const base = file('base.json', JSON.stringify({ ...first, findings: others }));
    const subject = `${target.ruleId}|${target.tool}|${target.path ?? ''}`;
    const isTarget = (f: any) => `${f.ruleId}|${f.tool}|${f.path ?? ''}` === subject;

    const [json, sarif, text, md, gh] = await Promise.all([
      cli(['--stdio', BAD, '--format', 'json', '--baseline', base]),
      cli(['--stdio', BAD, '--format', 'sarif', '--baseline', base]),
      cli(['--stdio', BAD, '--baseline', base, '--target', 'claude']),
      cli(['--stdio', BAD, '--format', 'markdown', '--baseline', base, '--output', join(dir, 'r.md')]),
      cli(['--stdio', BAD, '--format', 'json', '--baseline', base], { GITHUB_ACTIONS: 'true' }),
    ]);
    expect(json.code, json.stderr).toBe(1);
    const fresh = json.json.findings.filter((f: any) => f.baselined === false && f.ruleId !== 'SRV-020');
    expect(fresh.every(isTarget), JSON.stringify(fresh)).toBe(true);
    expect(fresh.length).toBeGreaterThanOrEqual(1);
    expect(json.json.summary.gate.reason).toContain(target.ruleId);
    expect(json.json.summary.verdicts.claude.verdict).toBe('BLOCKED');

    const results = sarif.json.runs[0].results;
    expect(sarif.code).toBe(1);
    expect(results).toHaveLength(json.json.findings.length);
    expect(results.filter((x: any) => x.baselineState === 'new').length).toBe(json.json.findings.filter((f: any) => !f.baselined).length);
    expect(results.filter((x: any) => x.baselineState === 'unchanged').length).toBe(json.json.summary.baselined);
    expect(results.every((x: any) => ['new', 'unchanged'].includes(x.baselineState))).toBe(true);
    const validate = sarifValidator();
    expect(validate(sarif.json), JSON.stringify(validate.errors)).toBe(true);

    expect(text.code).toBe(1);
    expect(text.stdout).toMatch(new RegExp(`^ERRORS \\(\\d+\\)\\n  x ${target.ruleId} `, 'm'));
    expect(text.stdout).toMatch(/^\d+ known finding\(s\) from baseline, not listed: [A-Z]+-\d+/m);
    const listed = text.stdout.split('\n').filter((l) => /^ {2}[x!i] [A-Z]+-\d+ /.test(l));
    expect(listed.every((l) => l.includes(target.ruleId)), listed.join('\n')).toBe(true);

    expect(md.code).toBe(1);
    expect(md.stderr).toMatch(/ · \d+ known from baseline · FAIL/);
    expect(readFileSync(join(dir, 'r.md'), 'utf8')).toMatch(/^\| Baseline \| \d+ known finding\(s\) from baseline, not listed: /m);

    const annotated = gh.stderr.split('\n').filter((l) => /^::(error|warning) title=[A-Z]+-\d+ /.test(l));
    expect(annotated.length).toBeGreaterThanOrEqual(1);
    expect(annotated.every((l) => l.startsWith(`::error title=${target.ruleId} `)), annotated.join('\n')).toBe(true);
  });

  it('--quiet text has no baseline line; a clean server with an empty baseline is unchanged', async () => {
    const first = await cli(['--stdio', BAD, '--format', 'json']);
    const base = file('base.json', first.stdout);
    const quiet = await cli(['--stdio', BAD, '--quiet', '--baseline', base]);
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).not.toContain('known finding(s)');
    const good = (await cli(['--stdio', GOOD, '--format', 'json'])).stdout;
    const r = await cli(['--stdio', GOOD, '--baseline', file('good.json', good)]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/known finding\(s\) from baseline|Score 100\/100/);
  });

  it('secrets: a baseline from a leaking server matches its redacted findings, and no format with --baseline shows the secret', async () => {
    const SECRET = 'sk-live-SYNTHBASELINE0003';
    const args = ['--stdio', '--', process.execPath, LEAKY, '--api-key', SECRET];
    const first = await cli(['--format', 'json', ...args]);
    expect(first.stdout).not.toContain(SECRET);
    const base = file('base.json', first.stdout);
    for (const format of ['json', 'sarif', 'text', 'markdown']) {
      const r = await cli(['--format', format, '--baseline', base, '--verbose', ...args], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: join(dir, `summary-${format}.md`) });
      expect(r.stdout + r.stderr, format).not.toContain(SECRET);
      expect(readFileSync(join(dir, `summary-${format}.md`), 'utf8'), format).not.toContain(SECRET);
      if (format === 'json') {
        const srv018 = r.json.findings.filter((f: any) => f.ruleId === 'SRV-018');
        expect(srv018.length).toBeGreaterThan(0);
        expect(srv018.every((f: any) => f.baselined === true)).toBe(true);
        expect(r.json.summary.baselined).toBeGreaterThan(0);
      }
    }
  });
});
