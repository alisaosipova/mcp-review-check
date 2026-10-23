// Rule explainability and CLI hygiene (W1-4): `explain <ID>` (R-38), --list-rules formats, prefix filter and the
// rationale in reports (R-39), --ignore checked against the catalog (R-40), "did you mean" and --help examples (R-41).
// Black-box: the built CLI (cli()) and runCli in process; the catalog is read from src/rules/index.ts.
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { MANUAL_ITEMS, RULES } from '../src/rules/index.js';
import { BAD, cli, GOOD } from './cli-runner.js';

const rule = (id: string) => RULES.find((r) => r.id === id)!;
/** Catalog lines of the text listing (the header line starts with "ID"). */
const rows = (out: string) => out.trim().split('\n').filter((l) => !l.startsWith('ID '));

describe('R-38: explain <ID>', () => {
  it('R-38: explain <ID> prints severities, rationale, sources, fix and --ignore hint; unknown ID exits 2', async () => {
    const r = rule('TOOL-011');
    const out = await cli(['explain', 'TOOL-011']);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain('TOOL-011');
    expect(out.stdout).toContain(r.title);
    for (const [p, s] of Object.entries(r.severity)) expect(out.stdout).toContain(`${p}=${s}`);
    expect(out.stdout).toContain(r.rationale);
    expect(out.stdout).toContain(r.fix);
    for (const src of r.sources) expect(out.stdout).toContain(src);
    expect(out.stdout).toContain('--ignore TOOL-011');
    // a rule with several platforms and sources, given in lower case
    const multi = RULES.find((x) => Object.keys(x.severity).length > 1 && x.sources.length > 1)!;
    const many = await cli(['explain', multi.id.toLowerCase()]);
    expect(many.code, many.stderr).toBe(0);
    for (const [p, s] of Object.entries(multi.severity)) expect(many.stdout).toContain(`${p}=${s}`);
    for (const src of multi.sources) expect(many.stdout).toContain(src);
    // a manual checklist item is explained too
    const man = MANUAL_ITEMS.find((m) => m.id === 'MAN-024')!;
    const manOut = await cli(['explain', 'MAN-024']);
    expect(manOut.code, manOut.stderr).toBe(0);
    expect(manOut.stdout).toContain(man.text);
    expect(manOut.stdout).toContain(man.docs[0]);
    // unknown or missing ID: usage error, nothing on stdout
    const unknown = await cli(['explain', 'TOOL-999']);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toMatch(/TOOL-999/);
    expect(unknown.stderr).toMatch(/--list-rules/);
    const missing = await cli(['explain']);
    expect(missing.code).toBe(2);
    expect(missing.stdout).toBe('');
  });
});

describe('R-39: --list-rules formats and filter, rationale in reports', () => {
  it('R-39: --list-rules --format json|markdown, prefix filter; rationale in --verbose and markdown', async () => {
    const json = await cli(['--list-rules', '--format', 'json']);
    expect(json.code, json.stderr).toBe(0);
    expect(() => JSON.parse(json.stdout), '--list-rules --format json prints a JSON document').not.toThrow();
    const doc = JSON.parse(json.stdout);
    expect(doc.rules.map((r: any) => r.id)).toEqual(RULES.map((r) => r.id));
    expect(doc.manual.map((m: any) => m.id)).toEqual(MANUAL_ITEMS.map((m) => m.id));
    const r11 = rule('TOOL-011');
    expect(doc.rules.find((r: any) => r.id === 'TOOL-011')).toMatchObject({ title: r11.title, severity: r11.severity, rationale: r11.rationale, fix: r11.fix, sources: r11.sources });

    const md = await cli(['--list-rules', '--format', 'markdown']);
    expect(md.code, md.stderr).toBe(0);
    const mdLines = md.stdout.split('\n');
    expect(mdLines[0]).toMatch(/^\| ID \| Title \| Severity by platform \| Source \|$/);
    expect(mdLines[1]).toMatch(/^\|(---\|)+$/);
    for (const r of RULES) expect(mdLines.some((l) => l.startsWith(`| ${r.id} |`)), r.id).toBe(true);
    for (const m of MANUAL_ITEMS) expect(mdLines.some((l) => l.startsWith(`| ${m.id} |`)), m.id).toBe(true);

    // prefix filter, in every format and in any case
    const tools = RULES.filter((r) => r.id.startsWith('TOOL-')).map((r) => r.id);
    const text = await cli(['--list-rules', 'TOOL']);
    expect(text.code, text.stderr).toBe(0);
    expect(rows(text.stdout).map((l) => l.split(' ')[0])).toEqual(tools);
    const jsonTools = JSON.parse((await cli(['--list-rules', 'tool-01', '--format', 'json'])).stdout);
    expect(jsonTools.rules.map((r: any) => r.id)).toEqual(tools.filter((id) => id.startsWith('TOOL-01')));
    expect(jsonTools.manual).toEqual([]);
    const mdMan = await cli(['--list-rules', 'MAN', '--format', 'markdown']);
    expect(mdMan.stdout).toContain('| MAN-024 |');
    expect(mdMan.stdout).not.toContain('| TOOL-011 |');
    const none = await cli(['--list-rules', 'XYZ']);
    expect(none.code).toBe(2);
    expect(none.stdout).toBe('');
    expect((await cli(['--list-rules', '--format', 'sarif'])).code).toBe(2);

    // rationale: --list-rules --verbose, the --verbose text report and the markdown report
    const listVerbose = await cli(['--list-rules', 'TOOL-011', '--verbose']);
    expect(listVerbose.stdout).toContain(r11.rationale);
    expect((await cli(['--list-rules', 'TOOL-011'])).stdout).not.toContain(r11.rationale);
    const [badJson, badText, badVerbose, badMd] = await Promise.all([
      cli(['--stdio', BAD, '--format', 'json']),
      cli(['--stdio', BAD]),
      cli(['--stdio', BAD, '--verbose']),
      cli(['--stdio', BAD, '--format', 'markdown']),
    ]);
    const ids = [...new Set<string>(badJson.json.findings.filter((f: any) => f.severity === 'error').map((f: any) => f.ruleId))];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const why = rule(id).rationale;
      expect(badVerbose.stdout, id).toContain(why);
      expect(badMd.stdout, id).toContain(why.replace(/\|/g, '\\|'));
      expect(badText.stdout, id).not.toContain(why);
    }
  });
});

describe('R-40: --ignore is checked against the catalog', () => {
  it('R-40: --ignore with an unknown ID exits 2; MAN IDs are accepted', async () => {
    const unknown = await cli(['--stdio', GOOD, '--ignore', 'TOOL-011', '--ignore', 'TOOL-999']);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toMatch(/TOOL-999/);
    expect(unknown.stderr).not.toMatch(/TOOL-011/);
    // checked before connecting: an unreachable URL still gives the usage error, not exit 3
    expect((await cli(['http://localhost:1/mcp', '--ignore', 'NOPE-1'])).code).toBe(2);
    const man = await cli(['--stdio', GOOD, '--ignore', 'MAN-024', '--ignore', 'tool-011']);
    expect(man.code, man.stderr).toBe(0);
    expect(man.stderr).not.toMatch(/error:/);
  });
});

describe('R-41: did you mean, --help examples', () => {
  it('R-41: an unknown option suggests the closest one; --help has examples', async () => {
    const typo = await runCli(['--formt', 'json', '--stdio', 'node x.mjs']);
    expect(typo.code).toBe(2);
    expect(typo.stdout).toBe('');
    expect(typo.stderr).toMatch(/unknown option --formt; did you mean --format\?/i);
    expect(typo.stderr).not.toMatch(/To specify a positional argument/);
    expect((await runCli(['--verbos', '--list-rules'])).stderr).toMatch(/did you mean --verbose\?/);
    expect((await runCli(['--no-colr', '--list-rules'])).stderr).toMatch(/did you mean --no-color\?/);
    // nothing close: no suggestion; the value after "=" is never shown (it may be a credential)
    const far = await runCli(['--zzzzzzzz=s3cr3t-value-123', '--list-rules']);
    expect(far.code).toBe(2);
    expect(far.stderr).toMatch(/unknown option --zzzzzzzz/i);
    expect(far.stderr).not.toMatch(/did you mean/);
    expect(far.stderr).not.toContain('s3cr3t-value-123');

    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    const examples = help.stdout.split(/^Examples:$/m)[1];
    expect(examples, 'an "Examples:" section').toBeDefined();
    expect(examples).toMatch(/^ {2}mcp-review-check https:\/\/\S+/m);
    expect(examples).toMatch(/^ {2}mcp-review-check .*--stdio -- node /m);
    expect(examples).toMatch(/^ {2}mcp-review-check explain TOOL-011$/m);
    expect(examples).toMatch(/^ {2}mcp-review-check --list-rules \S+ --format json$/m);
  });
});
