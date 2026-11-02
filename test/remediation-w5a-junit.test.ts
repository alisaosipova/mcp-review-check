// Regression tests for the W5A-cli package (wave 5, 0.3.0): --format junit. One <testsuite> per gated platform, one
// <testcase> per rule, <failure> at --fail-on, <skipped> for rules that did not run, lower, known and ignored findings in
// <system-out>, counts consistent with the children, XML escaped. No XML library: a small well-formedness check below.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildReport } from '../src/report/index.js';
import { renderJunit, xmlText } from '../src/report/junit.js';
import { RULES, runRules } from '../src/rules/index.js';
import type { Finding } from '../src/rules/types.js';
import { snap } from './helpers.js';

const BAD = fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url));
const server = ['--no-config', '--stdio', '--', process.execPath, BAD];
const run = (args: string[]) => runCli(args, {}, false);

/** Throws unless `xml` is one well-formed element tree after the declaration: tags balance, attribute values are
 *  quoted without a raw < or ", text has no raw < or & outside the five entities and no control characters. */
function wellFormed(xml: string): void {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
  const body = xml.slice(xml.indexOf('?>') + 2);
  const stack: string[] = [];
  let roots = 0;
  const re = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  for (const m of body.matchAll(re)) {
    if (m[6]) throw new Error(`stray "<" at ${m.index}: ${body.slice(m.index, m.index + 40)}`);
    const text = m[5] ?? m[3];
    if (text !== undefined) {
      expect(text.replace(/&(amp|lt|gt|quot|apos);/g, ''), text.slice(0, 60)).not.toMatch(/[&<]/);
      expect(text).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/);
      if (m[5] !== undefined && !stack.length) expect(m[5].trim()).toBe('');
      if (m[5] !== undefined) continue;
    }
    if (m[1]) expect(stack.pop(), `close </${m[2]}>`).toBe(m[2]);
    else {
      if (!stack.length) roots++;
      if (!m[4]) stack.push(m[2]);
    }
  }
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

const attr = (tag: string, name: string) => Number(new RegExp(`\\s${name}="(\\d+)"`).exec(tag)?.[1]);

/** Each <testsuite> with its attributes and the counts of its children; the root totals. */
function suites(xml: string) {
  const root = /<testsuites [^>]*>/.exec(xml)![0];
  const list = [...xml.matchAll(/(<testsuite [^>]*>)([\s\S]*?)<\/testsuite>/g)].map(([, tag, inner]) => ({
    name: /name="([^"]*)"/.exec(tag)![1], tag, inner,
    cases: [...inner.matchAll(/<testcase [^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/g)].map((c) => c[0]),
  }));
  return { root, list };
}

function consistent(xml: string): void {
  const { root, list } = suites(xml);
  for (const s of list) {
    expect(attr(s.tag, 'tests'), s.name).toBe(s.cases.length);
    expect(attr(s.tag, 'failures'), s.name).toBe(s.cases.filter((c) => c.includes('<failure ')).length);
    expect(attr(s.tag, 'errors'), s.name).toBe(s.cases.filter((c) => c.includes('<error ')).length);
    expect(attr(s.tag, 'skipped'), s.name).toBe(s.cases.filter((c) => c.includes('<skipped ')).length);
    for (const c of s.cases) expect(c).toContain(`classname="${s.name}"`);
  }
  for (const k of ['tests', 'failures', 'errors', 'skipped']) expect(attr(root, k), k).toBe(list.reduce((a, s) => a + attr(s.tag, k), 0));
}

const finding = (over: Partial<Finding>): Finding => ({
  ruleId: 'TOOL-006', title: 'Tool has a title', severity: 'error', platforms: ['claude'], severityByPlatform: { claude: 'error' },
  message: 'no title', tool: 't', fix: 'Add a title.', docs: [], ...over,
});

describe('renderJunit on a synthetic report', () => {
  const s = snap({ target: 'claude' });
  const base = runRules(s, RULES);
  const report = (findings: Finding[], failOn: 'error' | 'warning' | 'never' = 'error', failOnSpec = false) =>
    buildReport(s, { ...base, findings }, [], failOn, new Date('2026-11-02T10:00:00Z'), 1500, failOnSpec);

  it('one suite per gated platform, a failure per rule at --fail-on, lower findings in system-out', () => {
    const other = RULES.find((r) => 'claude' in r.severity && r.id !== 'TOOL-006')!;
    const xml = renderJunit(report([
      finding({}),
      finding({ ruleId: other.id, title: other.title, severity: 'warning', severityByPlatform: { claude: 'warning' }, message: 'a warning' }),
    ]));
    wellFormed(xml);
    consistent(xml);
    const { list } = suites(xml);
    expect(list.map((x) => x.name)).toEqual(['claude']);
    const tc = list[0].cases.find((c) => c.includes('name="TOOL-006 '))!;
    expect(tc).toMatch(/<failure message="\[error\] t: no title" type="error">\[error\] t: no title\n {2}fix: Add a title\.<\/failure>/);
    const low = list[0].cases.find((c) => c.includes(`name="${other.id} `))!;
    expect(low).not.toContain('<failure');
    expect(low).toContain('<system-out>[warning] t: a warning (below --fail-on error)</system-out>');
    expect(attr(list[0].tag, 'failures')).toBe(1);
    // The claude suite lists every claude rule of the catalog, the name being the ID and the title.
    expect(list[0].cases.length).toBe(RULES.filter((r) => 'claude' in r.severity).length);
    expect(tc).toContain('name="TOOL-006 Tool has a title"');
  });

  it('--fail-on warning fails warnings, never fails nothing; --fail-on-spec adds a spec suite', () => {
    const warn = finding({ ruleId: 'TOOL-006', severity: 'warning', severityByPlatform: { claude: 'warning' } });
    expect(attr(suites(renderJunit(report([warn], 'warning'))).root, 'failures')).toBe(1);
    expect(attr(suites(renderJunit(report([warn], 'error'))).root, 'failures')).toBe(0);
    expect(renderJunit(report([warn], 'error'))).toContain('[warning] t: no title (below --fail-on error)');
    expect(attr(suites(renderJunit(report([finding({})], 'never'))).root, 'failures')).toBe(0);
    const spec = renderJunit(report([finding({ ruleId: 'SPEC-001', platforms: ['spec'], severityByPlatform: { spec: 'error' } })], 'error', true));
    expect(suites(spec).list.map((x) => x.name)).toEqual(['claude', 'spec']);
    expect(attr(suites(spec).list[1].tag, 'failures')).toBe(1);
    consistent(spec);
  });

  it('skipped rules carry their reason', () => {
    const xml = renderJunit(report([]));
    const reason = base.skipped.find((x) => RULES.find((r) => r.id === x.ruleId && 'claude' in r.severity))!;
    expect(xml).toContain(`<skipped message="${xmlText(reason.reason)}"/>`);
    expect(attr(suites(xml).root, 'skipped')).toBe(new Set(base.skipped.filter((x) => RULES.find((r) => r.id === x.ruleId && 'claude' in r.severity)).map((x) => x.ruleId)).size);
  });

  it('known (baselined) findings are not failures and are named in system-out; the suite gets the baseline line', () => {
    const xml = renderJunit(report([]), [finding({})]);
    wellFormed(xml);
    consistent(xml);
    expect(attr(suites(xml).root, 'failures')).toBe(0);
    expect(xml).toContain('known from baseline, not a failure: [error] t: no title');
    expect(xml).toMatch(/<system-out>1 known finding\(s\) from baseline, not listed: TOOL-006<\/system-out>\n {2}<\/testsuite>/);
    expect(xml).toContain('<property name="baselined" value="1"/>');
  });

  it('escapes the five XML characters and shows control characters, lone surrogates and U+FFFF as \\u{..}', () => {
    const nasty = `a<b>&"c'</failure><x>\u001b[31m\r\nline\u202e\ud800\uffff`;
    const xml = renderJunit(report([finding({ message: nasty, tool: '<t&>', evidence: ']]><!--' })]));
    wellFormed(xml);
    expect(xml).toContain('a&lt;b&gt;&amp;&quot;c&apos;&lt;/failure&gt;&lt;x&gt;\\u{1B}[31m\\u{D}\\u{A}line\\u{202E}\\u{D800}\\u{FFFF}');
    expect(xml).toContain('&lt;t&amp;&gt;: ');
    expect(xml).toContain('evidence: ]]&gt;&lt;!--');
    expect(xmlText('plain')).toBe('plain');
  });

  it('a failed connect is an <error> test case in each suite', () => {
    const dead = snap({ target: 'all', set: (x) => { x.fatal = 'ECONNREFUSED'; x.coverage = { ...x.coverage, toolLevel: 'list-failed', reason: 'connection refused' }; } });
    const r = buildReport(dead, { ...runRules(dead, RULES), findings: [] }, [], 'error', new Date(), 1);
    const xml = renderJunit(r);
    wellFormed(xml);
    consistent(xml);
    expect(suites(xml).list.map((x) => x.name)).toEqual(['claude', 'chatgpt']);
    expect(attr(suites(xml).root, 'errors')).toBe(2);
    expect(xml).toContain('<error message="could not connect: connection refused" type="connect"/>');
  });
});

describe('--format junit end to end', () => {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w5a-junit-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('the BAD fixture: well-formed, consistent counts, failures for the errors, exit 1', async () => {
    const r = await run(['--format', 'junit', ...server]);
    expect(r.code).toBe(1);
    wellFormed(r.stdout);
    consistent(r.stdout);
    expect(suites(r.stdout).list.map((x) => x.name)).toEqual(['claude', 'chatgpt']);
    expect(attr(suites(r.stdout).root, 'failures')).toBeGreaterThan(0);
    expect(r.stderr).toContain('Local target'); // the local banner goes to stderr, stdout stays the document
  });

  it('with --baseline from --save-baseline nothing fails, and the known findings are listed', async () => {
    const base = join(dir, 'b.json');
    expect((await run(['--fail-on', 'never', '--save-baseline', base, ...server])).code).toBe(0);
    const r = await run(['--format', 'junit', '--baseline', base, '--output', join(dir, 'r.xml'), ...server]);
    expect(r.code, r.stderr).toBe(0);
    const xml = readFileSync(join(dir, 'r.xml'), 'utf8');
    wellFormed(xml);
    consistent(xml);
    expect(attr(suites(xml).root, 'failures')).toBe(0);
    expect(xml).toContain('known from baseline, not a failure: ');
  });

  it('--fail-on-spec adds the spec suite; --list-rules --format junit prints text with a warning', async () => {
    const r = await run(['--format', 'junit', '--fail-on-spec', '--target', 'claude', ...server]);
    expect(suites(r.stdout).list.map((x) => x.name)).toEqual(['claude', 'spec']);
    consistent(r.stdout);
    const list = await run(['--list-rules', 'TOOL-00', '--format', 'junit']);
    expect(list.code).toBe(0);
    expect(list.stderr).toContain('warning: --format junit does not apply to --list-rules; printing text');
  });
});
