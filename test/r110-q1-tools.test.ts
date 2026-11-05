// 1.1.0 Q1: TOOL-034 advice consistent with TOOL-024 (A05-08); tools.ts uses the shared enumValues/resolvedNode (1.0.1 deferral).
import { describe, expect, it } from 'vitest';
import { RULES } from '../src/rules/index.js';
import { enumValues } from '../src/rules/util/schemaWalk.js';
import { evaluate, snap, toolWithProps } from './helpers.js';

const byId = (id: string) => RULES.find((r) => r.id === id)!;

describe('A05-08 TOOL-034 fix does not recommend what TOOL-024 penalises', () => {
  it('the fix keeps reads and writes in separate tools and names TOOL-024', () => {
    const fix = byId('TOOL-034').fix;
    expect(fix).not.toMatch(/one tool with an `action` parameter/);
    expect(fix).toMatch(/reads and writes in separate tools/);
    expect(fix).toMatch(/TOOL-024/);
  });
  it('the TOOL-024 fix still says to split by action type', () => {
    expect(byId('TOOL-024').fix).toMatch(/Split the tool by action type/);
  });
});

describe('tools.ts uses the shared enumValues (open lists) and resolvedNode', () => {
  it('enumValues({open}) keeps the listed values beside a free branch; the closed form does not', () => {
    const node = { anyOf: [{ const: 'GET' }, { const: 'POST' }, { type: 'string' }] };
    expect(enumValues(node)).toBeUndefined();
    expect(enumValues(node, { open: true })).toEqual(['GET', 'POST']);
  });
  it('TOOL-023 still sees GET and POST in an open anyOf method list', () => {
    const t = toolWithProps('api_request', { method: { anyOf: [{ const: 'GET' }, { const: 'POST' }, { type: 'string' }], description: 'HTTP method' } });
    const f = evaluate(byId('TOOL-023'), snap({ tools: [t] }));
    expect(f.map((x) => x.message)).toEqual([expect.stringMatching(/both safe and unsafe HTTP methods \(GET, POST\)/)]);
  });
  it('TOOL-023 follows a two-step local $ref chain to the method enum (resolvedNode)', () => {
    const t = toolWithProps('api_request', { method: { $ref: '#/$defs/M', description: 'HTTP method' } });
    (t.inputSchema as Record<string, unknown>).$defs = { M: { $ref: '#/$defs/Verb' }, Verb: { type: 'string', enum: ['GET', 'DELETE'] } };
    const f = evaluate(byId('TOOL-023'), snap({ tools: [t] }));
    expect(f.map((x) => x.message)).toEqual([expect.stringMatching(/GET, DELETE/)]);
  });
});
