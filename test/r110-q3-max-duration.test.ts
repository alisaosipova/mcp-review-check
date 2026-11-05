// 1.1.0 Q3, A09-04: --max-duration also bounds the rule evaluation. The rules not started by the deadline are skipped
// with "stopped by --max-duration", limits.stopped names the "rules" phase, the Result line reads INCOMPLETE and the
// exit code is 4, as for a stop during the connect phases. The rules get at least RULES_GRACE_MS.
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markRulesStopped, RULES_GRACE_MS, runCli } from '../src/cli.js';
import { runRules, STOPPED_REASON } from '../src/rules/engine.js';
import { defineRule, type Rule } from '../src/rules/types.js';
import { buildReport, resultLine } from '../src/report/index.js';
import { snap, tool } from './helpers.js';

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const PLUGIN = fileURLToPath(new URL('./fixtures/listing/plugin-valid', import.meta.url));

/** A rule that finds one thing on every tool, with a clock tick per run. */
function fakeRule(id: string, tick: () => void): Rule {
  return defineRule({
    id, title: `fake ${id}`, severity: { claude: 'warning' }, needs: ['tools'], rationale: 'test', fix: 'test',
    sources: ['https://example.invalid/'],
  }, (s) => { tick(); return s.tools.map(() => ({ message: `${id} hit` })); });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('A09-04 runRules stops between rules at the deadline', () => {
  it('skips every rule after the deadline with STOPPED_REASON and reports where it stopped', () => {
    let t = 0;
    const rules = ['FAKE-001', 'FAKE-002', 'FAKE-003', 'FAKE-004'].map((id) => fakeRule(id, () => { t += 100; }));
    const r = runRules(snap({ tools: [tool()] }), rules, { deadline: 150, now: () => t });
    expect(r.rulesRun).toBe(2);
    expect(r.stopped).toEqual({ atRule: 'FAKE-003', rulesNotRun: 2 });
    expect(r.skipped).toEqual([{ ruleId: 'FAKE-003', reason: STOPPED_REASON }, { ruleId: 'FAKE-004', reason: STOPPED_REASON }]);
    expect(r.findings.map((f) => f.ruleId)).toEqual(['FAKE-001', 'FAKE-002']);
  });

  it('without a deadline, or before it, every rule runs and nothing is marked stopped', () => {
    const rules = ['FAKE-001', 'FAKE-002'].map((id) => fakeRule(id, () => {}));
    expect(runRules(snap({ tools: [tool()] }), rules).stopped).toBeUndefined();
    expect(runRules(snap({ tools: [tool()] }), rules, { deadline: 10, now: () => 0 }).rulesRun).toBe(2);
  });

  it('markRulesStopped makes the report INCOMPLETE during rules; a snapshot stopped earlier keeps its own stop', () => {
    const s = snap({ tools: [tool()] });
    const r = runRules(s, [fakeRule('FAKE-001', () => {})], { deadline: 0, now: () => 1 });
    markRulesStopped(s, 3000, ['connect', 'listing']);
    expect(s.limits?.stopped).toMatchObject({ maxDurationMs: 3000, phase: 'rules', unfinished: ['rules'] });
    expect(s.limits?.stopped?.completed).toEqual(['connect', 'listing']);
    expect(s.coverage).toEqual({ toolLevel: 'stopped', reason: 'stopped by --max-duration (3000 ms) during rules' });
    const report = buildReport(s, r, [], 'error', new Date(), 1);
    expect(resultLine(report)).toMatch(/^INCOMPLETE \(stopped at --max-duration during rules\)/);
    expect(report.summary.failed).toBe(true);

    const earlier = snap({ tools: [tool()] });
    earlier.limits = { truncated: [], stopped: { maxDurationMs: 3000, phase: 'listing', completed: ['connect'], unfinished: ['listing'] } };
    markRulesStopped(earlier, 3000);
    expect(earlier.limits.stopped?.phase).toBe('listing');
  });
});

/** The engine's clock jumps far past any deadline; every other caller of performance.now sees the real time. */
function rulesPastDeadline() {
  const real = performance.now.bind(performance);
  vi.spyOn(performance, 'now').mockImplementation(() => (new Error().stack?.includes('runRules') ? real() + 1e9 : real()));
}

describe('A09-04 the CLI: a slow rule phase is exit 4, not 0 or 1', () => {
  it('a stdio check whose rules run past --max-duration exits 4 with limits.stopped during rules', async () => {
    rulesPastDeadline();
    const r = await runCli(['--format', 'json', '--max-duration', '60000', '--stdio', `node "${GOOD}"`], {}, false);
    expect(r.code, r.stderr).toBe(4);
    const json = JSON.parse(r.stdout);
    expect(json.limits.stopped).toMatchObject({ maxDurationMs: 60000, phase: 'rules', unfinished: ['rules'] });
    // Only the phases this run went through (review Q3 fix): stdio without --active has no auth probe, no active calls.
    expect(json.limits.stopped.completed).toContain('listing');
    expect(json.limits.stopped.completed).toContain('connect');
    expect(json.limits.stopped.completed).not.toContain('auth probe');
    expect(json.limits.stopped.completed).not.toContain('active tool calls');
    expect(json.coverage.toolLevel).toBe('stopped');
    expect(json.skipped.filter((s: { reason: string }) => s.reason === STOPPED_REASON).length).toBeGreaterThan(10);
  }, 60000);

  it('a listing-only run: the text Result line reads INCOMPLETE', async () => {
    rulesPastDeadline();
    const r = await runCli(['--max-duration', '60000', '--plugin-dir', PLUGIN], {}, false);
    expect(r.code, r.stderr).toBe(4);
    expect(r.stdout).toMatch(/INCOMPLETE \(stopped at --max-duration during rules\)/);
  });

  it('a listing-only run reports no connect phase as completed', async () => {
    rulesPastDeadline();
    const r = await runCli(['--format', 'json', '--max-duration', '60000', '--plugin-dir', PLUGIN], {}, false);
    expect(r.code, r.stderr).toBe(4);
    expect(JSON.parse(r.stdout).limits.stopped.completed).toEqual([]);
  });

  it('without --max-duration the same run is not stopped', async () => {
    rulesPastDeadline();
    const r = await runCli(['--format', 'json', '--plugin-dir', PLUGIN], {}, false);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).limits?.stopped).toBeUndefined();
  });

  it('the rules get at least RULES_GRACE_MS: a deadline already past when they start does not skip them', async () => {
    expect(RULES_GRACE_MS).toBeGreaterThanOrEqual(1000);
    // Real clock: --max-duration 1 has passed before the rules start; the listing rules run well within the grace.
    const r = await runCli(['--format', 'json', '--max-duration', '1', '--plugin-dir', PLUGIN], {}, false);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).limits?.stopped).toBeUndefined();
  });
});
