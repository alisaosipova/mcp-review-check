// Regression tests for review 2026-11-01, work package WP8 (tool, schema, annotation and runtime rules).
import { describe, expect, it } from 'vitest';
import { annotationRules } from '../src/rules/annotations.js';
import { runtimeRules } from '../src/rules/runtime.js';
import { schemaRules, validateAgainst } from '../src/rules/schema.js';
import { toolRules } from '../src/rules/tools.js';
import type { ActiveCall, Snapshot } from '../src/snapshot.js';
import { evaluate, snap, tool, toolWithProps } from './helpers.js';

const all = [...toolRules, ...annotationRules, ...schemaRules, ...runtimeRules];
const byId = (id: string) => all.find((r) => r.id === id)!;
const one = (t: Record<string, unknown>) => snap({ tools: [t] });
const prop = (desc = 'A parameter') => ({ type: 'string', description: desc });
const messages = (id: string, s: Snapshot) => evaluate(byId(id), s).map((f) => f.message);

const text = (t: string) => ({ content: [{ type: 'text', text: t }] });
const call = (over: Partial<ActiveCall>): ActiveCall => ({ tool: 'search_notes', kind: 'synthetic', args: {}, durationMs: 50, ...over });
function active(calls: ActiveCall[], tools = [tool()]): Snapshot {
  return snap({ active: true, tools, set: (s) => { s.active = { calls }; } });
}

describe('F062 TOOL-017 and RT-006 accept http and https ids of every known dialect', () => {
  const ids = [
    'https://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft-07/schema',
    'http://json-schema.org/draft/2020-12/schema', 'https://json-schema.org/draft/2020-12/schema#',
    'http://json-schema.org/draft/2019-09/schema', 'https://json-schema.org/draft/2019-09/schema',
  ];
  for (const id of ids) {
    it(id, () => {
      const schema = { $schema: id, type: 'object', properties: { a: { type: 'string', description: 'A' } } };
      expect(messages('TOOL-017', one(tool({ inputSchema: schema })))).toEqual([]);
      expect(validateAgainst({ $schema: id, type: 'object', required: ['a'] }, {})).toMatch(/must have required property/);
    });
  }
  it('still reports an invalid schema under a non-canonical id', () => {
    expect(messages('TOOL-017', one(tool({ inputSchema: { $schema: 'https://json-schema.org/draft-07/schema#', type: 'strang' } })))).toHaveLength(1);
  });
});
