// mcp-review-check 1.1.0, package Q5 (reports): --fail-on-incomplete is native to buildReport, so JUnit and the GitHub
// annotations say the run failed without CLI post-processing (A10-01 native); the JSON report names the DCR client
// --active-auth registered (authProbe.active.clientId, since 1.1); finding text in annotations goes through visibleText.
import { describe, expect, it } from 'vitest';
import { annotations } from '../src/report/github.js';
import { buildReport } from '../src/report/index.js';
import { renderJunit } from '../src/report/junit.js';
import { RULES } from '../src/rules/index.js';
import { runRules } from '../src/rules/engine.js';
import type { Finding } from '../src/rules/types.js';
import type { Snapshot } from '../src/snapshot.js';
import { loadSnapshot } from './helpers.js';

const AT = new Date('2026-11-04T10:00:00Z');
const partial = (): Snapshot => {
  const s = loadSnapshot('minimal-http');
  s.coverage = { toolLevel: 'list-failed', reason: 'tools/list failed' };
  return s;
};
const report = (s: Snapshot, failOnIncomplete: boolean, findings?: Finding[]) => {
  const r = runRules(s, RULES);
  return buildReport(s, findings ? { ...r, findings } : r, [], 'never', AT, 1, false, failOnIncomplete);
};

describe('A10-01 native: buildReport takes --fail-on-incomplete', () => {
  it('marks the report failed with the cause in gate.reason; not without the flag, a complete check or a failed connect', () => {
    const r = report(partial(), true);
    expect(r.incompleteFails).toBe(true);
    expect(r.summary.failed).toBe(true);
    expect(r.summary.gate.reason).toBe('partial check: list-failed (--fail-on-incomplete)');
    const off = report(partial(), false);
    expect(off.incompleteFails).toBe(false);
    expect(off.summary.failed).toBe(false);
    expect(report(loadSnapshot('minimal-http'), true).incompleteFails).toBe(false);
    const fatal = partial();
    fatal.fatal = 'ECONNREFUSED';
    fatal.coverage = { toolLevel: 'connect-failed', reason: 'connection refused' };
    expect(report(fatal, true).incompleteFails).toBe(false);
  });

  it('renders one <error type="incomplete"> run case per JUnit suite, with the counts', () => {
    const xml = renderJunit(report(partial(), true));
    const cases = xml.match(/<error message="partial check: list-failed \(tools\/list failed\); --fail-on-incomplete fails the run" type="incomplete"\/>/g) ?? [];
    const suites = xml.match(/<testsuite /g) ?? [];
    expect(suites.length).toBeGreaterThan(0);
    expect(cases).toHaveLength(suites.length);
    for (const m of xml.matchAll(/<testsuite [^>]*errors="(\d+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1);
    expect(renderJunit(report(partial(), false))).not.toContain('type="incomplete"');
  });

  it('turns the partial-check annotation into an ::error without the advice to add the flag', () => {
    const [on] = annotations(report(partial(), true)).filter((a) => a.includes('Partial check'));
    expect(on.startsWith('::error title=mcp-review-check::Partial check: list-failed')).toBe(true);
    expect(on.endsWith(' --fail-on-incomplete fails the run.')).toBe(true);
    const [off] = annotations(report(partial(), false)).filter((a) => a.includes('Partial check'));
    expect(off.startsWith('::warning title=mcp-review-check::Partial check: list-failed')).toBe(true);
    expect(off.endsWith(' --fail-on-incomplete fails the run on a partial check.')).toBe(true);
  });
});

