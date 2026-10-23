import { describe, expect, it } from 'vitest';
import { annotationRules } from '../../src/rules/annotations.js';
import { schemaRules } from '../../src/rules/schema.js';
import { toolRules } from '../../src/rules/tools.js';
import { checkCase, evaluate, snap, tool, toolWithProps, type Case } from '../helpers.js';

const all = [...toolRules, ...annotationRules, ...schemaRules];
const one = (t: Record<string, unknown>) => snap({ tools: [t] });
const ok = one(tool());
const ann = (a: Record<string, unknown>, over: Record<string, unknown> = {}) => one(tool({ annotations: a, ...over }));
const prop = (desc = 'A parameter') => ({ type: 'string', description: desc });

const cases: Record<string, Case> = {
  'TOOL-001': { pos: one(tool({ name: 'search notes!' })), neg: one(tool({ name: 'notes.search_v2-beta' })), severity: 'warning' },
  // exactly 64 characters is allowed
  'TOOL-002': { pos: one(tool({ name: `search_${'x'.repeat(60)}` })), neg: one(tool({ name: `search_${'x'.repeat(57)}` })), severity: 'error' },
  'TOOL-003': { pos: snap({ tools: [tool(), tool()] }), neg: snap({ tools: [tool(), tool({ name: 'get_note' })] }), severity: 'error' },
  // "recommendations" is not the promotional word "recommended"
  'TOOL-004': { pos: one(tool({ name: 'best_search' })), neg: one(tool({ name: 'list_recommendations', title: 'List recommendations' })) },
  'TOOL-005': { pos: one(tool({ name: 'tool_1' })), neg: one(tool({ name: 'notes_v2_search' })), severity: 'info' },
  // a title in annotations.title only is enough
  'TOOL-006': { pos: one(tool({ title: undefined })), neg: ann({ title: 'Search notes', readOnlyHint: true, destructiveHint: false, openWorldHint: false }, { title: undefined }), severity: 'error' },
  // a terse description is TOOL-008's concern, not a missing one
  'TOOL-007': { pos: one(tool({ description: '  ' })), neg: one(tool({ description: 'Search notes.' })), severity: 'error' },
  'TOOL-008': { pos: one(tool({ description: 'Search notes' })), neg: one(tool({ description: 'Search Acme notes by keyword; returns ids and titles.' })), severity: 'warning' },
  'TOOL-009': {
    pos: one(toolWithProps('search_notes', { keywords: { type: 'string' }, limit: { type: 'integer', description: 'Max' } })), match: /keywords/,
    // a description on the $ref target counts; array items need no description of their own
    neg: one(tool({ inputSchema: { type: 'object', properties: { tag: { $ref: '#/$defs/Tag' }, ids: { type: 'array', description: 'Note ids', items: { type: 'string' } } }, $defs: { Tag: { type: 'string', description: 'Tag name' } } } })),
  },
  'TOOL-010': { pos: ann({ readOnlyHint: 'true', destructiveHint: false, openWorldHint: false }), neg: ann({ title: 'Search notes', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }), severity: 'error' },
  'TOOL-011': {
    pos: ann({ openWorldHint: false }), severity: 'error',
    neg: one(tool({ name: 'delete_note', description: 'Delete one note by id.', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } })),
  },
  // explicit false values count as declared
  'TOOL-012': { pos: ann({ readOnlyHint: true, destructiveHint: false }), neg: ann({ readOnlyHint: false, destructiveHint: false, openWorldHint: false }, { name: 'add_tag' }), match: /openWorldHint/ },
  'TOOL-013': {
    pos: ann({ readOnlyHint: true, destructiveHint: true, openWorldHint: false }), severity: 'error',
    neg: one(tool({ name: 'update_note', description: 'Replace the body of a note.', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } })),
  },
  'TOOL-014': { pos: one(tool({ name: 'delete_note', description: 'Deletes a note forever from the workspace.' })), neg: ok, severity: 'warning' },
  'TOOL-015': {
    pos: one(toolWithProps('get_page', { url: prop('Page URL') }, { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })),
    neg: one(toolWithProps('get_page', { url: { type: 'string', description: 'Docs URL', pattern: '^https://docs\\.acme\\.test/' } })),
  },
  // a tool without parameters still declares an object schema
  'TOOL-016': { pos: one(tool({ inputSchema: { type: 'array' } })), neg: one(tool({ name: 'list_folders', inputSchema: { type: 'object', properties: {} } })), severity: 'error' },
  'TOOL-017': {
    pos: one(tool({ inputSchema: { type: 'object', properties: { a: { type: 'strang' } } } })), severity: 'error',
    neg: one(tool({ inputSchema: { type: 'object', properties: { due: { type: ['string', 'null'], format: 'date', description: 'Due date' }, n: { type: 'integer', minimum: 1, description: 'Count' } } } })),
  },
  'TOOL-018': { pos: one(tool({ inputSchema: { type: 'object' } })), neg: one(tool({ inputSchema: { type: 'object', additionalProperties: false } })), severity: 'info' },
  'TOOL-019': {
    pos: one(toolWithProps('get_profile', { address: { $ref: 'https://schemas.acme.test/address.json', description: 'x' } })),
    neg: one(tool({ inputSchema: { type: 'object', properties: { a: { $ref: '#/$defs/A', description: 'A' } }, $defs: { A: { type: 'string' } } } })),
  },
  'TOOL-020': {
    pos: one(tool({ inputSchema: Array.from({ length: 12 }).reduce<Record<string, unknown>>((inner) => ({ type: 'object', properties: { n: inner } }), { type: 'string' }) })),
    // ten levels deep is still within bounds
    neg: one(tool({ inputSchema: Array.from({ length: 8 }).reduce<Record<string, unknown>>((inner) => ({ type: 'object', properties: { n: inner } }), { type: 'string' }) })), severity: 'info',
  },
  'TOOL-021': {
    pos: one(toolWithProps('get_note', { id: { type: 'object', description: 'Id', 'x-mcp-header': 'Note Id' } })),
    neg: one(toolWithProps('get_note', { region: { type: 'string', description: 'Region', 'x-mcp-header': 'X-Region' } })), severity: 'error',
  },
  'TOOL-022': {
    pos: one(toolWithProps('get_note', { api_key: { type: 'string', description: 'Key', 'x-mcp-header': 'X-Api-Key' } })),
    neg: one(toolWithProps('get_note', { region: { type: 'string', description: 'Region', 'x-mcp-header': 'X-Region' } })),
  },
  'TOOL-023': {
    pos: one(toolWithProps('api_request', { method: { type: 'string', enum: ['GET', 'DELETE'], description: 'Method' } })),
    neg: one(toolWithProps('get_invoice', { method: { type: 'string', enum: ['card', 'bank'], description: 'Payment method' } })), severity: 'error',
  },
  'TOOL-024': {
    pos: one(toolWithProps('manage_notes', { action: { type: 'string', enum: ['get', 'delete'], description: 'Action' } })),
    // entity-type `type` enum is not a verb enum (false-positive guard)
    neg: one(toolWithProps('search_records', { type: { type: 'string', enum: ['invoice', 'customer', 'order_line'], description: 'Record type' }, limit: prop() })),
    severity: 'warning',
  },
  'TOOL-025': {
    pos: snap({ tools: [
      toolWithProps('list_operations', {}),
      toolWithProps('do_thing', { operation_id: prop('Op'), args: { type: 'object', additionalProperties: true, description: 'Args' } }),
    ] }), severity: 'error',
    // a discovery tool next to typed per-operation tools is not a dispatcher
    neg: snap({ tools: [
      toolWithProps('list_operations', {}),
      toolWithProps('get_operation', { operation_id: prop('Op'), fields: { type: 'array', items: { type: 'string' }, description: 'Fields' } }),
    ] }),
  },
  'TOOL-026': {
    pos: one(toolWithProps('run_query', { sql: prop('SQL text') }, { title: 'Run query', description: 'Run a query against the warehouse and return rows.' })),
    neg: one(toolWithProps('run_query', { sql: prop('SQL text') }, { description: 'Run a read-only query against the Acme Warehouse API and return rows.' })),
  },
  'TOOL-027': {
    pos: one(toolWithProps('list_notes', { folder: prop() })), severity: 'info',
    // Exa: numResults bounds the search
    neg: one(toolWithProps('web_search_exa', { query: prop('Query'), numResults: { type: 'integer', description: 'Results' } })),
  },
  'TOOL-028': { pos: one(toolWithProps('get_note', { id: prop() })), neg: one(toolWithProps('get_note', { id: prop(), include_body: { type: 'boolean', description: 'Include the body' } })), severity: 'info' },
  'TOOL-029': {
    pos: one(tool({ _meta: { 'openai/toolInvocation/invoking': 'x'.repeat(65) } })),
    neg: one(tool({ _meta: { 'openai/toolInvocation/invoking': 'Searching…' } })), severity: 'error',
  },
  'TOOL-030': {
    pos: one(toolWithProps('upload_doc', { file: { type: 'object', description: 'File', properties: { download_url: { type: 'string' } } } }, { _meta: { 'openai/fileParams': ['file'] } })),
    neg: one(toolWithProps('upload_doc', {
      file: {
        type: 'object', description: 'File', required: ['download_url', 'file_id'],
        properties: { download_url: { type: 'string' }, file_id: { type: 'string' }, mime_type: { type: 'string' }, file_name: { type: 'string' } },
      },
    }, { _meta: { 'openai/fileParams': ['file'] } })),
  },
  'TOOL-031': {
    pos: one(tool({ name: 'get_me', _meta: { 'openai/profile': true }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } })),
    neg: one(tool({
      name: 'get_me', inputSchema: { type: 'object', additionalProperties: false }, _meta: { 'openai/profile': true },
      outputSchema: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } }, required: ['id'], additionalProperties: false },
    })),
    severity: 'error',
  },
  'TOOL-032': {
    pos: one(tool({ securitySchemes: [{ type: 'basic' }] })),
    neg: one(tool({ securitySchemes: [{ type: 'oauth2', scopes: ['notes.read'] }] })), severity: 'error',
  },
};

describe('TOOL rules', () => {
  it('has a case for every rule', () => expect(Object.keys(cases).sort()).toEqual(all.map((r) => r.id).sort()));
  for (const rule of all) it(`${rule.id} ${rule.title}`, () => checkCase(rule, cases[rule.id]));

  const byId = (id: string) => all.find((r) => r.id === id)!;

  it('a clean snapshot (one good tool) gives no finding for any rule: the negative baseline the near-miss cases replaced', () => {
    for (const rule of all) expect(evaluate(rule, ok, true).map((f) => f.message), rule.id).toEqual([]);
  });

  it('TOOL-001 non-string name is an error', () => {
    expect(evaluate(byId('TOOL-001'), one(tool({ name: 42 })))[0].severity).toBe('error');
  });

  it('TOOL-003 case-only duplicates are info', () => {
    const f = evaluate(byId('TOOL-003'), snap({ tools: [tool({ name: 'Get_Note' }), tool({ name: 'get_note' })] }));
    expect(f.map((x) => x.severity)).toEqual(['info']);
  });

  it('TOOL-006 long title: info with a snippet; differing titles are shown as snippets (Svelte, Hugging Face)', () => {
    const long = 'Hugging Face Hub: Find, use and view models, datasets, spaces, buckets, papers, documentation and collections. Get daily papers reports.';
    const f = evaluate(byId('TOOL-006'), one(tool({ title: undefined, annotations: { title: long, readOnlyHint: true } })));
    // D-6: the 60-character limit has no public source, so a long title is info, not a warning
    expect(f).toMatchObject([{ severity: 'info', platforms: ['claude'], message: expect.stringMatching(/^title is \d+ characters \(linter-defined limit 60\): "Hugging Face Hub: Find, use .*…"$/) }]);
    expect(f[0].message.length).toBeLessThan(140);
    const both = evaluate(byId('TOOL-006'), one(tool({ title: 'x'.repeat(1191), annotations: { title: 'Get documentation', readOnlyHint: true } })));
    expect(both.map((x) => x.message.length).every((n) => n < 160)).toBe(true);
    expect(evaluate(byId('TOOL-006'), one(tool({ title: 'Search notes in the shared Acme workspace by keyword or tag' })))).toEqual([]);
  });

  it('TOOL-007 missing description is a Claude error too', () => {
    const f = evaluate(byId('TOOL-007'), one(tool({ description: undefined })));
    expect(f[0].severityByPlatform).toMatchObject({ claude: 'error', chatgpt: 'error', spec: 'info' });
  });

  it('TOOL-027 limit-like parameters and no "query"/"all" triggers (AWS, MS Learn)', () => {
    const t = byId('TOOL-027');
    const docs = (name: string, props: Record<string, unknown>, description: string) => one(toolWithProps(name, props, { description }));
    expect(evaluate(t, docs('microsoft_docs_fetch', { url: prop('Page URL') }, 'Fetch a Microsoft Learn page as markdown. Use when search results are incomplete. Returns all content of the page.'))).toEqual([]);
    // a name without a verb still falls back to the description
    expect(evaluate(t, docs('hub_repos', { q: prop('Words') }, 'Search the Hub and list matching repositories.'))).toHaveLength(1);
    expect(evaluate(t, docs('query_metrics', { expr: prop('PromQL') }, 'Run a query against the metrics store.'))).toEqual([]);
    for (const p of ['max_length', 'start_index', 'max_tokens', 'maxCharacters', 'page_token', 'top_k']) {
      expect(evaluate(t, docs('search_docs', { phrase: prop('Words'), [p]: { type: 'integer', description: 'Bound' } }, 'Search the docs.')), p).toEqual([]);
    }
    expect(evaluate(t, docs('search_docs', { phrase: prop('Words') }, 'Search the docs.'))).toHaveLength(1);
  });

  it('TOOL-006 differing title and annotations.title is spec info', () => {
    const f = evaluate(byId('TOOL-006'), one(tool({ title: 'A', annotations: { title: 'B', readOnlyHint: true } })));
    expect(f).toMatchObject([{ severity: 'info', platforms: ['spec'] }]);
  });

  it('TOOL-008 does not double-report when TOOL-007 fires', () => {
    expect(evaluate(byId('TOOL-008'), one(tool({ description: undefined })))).toEqual([]);
  });

  it('TOOL-011 readOnlyHint false without destructiveHint is a warning', () => {
    expect(evaluate(byId('TOOL-011'), ann({ readOnlyHint: false }))[0].severity).toBe('warning');
  });

  it('TOOL-012 emits one finding per missing hint', () => {
    expect(evaluate(byId('TOOL-012'), ann({}))).toHaveLength(3);
  });

  it('TOOL-013 idempotentHint on read-only tool is spec info', () => {
    const f = evaluate(byId('TOOL-013'), ann({ readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }));
    expect(f).toMatchObject([{ severity: 'info', platforms: ['spec'] }]);
  });

  it('TOOL-014 covers (a) readOnly write verb, (c) read verb destructive, (d) irreversible, (e) missing readOnlyHint', () => {
    const t = byId('TOOL-014');
    expect(evaluate(t, one(tool({ name: 'send_email', description: 'Send an email to someone.' })))[0].message).toMatch(/write verb "send"/);
    expect(evaluate(t, ann({ readOnlyHint: false, destructiveHint: true, openWorldHint: false }))[0].message).toMatch(/read verb/);
    const d = evaluate(t, one(tool({ name: 'cancel_order', description: 'Cancel an order.', annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } })));
    expect(d.some((x) => x.platforms.includes('chatgpt') && /irreversible/.test(x.message))).toBe(true);
    const e = evaluate(t, ann({ destructiveHint: false, openWorldHint: false }));
    expect(e).toMatchObject([{ platforms: ['spec'] }]);
  });

  it('TOOL-017 unknown $schema dialect is a warning', () => {
    const f = evaluate(byId('TOOL-017'), one(tool({ inputSchema: { $schema: 'https://example.test/my-dialect', type: 'object' } })));
    expect(f[0].severity).toBe('warning');
  });

  it('TOOL-017 accepts draft-07 schemas (what SDKs emit)', () => {
    expect(evaluate(byId('TOOL-017'), one(tool({ inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { a: { type: 'string' } } } })))).toEqual([]);
  });

  it('TOOL-021 non-properties chain and duplicates are errors', () => {
    const f = evaluate(byId('TOOL-021'), one(tool({
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'string', 'x-mcp-header': 'X-A' },
          b: { type: 'string', 'x-mcp-header': 'x-a' },
          list: { type: 'array', items: { type: 'string', 'x-mcp-header': 'X-Item' } },
        },
      },
    })));
    expect(f.map((x) => x.message).join('\n')).toMatch(/duplicates/);
    expect(f.map((x) => x.message).join('\n')).toMatch(/plain properties chain/);
  });

  it('TOOL-023 free method string on an api_request tool is a warning; name alone is info', () => {
    expect(evaluate(byId('TOOL-023'), one(toolWithProps('api_request', { method: prop() })))[0].severity).toBe('warning');
    expect(evaluate(byId('TOOL-023'), one(toolWithProps('call_api', { path: prop() })))[0].severity).toBe('info');
  });

  it('TOOL-024 many modes: chatgpt warning; groups: claude info', () => {
    const f = evaluate(byId('TOOL-024'), one(toolWithProps('manage', { op: { type: 'string', enum: ['create', 'update', 'delete', 'archive'], description: 'x' } })));
    expect(f.some((x) => x.platforms.includes('chatgpt') && x.severity === 'warning')).toBe(true);
    expect(f.some((x) => x.platforms.includes('claude') && x.severity === 'info')).toBe(true);
  });

  it('TOOL-024 data-type enums (Redis key types) on a read tool are not mode switches', () => {
    expect(evaluate(byId('TOOL-024'), one(toolWithProps('scan_keys', { type: { type: 'string', enum: ['string', 'list', 'set', 'hash', 'zset'], description: 'Key type' } })))).toEqual([]);
    expect(evaluate(byId('TOOL-024'), one(toolWithProps('render', { mode: { type: 'string', enum: ['list', 'set'], description: 'Layout' } })))).toEqual([]);
  });

  it('TOOL-026 natural-language queries and filesystem paths are not raw API parameters', () => {
    expect(evaluate(byId('TOOL-026'), one(toolWithProps('search_documentation', { query: prop('What to look for') }, { title: 'Search docs', description: 'Search the Cloudflare documentation.' })))).toEqual([]);
    expect(evaluate(byId('TOOL-026'), one(toolWithProps('read_file', { path: prop('File path') }, { title: 'Read file', description: 'Read a file from disk.' })))).toEqual([]);
    // url next to a method parameter is a raw request builder
    expect(evaluate(byId('TOOL-026'), one(toolWithProps('do_request', { method: prop('Verb'), url: prop('Target') }, { title: 'Request', description: 'Send a request.' })))).toHaveLength(1);
    // the product named in the description identifies the target
    const named = snap({ tools: [toolWithProps('run_query', { sql: prop('SQL') }, { title: 'Run query', description: 'Run SQL against your Snowflake warehouse.' })], set: (s) => { s.serverInfo = { name: 'snowflake-mcp', version: '1' }; } });
    expect(evaluate(byId('TOOL-026'), named)).toEqual([]);
  });

  it('TOOL-015 bounded private-account tools: date ranges, graph edges and mailbox reads are not open-world', () => {
    const closed = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    expect(evaluate(byId('TOOL-015'), one(toolWithProps('list_events', { from: { type: 'string', format: 'date', description: 'Start' }, to: { type: 'string', format: 'date', description: 'End' } }, { annotations: closed })))).toEqual([]);
    expect(evaluate(byId('TOOL-015'), one(toolWithProps('search_email', { q: prop('Search text') }, { annotations: closed })))).toEqual([]);
    expect(evaluate(byId('TOOL-015'), one(toolWithProps('create_relations', { to: prop('Entity name') }, { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } })))).toEqual([]);
    // sending to an arbitrary recipient is open-world
    const send = one(toolWithProps('send_email', { to: prop('Recipient') }, { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }));
    expect(evaluate(byId('TOOL-015'), send)).toHaveLength(1);
  });

  it('TOOL-008/027/028 share one read/write classifier', () => {
    const noHints = (name: string, description: string) => one(toolWithProps(name, { id: prop() }, { annotations: undefined, description }));
    // a read verb without hints is not called a "write tool"
    expect(evaluate(byId('TOOL-008'), noHints('getTinyImage', 'Returns a small test image for clients.'))).toEqual([]);
    expect(evaluate(byId('TOOL-008'), noHints('echo', 'Returns the input text as it was given.'))[0].message).toMatch(/tool without readOnlyHint/);
    // a create tool whose description says "lists" is not a collection read
    expect(evaluate(byId('TOOL-027'), noHints('create_entities', 'Create multiple entities from lists of names.'))).toEqual([]);
  });

  it('TOOL-017 invalid regular expressions are still reported without a full compile', () => {
    const f = evaluate(byId('TOOL-017'), one(toolWithProps('get_note', { id: { type: 'string', pattern: '[', description: 'Id' } })));
    expect(f[0].message).toMatch(/does not compile: Invalid regular expression/);
  });

  it('TOOL-025 executor name with free operation string is a warning', () => {
    expect(evaluate(byId('TOOL-025'), one(toolWithProps('execute_operation', { operation: prop() })))[0].severity).toBe('warning');
  });

  it('TOOL-027 full dump wording is a warning', () => {
    expect(evaluate(byId('TOOL-027'), one(toolWithProps('export_notes', { folder: prop() }, { description: 'Export a full dump of every note in the workspace.' })))[0].severity).toBe('warning');
  });

  it('TOOL-029 UI tool without status strings is info', () => {
    expect(evaluate(byId('TOOL-029'), one(tool({ _meta: { ui: { resourceUri: 'ui://x' } } })))[0].severity).toBe('info');
  });

  it('TOOL-032 OAuth server without securitySchemes is info; unknown scope is a warning', () => {
    const oauth = (t: Record<string, unknown>) => snap({ tools: [t], set: (s) => { s.authProbe = { trigger: 'preflight-401', prmAttempts: [], as: [], timings: {}, prm: { url: 'x', via: 'header', json: { scopes_supported: ['notes.read'] } } }; } });
    expect(evaluate(byId('TOOL-032'), oauth(tool()))[0].severity).toBe('info');
    expect(evaluate(byId('TOOL-032'), oauth(tool({ securitySchemes: [{ type: 'oauth2', scopes: ['admin'] }] })))[0].severity).toBe('warning');
  });
});
