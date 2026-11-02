// Regression tests for review 2026-11-01, wave 4 package W4B: TOOL-033 (vendor API tool-name pattern) and TOOL-002 on chatgpt.
import { describe, expect, it } from 'vitest';
import { RULES } from '../src/rules/index.js';
import { toolRules } from '../src/rules/tools.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, snap, tool } from './helpers.js';

const byId = (id: string) => toolRules.find((r) => r.id === id)!;
const one = (t: Record<string, unknown>) => snap({ tools: [t] });
const messages = (id: string, s: Snapshot) => evaluate(byId(id), s).map((f) => f.message);

describe('F076 TOOL-033 tool name matches the vendor API pattern', () => {
  it('is registered for claude and chatgpt as error, with both vendor docs as sources', () => {
    const r = RULES.find((x) => x.id === 'TOOL-033')!;
    expect(r.severity).toEqual({ claude: 'error', chatgpt: 'error' });
    expect(r.sources.join(' ')).toMatch(/platform\.claude\.com\/docs\/en\/agents-and-tools\/tool-use\/define-tools/);
    expect(r.sources.join(' ')).toMatch(/developers\.openai\.com\/api\/reference/);
  });
  it('reports a dot the MCP specification allows, and lists each offending character once with the limit', () => {
    const f = evaluate(byId('TOOL-033'), one(tool({ name: 'notes.search v2.x' })));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
    expect([...f[0].platforms].sort()).toEqual(['chatgpt', 'claude']);
    expect(f[0].message).toBe('name contains "." " "; allowed: A-Z a-z 0-9 _ - (Claude API ^[a-zA-Z0-9_-]{1,128}$, OpenAI API 1-64 characters)');
  });
  it('reports non-ASCII letters and slashes', () => {
    expect(messages('TOOL-033', one(tool({ name: 'zametki/poisk_é' })))[0]).toMatch(/^name contains "\/" "é"; /);
  });
  it('accepts letters, digits, underscore and dash; leaves length to TOOL-002 and a non-string name to TOOL-001', () => {
    expect(messages('TOOL-033', one(tool({ name: 'Search-notes_V2' })))).toEqual([]);
    expect(messages('TOOL-033', one(tool({ name: `search_${'x'.repeat(100)}` })))).toEqual([]);
    expect(messages('TOOL-033', one(tool({ name: 42 })))).toEqual([]);
  });
  it('reports an empty name', () => {
    expect(messages('TOOL-033', one(tool({ name: '' })))[0]).toMatch(/^tool name is empty; allowed/);
  });
});

describe('F076 TOOL-002 applies to chatgpt too (OpenAI function names are at most 64 characters)', () => {
  it('is an error on both platforms', () => {
    const r = RULES.find((x) => x.id === 'TOOL-002')!;
    expect(r.severity).toEqual({ claude: 'error', chatgpt: 'error' });
    const f = evaluate(r, snap({ target: 'chatgpt', tools: [tool({ name: `search_${'x'.repeat(58)}` })] }));
    expect(f).toMatchObject([{ severity: 'error', platforms: ['chatgpt'], message: 'name is 65 characters (> 64)' }]);
    expect(evaluate(r, snap({ target: 'chatgpt', tools: [tool({ name: `search_${'x'.repeat(57)}` })] }))).toEqual([]);
  });
});

