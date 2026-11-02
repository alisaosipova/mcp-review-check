// Regression tests for review 2026-11-01, wave 4 package W4B: TOOL-034 (tool list budget).
import { describe, expect, it } from 'vitest';
import { TOOL_LIST_MAX_BYTES, TOOL_LIST_MAX_COUNT } from '../src/limits.js';
import { toolRules } from '../src/rules/tools.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, snap, tool } from './helpers.js';

const byId = (id: string) => toolRules.find((r) => r.id === id)!;
const messages = (id: string, s: Snapshot) => evaluate(byId(id), s).map((f) => f.message);

describe('F080 TOOL-034 tool list budget', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => tool({ name: `search_notes_${i}` }));
  it('uses the limits.ts thresholds', () => {
    expect(TOOL_LIST_MAX_COUNT).toBe(40);
    expect(TOOL_LIST_MAX_BYTES).toBe(64 * 1024);
  });
  it('reports one finding per server, not per tool, over the count budget', () => {
    const f = evaluate(byId('TOOL-034'), snap({ tools: many(41) }));
    expect(f).toHaveLength(1);
    expect(f[0].tool).toBeUndefined();
    expect(f[0].severity).toBe('info');
    expect(f[0].message).toMatch(/41 tools \(budget 40\)/);
    expect(f[0].message).toMatch(/context tokens/);
    expect(f[0].message).toMatch(/Consolidate related tools or hide rarely used ones/);
  });
  it('40 small tools are within budget', () => {
    expect(messages('TOOL-034', snap({ tools: many(40) }))).toEqual([]);
  });
  it('reports a few tools whose definitions are over the size budget', () => {
    const big = (i: number) => tool({ name: `search_notes_${i}`, description: 'Search the Acme notes by keyword. '.repeat(500) });
    const f = messages('TOOL-034', snap({ tools: [big(1), big(2), big(3), big(4)] }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/KiB of tool definitions \(budget 64 KiB, roughly \d+k context tokens\)/);
    expect(f[0]).not.toMatch(/budget 40\)/);
  });
});

