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

describe('F063 TOOL-023/025/026 resolve a $ref parameter before judging it', () => {
  const withRef = (name: string, key: string, target: Record<string, unknown>) => one(tool({
    name, description: 'Run it against the warehouse and return rows.', inputSchema: { type: 'object', properties: { [key]: { $ref: '#/$defs/T', description: 'X' } }, $defs: { T: target } },
  }));
  it('TOOL-023 sees the method enum kept in $defs', () => {
    const f = evaluate(byId('TOOL-023'), withRef('api_request', 'method', { type: 'string', enum: ['GET', 'POST', 'DELETE'] }));
    expect(f).toMatchObject([{ severity: 'error', message: expect.stringMatching(/both safe and unsafe/) }]);
    // the enum also counts when the tool name is not a generic HTTP name
    expect(evaluate(byId('TOOL-023'), withRef('manage_items', 'method', { type: 'string', enum: ['GET', 'DELETE'] }))).toHaveLength(1);
  });
  it('TOOL-025 does not call an enum behind $ref free-form', () => {
    expect(evaluate(byId('TOOL-025'), withRef('call_api', 'endpoint', { type: 'string', enum: ['/a', '/b'] }))).toEqual([]);
    expect(evaluate(byId('TOOL-025'), withRef('call_api', 'endpoint', { type: 'string' }))).toHaveLength(1);
  });
  it('TOOL-026 does not call an enum behind $ref free-form', () => {
    expect(evaluate(byId('TOOL-026'), withRef('run_query', 'sql', { type: 'string', enum: ['SELECT 1'] }))).toEqual([]);
    expect(evaluate(byId('TOOL-026'), withRef('run_query', 'sql', { type: 'string' }))).toHaveLength(1);
  });
});

describe('F065 TOOL-026 treats body/payload as a raw request only in a request context', () => {
  const t026 = (name: string, props: Record<string, unknown>, description: string) =>
    evaluate(byId('TOOL-026'), snap({ tools: [toolWithProps(name, props, { title: 'X', description })], set: (s) => { s.serverInfo = { name: 'mcp-server', version: '1' }; } }));
  it('message and issue text is not a raw request body', () => {
    expect(t026('create_issue', { repo: prop(), title: prop(), body: prop('Issue text') }, 'Create a new issue in the given repository with a title and body.')).toEqual([]);
    expect(t026('send_email', { to: prop(), body: prop('Mail text') }, 'Send an email.')).toEqual([]);
    expect(t026('post_message', { channel: prop(), payload: prop('Message text') }, 'Post a message to a channel.')).toEqual([]);
  });
  it('a body next to a method, URL or headers, or a free-form payload object, still counts', () => {
    expect(t026('send_request', { method: prop(), url: prop(), body: prop() }, 'Send a request.')).toHaveLength(1);
    expect(t026('send_request', { endpoint: { type: 'string', enum: ['/a'], description: 'E' }, body: prop() }, 'Send a request.')).toMatchObject([{ message: expect.stringMatching(/"body"/) }]);
    expect(t026('post_event', { payload: { type: 'object', description: 'Raw JSON' } }, 'Post an event.')).toHaveLength(1);
    // query languages need no context
    expect(t026('run_query', { sql: prop() }, 'Run a query.')).toHaveLength(1);
  });
});
//@@END
