// Review round 3, package P7 (1.0.1): a SARIF or JSON report of a very large server (A09-05) is printed without
// indentation above COMPACT_FINDINGS findings, and a report too large for one string is a ReportTooLargeError with a
// hint instead of an internal "RangeError: Invalid string length".
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '../src/rules/types.js';
import { buildReport, COMPACT_FINDINGS, ReportTooLargeError, stringifyReport } from '../src/report/index.js';
import { renderJson } from '../src/report/json.js';
import { renderSarif } from '../src/report/sarif.js';
import { snap } from './helpers.js';

const at = new Date('2026-11-04T10:00:00Z');
const many = (n: number): Finding[] => Array.from({ length: n }, (_, i) => ({
  ruleId: 'TOOL-006', title: 't', severity: 'warning', platforms: ['claude'], message: 'no title', fix: 'Add a title.', docs: ['https://x.test'], tool: `t${i}`,
}));
const reportOf = (n: number) => buildReport(snap(), { findings: many(n), ignored: [], skipped: [], rulesRun: 1 }, [], 'error', at, 1);

afterEach(() => { vi.restoreAllMocks(); });

describe('A09-05: large SARIF and JSON reports', () => {
  it('up to COMPACT_FINDINGS findings the report stays indented', () => {
    expect(renderSarif(reportOf(3))).toMatch(/^\{\n {2}"\$schema"/);
    expect(renderJson(reportOf(3))).toMatch(/^\{\n {2}"schemaVersion"/);
  });

  it('above it the report is one compact line with the same content', () => {
    const r = reportOf(COMPACT_FINDINGS + 1);
    const sarif = renderSarif(r);
    expect(sarif.split('\n')).toHaveLength(2);
    expect(JSON.parse(sarif).runs[0].results).toHaveLength(COMPACT_FINDINGS + 1);
    const json = renderJson(r);
    expect(json.split('\n')).toHaveLength(2);
    expect(JSON.parse(json).findings).toHaveLength(COMPACT_FINDINGS + 1);
  });

  it('a RangeError of JSON.stringify becomes a ReportTooLargeError that says how to narrow the report', () => {
    // Only the call that builds the whole document (it passes the indentation argument) fails, as at 80 000 tools.
    const real = JSON.stringify;
    vi.spyOn(JSON, 'stringify').mockImplementation((...a: Parameters<typeof JSON.stringify>) => {
      if (a.length === 3) throw new RangeError('Invalid string length');
      return real(...a);
    });
    expect(() => renderSarif(reportOf(2))).toThrow(ReportTooLargeError);
    expect(() => renderSarif(reportOf(2))).toThrow(/sarif report \(2 findings\) is too large .*Invalid string length.*--ignore/);
    expect(() => renderJson(reportOf(2))).toThrow(/json report/);
  });

  it('other errors pass through unchanged', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stringifyReport(cyclic, 'json', 1)).toThrow(TypeError);
  });
});
