// Regression on listings frozen from real public servers (scripts/capture-real.mjs, captured 2026-10-22). Kiwi,
// Hugging Face, Microsoft Learn and Exa are listed in the Claude directory; Svelte, OpenZeppelin and AWS Knowledge
// showed false positives in the analysis. Only content rules can run here: transport probes are not frozen.
import { existsSync, readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import type { Finding } from '../src/rules/types.js';
import { gate } from '../src/report/score.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';

const LISTED = ['kiwi', 'huggingface', 'mslearn', 'exa'];
const ALL = [...LISTED, 'svelte', 'openzeppelin', 'aws-knowledge'];

function loadReal(name: string, target: Snapshot['options']['target'] = 'all'): { snap: Snapshot; raw: Record<string, any> } {
  const base = new URL(`./fixtures/real/${name}.json`, import.meta.url);
  const text = existsSync(base) ? readFileSync(base, 'utf8') : brotliDecompressSync(readFileSync(new URL(`${base.href}.br`))).toString('utf8');
  const raw = JSON.parse(text);
  const snap = emptySnapshot({ kind: 'http', urlAsEntered: raw.source, url: new URL(raw.source) }, { target, active: false, activeAuth: false });
  const { capturedAt: _c, source: _s, ...rest } = raw;
  Object.assign(snap, rest);
  return { snap, raw };
}

type Row = [ruleId: string, severity: Finding['severity'], subject: string | null];
/** Warnings and errors of the baseline rules (main d6100a9) on the same listings, written by a run on main. */
const BASELINE: { findings: Record<string, Row[]> } = JSON.parse(readFileSync(new URL('./fixtures/real/baseline-findings.json', import.meta.url), 'utf8'));
const RANK: Record<Finding['severity'], number> = { info: 0, warning: 1, error: 2 };
/** Rules whose new or raised findings on these listings are accepted on purpose, one line per rule, added by the commit that makes the change. */
const ACCEPTED_NEW: Record<string, string> = {};

const findings = (name: string, target: Snapshot['options']['target'] = 'all') => runRules(loadReal(name, target).snap, RULES).findings;
const of = (list: Finding[], id: string) => list.filter((f) => f.ruleId === id);
// Regex heuristics: on these servers anything above info is a false positive.
const HEURISTIC = /^(INJ|POL|DATA)-|^(TOOL-014|TOOL-027|APPS-014)$/;
const loud = (list: Finding[]) => list.filter((f) => HEURISTIC.test(f.ruleId) && f.severity !== 'info').map((f) => `${f.ruleId} ${f.tool ?? f.resource ?? ''}: ${f.message}`);

describe('real-server fixtures (no heuristic false positives)', () => {
  it.each(ALL)('%s: no INJ/POL/DATA, TOOL-014, TOOL-027 or APPS-014 finding above info', (name) => {
    const list = findings(name);
    expect(list.length, 'rules ran').toBeGreaterThan(0);
    expect(loud(list)).toEqual([]);
  });

  it.each(ALL)('%s: no new warning or error against the baseline findings (main), except accepted changes', (name) => {
    const base = BASELINE.findings[name];
    expect(base, 'baseline captured').toBeDefined();
    const fresh = findings(name)
      .filter((f) => f.severity !== 'info' && !(f.ruleId in ACCEPTED_NEW))
      .filter((f) => !base.some(([id, sev, subject]) => id === f.ruleId && subject === (f.tool ?? f.resource ?? null) && RANK[sev] >= RANK[f.severity]))
      .map((f) => `${f.ruleId} ${f.severity} ${f.tool ?? f.resource ?? ''}: ${f.message}`);
    expect(fresh).toEqual([]);
  });

  it.each(LISTED)('%s (listed in the Claude directory): no Claude error from the content rules', (name) => {
    const list = findings(name, 'claude');
    expect(gate(list, 'error', ['claude'])).toMatchObject({ failed: false, reason: null });
  });

  it('Kiwi: the self-restriction "Do NOT use it for other MCP servers" is not INJ-006', () => {
    const { raw } = loadReal('kiwi');
    expect(JSON.stringify(raw.tools)).toContain('Do NOT use it for other MCP servers');
    expect(of(findings('kiwi'), 'INJ-006')).toEqual([]);
  });

  it('Kiwi: an empty serverInfo.version in initialize and server/discover is one SRV-013 warning', () => {
    const f = of(findings('kiwi'), 'SRV-013');
    expect(f).toMatchObject([{ severity: 'warning', message: 'serverInfo.version is an empty string (initialize and server/discover); set the server version' }]);
  });

  it('Hugging Face: "always use this skill when/to" on skill resources is info with a skill-specific fix', () => {
    const f = of(findings('huggingface'), 'INJ-006');
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x).toMatchObject({ severity: 'info', resource: expect.stringMatching(/^skill:\/\//), fix: expect.stringMatching(/when this skill applies/) });
  });

  it('Microsoft Learn: "Always use this tool to ground" is info; the fetch tool is not a collection (TOOL-027)', () => {
    const list = findings('mslearn');
    expect(of(list, 'INJ-006')).toMatchObject([{ severity: 'info', tool: 'microsoft_docs_search' }]);
    expect(of(list, 'TOOL-027').map((f) => f.tool)).not.toContain('microsoft_docs_fetch');
  });

  it('Exa: a quoted "blog post" query tip is not a write (TOOL-014)', () => {
    const { raw } = loadReal('exa');
    expect(JSON.stringify(raw.tools)).toContain('blog post');
    expect(of(findings('exa'), 'TOOL-014')).toEqual([]);
    expect(of(findings('exa'), 'TOOL-027')).toEqual([]);
  });

  it('Svelte: APPS-014 ignores the ext-apps comment; long titles are clipped and flagged once per tool', () => {
    const list = findings('svelte');
    expect(of(list, 'APPS-014')).toEqual([]);
    for (const f of of(list, 'TOOL-014')) expect(f.severity).toBe('info');
    const t6 = of(list, 'TOOL-006');
    expect(t6.length).toBeGreaterThan(0);
    for (const f of t6) expect(f.message.length).toBeLessThan(160);
    expect(t6.filter((f) => f.severity === 'warning').every((f) => /linter-defined limit 60/.test(f.message))).toBe(true);
  });

  it('OpenZeppelin: templated GitHub links to *-upgradeable repos are not POL-004 upsells', () => {
    const { snap } = loadReal('openzeppelin');
    const html = JSON.stringify(snap.resourceReads);
    expect(html).toContain('tron-contracts-upgradeable/blob/v${q$}');
    expect(of(findings('openzeppelin'), 'POL-004')).toEqual([]);
  });

  it('AWS Knowledge: max_length/start_index and next_token bound the results (TOOL-027)', () => {
    const tools = of(findings('aws-knowledge'), 'TOOL-027').map((f) => f.tool);
    expect(tools).not.toContain('aws___read_documentation');
    expect(tools).not.toContain('aws___get_regional_availability');
  });
});
