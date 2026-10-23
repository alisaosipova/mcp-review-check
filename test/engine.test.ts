import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { defineRule } from '../src/rules/types.js';
import { loadSnapshot, snap } from './helpers.js';

const probe = defineRule(
  { id: 'TEST-001', title: 't', severity: { claude: 'error', chatgpt: 'warning', spec: 'info' }, needs: [], rationale: 'r', fix: 'f', sources: ['https://x.test'] },
  () => [{ message: 'all platforms' }, { message: 'chatgpt only', platforms: ['chatgpt'] }, { message: 'forced info', severity: 'info' }],
);

describe('engine', () => {
  it('computes severity as the max over the active platforms', () => {
    const all = runRules(snap(), [probe]).findings;
    expect(all.find((f) => f.message === 'all platforms')?.severity).toBe('error');
    const chatgpt = runRules(snap({ target: 'chatgpt' }), [probe]).findings;
    expect(chatgpt.find((f) => f.message === 'all platforms')).toMatchObject({ severity: 'warning', platforms: ['chatgpt', 'spec'] });
  });

  it('drops findings whose platforms are all inactive', () => {
    const claude = runRules(snap({ target: 'claude' }), [probe]).findings;
    expect(claude.map((f) => f.message)).not.toContain('chatgpt only');
  });

  it('honors finding-level severity overrides', () => {
    expect(runRules(snap(), [probe]).findings.find((f) => f.message === 'forced info')?.severity).toBe('info');
  });

  it('turns rule exceptions into INTERNAL info findings', () => {
    const boom = defineRule({ ...probe, id: 'TEST-002' }, () => { throw new Error('boom'); });
    expect(runRules(snap(), [boom]).findings[0]).toMatchObject({ ruleId: 'INTERNAL', severity: 'info' });
  });

  it('applies --ignore but keeps ignored findings', () => {
    const r = runRules(snap(), [probe], { ignore: ['test-001'] });
    expect(r.findings).toEqual([]);
    expect(r.ignored).toHaveLength(3);
  });

  it('records skipped rules with reasons when coverage is auth-required', () => {
    const s = loadSnapshot('auth-required');
    const r = runRules(s, RULES);
    const tool = r.skipped.find((x) => x.ruleId === 'TOOL-011');
    expect(tool?.reason).toMatch(/requires auth/);
    expect(r.skipped.find((x) => x.ruleId === 'RT-001')?.reason).toBe('needs --active');
    expect(r.findings.some((f) => f.ruleId.startsWith('AUTH-'))).toBe(true);
  });

  it('chatgpt-only rules are skipped for --target claude', () => {
    const r = runRules(snap({ target: 'claude' }), RULES);
    expect(r.skipped.find((x) => x.ruleId === 'TOOL-012')?.reason).toMatch(/not applicable/);
  });

  it('sorts by severity then rule ID then subject', () => {
    const r = runRules(loadSnapshot('minimal-http'), RULES);
    const sev = r.findings.map((f) => f.severity);
    const order = { error: 0, warning: 1, info: 2 };
    expect([...sev].sort((a, b) => order[a] - order[b])).toEqual(sev);
    expect(r.findings.some((f) => f.ruleId === 'TOOL-011' && f.tool === 'delete_invoice')).toBe(true);
    expect(r.findings.some((f) => f.ruleId === 'INJ-006' && f.tool === 'search_docs')).toBe(true);
  });
});
