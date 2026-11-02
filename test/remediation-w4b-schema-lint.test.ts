// Regression tests for review 2026-11-01, wave 4 package W4B: TOOL-035 (schema lint) and TOOL-020 over outputSchema.
import { describe, expect, it } from 'vitest';
import { editDistanceOne, keywordTypo, schemaRules } from '../src/rules/schema.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, snap, tool } from './helpers.js';

const byId = (id: string) => schemaRules.find((r) => r.id === id)!;
const one = (t: Record<string, unknown>) => snap({ tools: [t] });
const messages = (id: string, s: Snapshot) => evaluate(byId(id), s).map((f) => f.message);
const input = (schema: Record<string, unknown>) => one(tool({ inputSchema: schema }));

describe('F079 TOOL-035 schema lint', () => {
  it('flags a required entry naming an undeclared property', () => {
    const f = evaluate(byId('TOOL-035'), input({ type: 'object', properties: { query: { type: 'string', description: 'Q' } }, required: ['query', 'qeury'] }));
    expect(f).toMatchObject([{ severity: 'info', path: 'inputSchema', message: 'inputSchema requires "qeury", not declared in properties' }]);
  });
  it('accepts required names that the schema admits through additionalProperties, patternProperties or composition', () => {
    const base = { type: 'object', properties: { query: { type: 'string' } }, required: ['query', 'extra'] };
    expect(messages('TOOL-035', input({ ...base, additionalProperties: true }))).toEqual([]);
    expect(messages('TOOL-035', input({ ...base, additionalProperties: { type: 'string' } }))).toEqual([]);
    expect(messages('TOOL-035', input({ ...base, patternProperties: { '^x': { type: 'string' } } }))).toEqual([]);
    expect(messages('TOOL-035', input({ ...base, allOf: [{ properties: { extra: { type: 'string' } } }] }))).toEqual([]);
    // anyOf branches that only list required names see the parent's properties
    expect(messages('TOOL-035', input({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, anyOf: [{ required: ['a'] }, { required: ['b'] }] }))).toEqual([]);
  });
  it('checks nested schemas (properties, items, $defs) and outputSchema', () => {
    const nested = { type: 'object', properties: { filter: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tags'] } } };
    expect(messages('TOOL-035', input(nested))).toEqual(['inputSchema requires "tags", not declared in properties']);
    expect(evaluate(byId('TOOL-035'), input(nested))[0].path).toBe('inputSchema/properties/filter');
    const out = one(tool({ outputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['ID'] } } } } }));
    expect(messages('TOOL-035', out)).toEqual(['outputSchema requires "ID", not declared in properties']);
    const defs = input({ type: 'object', properties: { n: { $ref: '#/$defs/N' } }, $defs: { N: { type: 'object', propeties: { a: { type: 'string' } } } } });
    expect(messages('TOOL-035', defs)).toEqual(['inputSchema has "propeties", probably a misspelling of "properties" (ignored by validators)']);
  });
  it('flags misspelt keywords one edit away, including an adjacent swap and a singular form', () => {
    const typos = input({ type: 'object', properties: { q: { type: 'string', maxLenght: 5 } }, require: ['q'], additionalProperty: false });
    expect(messages('TOOL-035', typos).sort()).toEqual([
      'inputSchema has "additionalProperty", probably a misspelling of "additionalProperties" (ignored by validators)',
      'inputSchema has "maxLenght", probably a misspelling of "maxLength" (ignored by validators)',
      'inputSchema has "require", probably a misspelling of "required" (ignored by validators)',
    ]);
    expect(keywordTypo('requried')).toBe('required');
    expect(keywordTypo('readonly')).toBe('readOnly');
  });
  it('does not treat property names as keywords, and ignores x- extensions and unrelated keys', () => {
    // a parameter called "require" or "propeties" is a property name, not a keyword
    const s = input({ type: 'object', properties: { require: { type: 'boolean' }, propeties: { type: 'string' }, titles: { type: 'array', items: { type: 'string' } } }, 'x-requires': ['a'] });
    expect(messages('TOOL-035', s)).toEqual([]);
    for (const k of ['type', 'enum', 'examples', 'example', 'nullable', 'contentMediaType', 'markdownDescription', 'enumDescriptions', 'x-ui']) expect(keywordTypo(k), k).toBeUndefined();
    // short keywords are not typo targets (one edit from "if", "not", "type" is often a real word)
    expect(keywordTypo('typo')).toBeUndefined();
  });
  it('flags a format outside the JSON Schema and OpenAPI vocabularies', () => {
    const s = input({ type: 'object', properties: { site: { type: 'string', format: 'url' }, at: { type: 'string', format: 'date-time' }, n: { type: 'integer', format: 'int64' } } });
    expect(messages('TOOL-035', s)).toEqual(['inputSchema uses format "url", not a JSON Schema 2020-12 or OpenAPI registry format']);
  });
  it('a typical tool schema is clean', () => {
    expect(messages('TOOL-035', one(tool()))).toEqual([]);
  });
  it('editDistanceOne', () => {
    expect(editDistanceOne('propeties', 'properties')).toBe(true);
    expect(editDistanceOne('requireds', 'required')).toBe(true);
    expect(editDistanceOne('maximum', 'minimum')).toBe(false);
    expect(editDistanceOne('same', 'same')).toBe(false);
  });
});

describe('F079 TOOL-020 runs over outputSchema (confirmed)', () => {
  const wide = { type: 'object', properties: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}`, { type: 'string' }])) };
  it('a huge outputSchema is reported by name; the same schema as inputSchema too', () => {
    expect(messages('TOOL-020', one(tool({ outputSchema: wide })))).toEqual(['outputSchema depth 1, 202 subschemas']);
    expect(messages('TOOL-020', one(tool({ inputSchema: wide })))).toEqual(['inputSchema depth 1, 202 subschemas']);
  });
});
