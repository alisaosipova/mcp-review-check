// W1-8 input caps (R-59). The caps module is loaded inside the tests that need it, so the speed check also runs
// (and fails on its assertion) on a tree without it.
import { describe, expect, it } from 'vitest';
import { RULES, runRules } from '../src/rules/index.js';
import { snap, tool } from './helpers.js';

const limits = () => import('../src/limits.js');

describe('input caps (W1-8)', () => {
  it('truncates oversized metadata and UI HTML, reports each truncation once', async () => {
    const { capSnapshot, HTML_CAP, limitsNotice, TEXT_CAP } = await limits();
    const s = snap({
      tools: [tool({ name: 'big', description: 'A '.repeat(40000), inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'x'.repeat(20000) } } } }), tool()],
      set: (x) => {
        x.instructions = 'i'.repeat(TEXT_CAP + 1);
        x.resourceReads['ui://a'] = { ok: true, durationMs: 1, raw: { contents: [{ uri: 'ui://a', text: '<img'.repeat(HTML_CAP / 2) }] } };
      },
    });
    const t = capSnapshot(s);
    expect(t.map((x) => x.where)).toEqual(['tool big', 'instructions', 'UI resource ui://a']);
    expect(t[0]).toMatchObject({ length: 80000, cap: TEXT_CAP });
    expect((s.tools[0].description as string).length).toBe(TEXT_CAP);
    expect(((s.tools[0].inputSchema as any).properties.q.description as string).length).toBe(TEXT_CAP);
    expect(((s.resourceReads['ui://a'].raw as any).contents[0].text as string).length).toBe(HTML_CAP);
    expect(s.limits?.truncated).toHaveLength(3);
    expect(limitsNotice(s)).toBe('3 oversized inputs truncated before pattern checks: tool big (80000 chars, cap 16 KB), instructions (16385 chars, cap 16 KB), UI resource ui://a (4194304 chars, cap 2 MB).');
  });

  it('pathological descriptions no longer take seconds in the rules (R-59: 80 000 characters under 2 s; API_NAMED was quadratic)', () => {
    // Free-form `sql` makes TOOL-026 look for a named API in the description; even uncapped, the rules stay linear.
    const s = snap({
      tools: Array.from({ length: 4 }, (_, i) => tool({
        name: `run_sql_${i}`, description: 'A '.repeat(40000),
        inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'SQL statement' } } },
      })),
    });
    const t0 = performance.now();
    runRules(s, RULES);
    expect(performance.now() - t0).toBeLessThan(2000);
  }, 120000);

  it('a clean snapshot is untouched and has no notice', async () => {
    const { capSnapshot, limitsNotice } = await limits();
    const s = snap();
    expect(capSnapshot(s)).toEqual([]);
    expect(s.limits).toBeUndefined();
    expect(limitsNotice(s)).toBeUndefined();
  });
});
