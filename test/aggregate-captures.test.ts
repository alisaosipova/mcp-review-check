// scripts/aggregate-captures.mjs: counts over the real-server captures, and no server name in its output.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { aggregate, lintCaptures, renderMarkdown, type CaptureResult } from '../scripts/aggregate-captures.mjs';

const f = (ruleId: string, severity: 'error' | 'warning' | 'info', platforms: string[], severityByPlatform?: Record<string, 'error' | 'warning' | 'info'>) =>
  ({ ruleId, severity, platforms, ...(severityByPlatform ? { severityByPlatform } : {}) });

describe('aggregate()', () => {
  const results: CaptureResult[] = [
    { capturedAt: '2026-10-22', findings: [f('TOOL-012', 'error', ['chatgpt']), f('TOOL-012', 'error', ['chatgpt']), f('TOOL-013', 'info', ['claude'])], verdicts: { claude: 'NO AUTOMATED BLOCKERS', chatgpt: 'BLOCKED' } },
    // An error that is only a warning on claude must not count as a claude blocker.
    { capturedAt: '2026-10-22', findings: [f('APPS-005', 'error', ['claude', 'chatgpt'], { claude: 'warning', chatgpt: 'error' }), f('TOOL-012', 'error', ['chatgpt'])], verdicts: { claude: 'NEEDS ATTENTION', chatgpt: 'BLOCKED' } },
    { capturedAt: '2026-10-23', findings: [], verdicts: { claude: 'NO AUTOMATED BLOCKERS', chatgpt: 'NO AUTOMATED BLOCKERS' } },
    { findings: [f('SRV-013', 'warning', ['spec'])] },
  ];
  const a = aggregate(results);

  it('counts servers, dates, severities and categories', () => {
    expect(a).toMatchObject({ servers: 4, findings: 6, capturedAt: { '2026-10-22': 2, '2026-10-23': 1, unknown: 1 }, bySeverity: { error: 4, warning: 1, info: 1 } });
    expect(a.byCategory).toEqual({ TOOL: { error: 3, warning: 0, info: 1 }, APPS: { error: 1, warning: 0, info: 0 }, SRV: { error: 0, warning: 1, info: 0 } });
  });

  it('counts each rule once per server and every finding', () => {
    expect(a.errorsByRule).toEqual({ 'TOOL-012': { servers: 2, findings: 3 }, 'APPS-005': { servers: 1, findings: 1 } });
    expect(a.warningsByRule).toEqual({ 'SRV-013': { servers: 1, findings: 1 } });
  });

  it('no automated blockers uses the directory own severity; a missing verdict is INCOMPLETE', () => {
    expect(a.noBlockers).toEqual({ claude: 4, chatgpt: 2, both: 2 });
    expect(a.verdicts.chatgpt).toEqual({ BLOCKED: 2, 'NEEDS ATTENTION': 0, 'NO AUTOMATED BLOCKERS': 1, INCOMPLETE: 1 });
    expect(a.verdicts.claude).toEqual({ BLOCKED: 0, 'NEEDS ATTENTION': 1, 'NO AUTOMATED BLOCKERS': 2, INCOMPLETE: 1 });
  });

  it('renders pure ASCII markdown', () => {
    const md = renderMarkdown(a);
    expect(md).toMatch(/\| chatgpt \| 2 of 4 \| 50% \|/);
    expect(md).toMatch(/\| TOOL-012 \| 2 \| 3 \|/);
    expect(/^[\x09\x0a\x20-\x7e]*$/.test(md)).toBe(true);
  });
});

describe('lintCaptures() on test/fixtures/real', () => {
  const dir = new URL('./fixtures/real/', import.meta.url);

  it('lints every capture offline and the rendered output names no server', async () => {
    const { results, rules } = await lintCaptures(dir);
    const files = readdirSync(dir).filter((n) => /\.json(\.br)?$/.test(n) && n !== 'baseline-findings.json');
    expect(results.length).toBe(files.length);
    expect(rules).toBeGreaterThan(0);
    for (const r of results) expect(r.rulesRun).toBeGreaterThan(0);
    const md = renderMarkdown(aggregate(results));
    // Every name a capture carries: file stem, serverInfo.name/title, URL host, tool and resource names.
    const names = new Set<string>();
    for (const n of files) {
      const p = new URL(n, dir);
      const raw = JSON.parse(n.endsWith('.br') ? brotliDecompressSync(readFileSync(p)).toString('utf8') : readFileSync(p, 'utf8'));
      names.add(n.replace(/\.json(\.br)?$/, ''));
      for (const s of [raw.serverInfo?.name, raw.serverInfo?.title, new URL(raw.source).hostname]) if (s) names.add(String(s));
      for (const t of [...raw.tools, ...raw.resources]) for (const s of [t.name, t.uri]) if (s) names.add(String(s));
    }
    for (const n of names) if (n.length > 3) expect(md.toLowerCase(), n).not.toContain(n.toLowerCase());
    expect(existsSync(new URL('../dist/rules/engine.js', import.meta.url))).toBe(true);
  });
});
