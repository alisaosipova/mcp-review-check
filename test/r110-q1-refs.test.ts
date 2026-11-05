// 1.1.0 Q1: an unresolvable $ref is reported (TOOL-036, review A05-05).
import { describe, expect, it } from 'vitest';
import { schemaRules, unresolvedRefs } from '../src/rules/schema.js';
import { explainRule } from '../src/explain.js';
import { evaluate, snap, tool } from './helpers.js';

const rule = schemaRules.find((r) => r.id === 'TOOL-036')!;
const run = (inputSchema: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  evaluate(rule, snap({ tools: [tool({ inputSchema, ...extra })] })).map((f) => f.message);
const obj = (props: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ type: 'object', properties: props, ...more });

describe('A05-05 TOOL-036 unresolvable $ref', () => {
  it('the review repro: a dangling local pointer and a relative file ref without a base', () => {
    expect(run(obj({ item: { $ref: '#/$defs/Missing' } }))).toEqual(['inputSchema/properties/item $ref "#/$defs/Missing" names no subschema in the document']);
    expect(run(obj({ item: { $ref: 'common.json#/$defs/Item' } }))).toEqual(['inputSchema/properties/item $ref "common.json#/$defs/Item" is relative, and the schema has no absolute $id to resolve it against']);
  });
  it('a missing anchor and a missing $dynamicRef anchor; an outputSchema too', () => {
    expect(run(obj({ a: { $ref: '#item' }, b: { $dynamicRef: '#meta' } }))).toHaveLength(2);
    const out = evaluate(rule, snap({ tools: [tool({ outputSchema: { type: 'object', properties: { x: { $ref: '#/definitions/X' } } } })] }));
    expect(out.map((f) => f.path)).toEqual(['outputSchema/properties/x']);
  });
  it('resolvable references are fine', () => {
    expect(run(obj({ a: { $ref: '#/$defs/A' }, b: { $ref: '#/definitions/B' }, c: { $ref: '#' }, d: { $ref: '#item' }, e: { $ref: '#/$defs/A%20B' }, f: { $dynamicRef: '#meta' } }, {
      $defs: { A: { type: 'string' }, 'A B': { type: 'string' }, I: { $anchor: 'item', type: 'string' } }, definitions: { B: { type: 'integer' } }, $dynamicAnchor: 'meta',
    }))).toEqual([]);
    // draft-07 plain-name $id
    expect(run(obj({ a: { $ref: '#addr' } }, { definitions: { Addr: { $id: '#addr', type: 'string' } } }))).toEqual([]);
  });
  it('a relative ref against an absolute base $id: the own document is judged, another is TOOL-019', () => {
    const base = 'https://acme.test/schemas/notes.json';
    expect(run(obj({ a: { $ref: 'notes.json#/$defs/Missing' } }, { $id: base }))).toEqual([expect.stringMatching(/names no subschema/)]);
    expect(run(obj({ a: { $ref: 'notes.json#/$defs/A' } }, { $id: base, $defs: { A: { type: 'string' } } }))).toEqual([]);
    expect(run(obj({ a: { $ref: 'other.json' } }, { $id: base }))).toEqual([]);
    expect(run(obj({ a: { $ref: 'https://other.test/x.json' } }))).toEqual([]);
  });
  it('an embedded resource with its own $id: refs to it and inside it are not judged', () => {
    expect(run(obj({ a: { $ref: 'item.json' } }, { $defs: { Item: { $id: 'item.json', type: 'object', properties: { x: { $ref: '#/$defs/Inner' } }, $defs: { Inner: { type: 'string' } } } } }))).toEqual([]);
  });
  it('$ref-shaped data in enum, default, examples and x- extensions is not a reference', () => {
    expect(run(obj({ a: { type: 'object', default: { $ref: '#/nope' }, examples: [{ $ref: '#/nope' }], enum: [{ $ref: '#/nope' }] } }, { 'x-openapi': { $ref: '#/components/schemas/X' } }))).toEqual([]);
  });
  it('property and $defs names that look like data keywords or x- are walked (review R110-Q1-01)', () => {
    expect(run(obj({ default: { $anchor: 'cfg', type: 'object' }, other: { $ref: '#cfg' } }))).toEqual([]);
    expect(run(obj({ a: { $ref: '#ex' }, b: { $ref: 'ext.json' } }, { $defs: { example: { $anchor: 'ex' }, 'x-ext': { $id: 'ext.json' } } }))).toEqual([]);
    expect(run(obj({ default: { $ref: '#/$defs/Missing' }, enum: { $ref: '#/$defs/Missing2' } }))).toEqual([
      'inputSchema/properties/default $ref "#/$defs/Missing" names no subschema in the document',
      'inputSchema/properties/enum $ref "#/$defs/Missing2" names no subschema in the document',
    ]);
    expect(run(obj({}, { patternProperties: { 'x-.*': { $ref: '#/$defs/Gone' } }, dependentSchemas: { examples: { $ref: '#/$defs/Gone2' } } }))).toHaveLength(2);
    // inside a named property, keyword positions still skip data
    expect(run(obj({ default: { type: 'object', default: { $ref: '#/nope' } } }))).toEqual([]);
  });
  it('a cyclic schema terminates', () => {
    const a: Record<string, unknown> = { type: 'object' };
    a.properties = { self: a };
    expect(unresolvedRefs(a)).toEqual([]);
  });
  it('has docs: explain names the rule, a source and the fix', () => {
    const text = explainRule('TOOL-036')!;
    expect(text).toMatch(/Every \$ref resolves inside the schema/);
    expect(text).toMatch(/spec=warning/);
    expect(text).toMatch(/https:\/\/modelcontextprotocol\.io\/specification\/2026-07-28\/basic#ref-resolution/);
  });
});
