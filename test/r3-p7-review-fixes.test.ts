// Review round 3, package P7 (1.0.1), review fixes: the --baseline JSON and SARIF renderers get the same size bound
// as the plain ones (A09-05), a ReportTooLargeError ends the CLI with a message and no stack (A09-05), and the legacy
// `##[` workflow command is not written verbatim into JSON, SARIF or JUnit on stdout.
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hold = vi.hoisted(() => ({ tooLarge: undefined as string | undefined }));
vi.mock('../src/report/sarif.js', async (orig) => {
  const actual = await orig<typeof import('../src/report/sarif.js')>();
  const { ReportTooLargeError } = await import('../src/report/index.js');
  return {
    ...actual,
    renderSarif: (...a: Parameters<typeof actual.renderSarif>) => {
      if (hold.tooLarge !== undefined) throw new ReportTooLargeError(hold.tooLarge);
      return actual.renderSarif(...a);
    },
  };
});

import type { Finding } from '../src/rules/types.js';
import { renderJsonWithBaseline, renderSarifWithBaseline } from '../src/baseline.js';
import { runCli } from '../src/cli.js';
import { buildReport, COMPACT_FINDINGS, ReportTooLargeError } from '../src/report/index.js';
import { renderJson } from '../src/report/json.js';
import { renderJunit } from '../src/report/junit.js';
import { renderSarif } from '../src/report/sarif.js';
import { snap } from './helpers.js';

const at = new Date('2026-11-04T10:00:00Z');
const finding = (i: number, tool = `t${i}`): Finding => ({
  ruleId: 'TOOL-006', title: 't', severity: 'warning', platforms: ['claude'], message: 'no title', fix: 'Add a title.', docs: ['https://x.test'], tool,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => finding(i));
const reportOf = (findings: Finding[]) => buildReport(snap(), { findings, ignored: [], skipped: [], rulesRun: 1 }, [], 'error', at, 1);

afterEach(() => { vi.restoreAllMocks(); hold.tooLarge = undefined; });

describe('A09-05: --baseline JSON and SARIF reports have the same size bound', () => {
  it('stay indented up to COMPACT_FINDINGS findings', () => {
    const r = reportOf(many(2));
    expect(renderJsonWithBaseline(r, [finding(9)])).toMatch(/^\{\n {2}"schemaVersion"/);
    expect(renderSarifWithBaseline(r, [finding(9)])).toMatch(/^\{\n {2}"\$schema"/);
  });

  it('are one compact line above it, counting the known findings too', () => {
    // New and known findings together pass the threshold; neither alone does.
    const r = reportOf(many(COMPACT_FINDINGS / 2 + 1));
    const known = Array.from({ length: COMPACT_FINDINGS / 2 }, (_, i) => finding(i, `k${i}`));
    const json = renderJsonWithBaseline(r, known);
    expect(json.split('\n')).toHaveLength(2);
    const doc = JSON.parse(json);
    expect(doc.findings).toHaveLength(COMPACT_FINDINGS + 1);
    expect(doc.summary.baselined).toBe(COMPACT_FINDINGS / 2);
    const sarif = renderSarifWithBaseline(r, known);
    expect(sarif.split('\n')).toHaveLength(2);
    expect(JSON.parse(sarif).runs[0].results.filter((x: any) => x.baselineState === 'unchanged')).toHaveLength(COMPACT_FINDINGS / 2);
  });

  it('turn a RangeError into a ReportTooLargeError', () => {
    const real = JSON.stringify;
    vi.spyOn(JSON, 'stringify').mockImplementation((...a: Parameters<typeof JSON.stringify>) => {
      if (a.length === 3) throw new RangeError('Invalid string length');
      return real(...a);
    });
    expect(() => renderJsonWithBaseline(reportOf(many(2)), [])).toThrow(ReportTooLargeError);
    expect(() => renderSarifWithBaseline(reportOf(many(2)), [])).toThrow(/sarif report .*--ignore <rule id>/);
  });
});

describe('A09-05: the CLI ends a too-large report with a message, not a stack trace', () => {
  const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
  const TOKEN = ['sk', 'live', 'SYNTHa1b2c3d4e5f6g7h8i9j0'].join('_');

  it('exit 3, "error: <message>", the ::error line in GitHub Actions, and redaction', async () => {
    hold.tooLarge = `the sarif report (5 findings) is too large to write as one document (${TOKEN}); narrow it`;
    const args = ['--no-config', '--format', 'sarif', '--env', `API_TOKEN=${TOKEN}`, '--stdio', '--', process.execPath, GOOD];
    const r = await runCli(args, {}, false);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^error: the sarif report \(5 findings\) is too large/m);
    expect(r.stderr).not.toMatch(/fatal:|ReportTooLargeError|\n\s+at /);
    const ci = await runCli(args, { GITHUB_ACTIONS: 'true' }, false);
    expect(ci.code).toBe(3);
    expect(ci.stderr).toMatch(/^::error title=mcp-review-check::the sarif report/m);
    for (const out of [r.stderr, ci.stderr]) expect(out).not.toContain('SYNTH');
  }, 30_000);
});

describe('the legacy ##[ workflow command is not written verbatim into JSON, SARIF or JUnit', () => {
  const evil = 'grab##[set-output name=verdict;]PASS';
  const r = reportOf([finding(0, evil), finding(1, `x###[y`)]);

  it.each([
    ['json', () => renderJson(r)],
    ['sarif', () => renderSarif(r)],
    ['json --baseline', () => renderJsonWithBaseline(r, [finding(2, evil)])],
    ['sarif --baseline', () => renderSarifWithBaseline(r, [finding(2, evil)])],
  ])('%s: written #\\u0023[, the same string after JSON.parse', (_, render) => {
    const out = render();
    expect(out).not.toContain('##[');
    expect(out).toContain('#\\u0023[');
    expect(JSON.stringify(JSON.parse(out))).toContain(evil);
    expect(JSON.stringify(JSON.parse(out))).toContain('x###[y');
  });

  it('junit: written #&#35;[, which an XML parser reads back as ##[', () => {
    const out = renderJunit(r, [finding(2, evil)]);
    expect(out).not.toContain('##[');
    expect(out).toContain('grab#&#35;[set-output');
    expect(out.replace(/&#35;/g, '#')).toContain(evil);
  });
});
