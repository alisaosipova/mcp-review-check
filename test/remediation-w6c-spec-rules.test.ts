// Regression tests for wave 6 package W6C (0.4.0): SPEC-021 deprecated features, SPEC-022 serverInfo in result _meta,
// SPEC-023 capabilities.extensions, and the AUTH-012 DCR-deprecation message (MCP 2026-07-28, MARKET §3.12).
import { describe, expect, it } from 'vitest';
import { authRules } from '../src/rules/auth.js';
import { RULES } from '../src/rules/index.js';
import { specRules } from '../src/rules/spec.js';
import { buildRedactor, redactDeep } from '../src/redact.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, exchange, snap } from './helpers.js';

const URL_OK = 'https://mcp.acme.test/mcp';
const byId = (id: string) => [...specRules, ...authRules].find((r) => r.id === id)!;
const messages = (id: string, s: Snapshot) => evaluate(byId(id), s, true).map((f) => f.message);
const DISCOVER = { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 1000, cacheScope: 'public' };
const SI = { 'io.modelcontextprotocol/serverInfo': { name: 'acme-notes', version: '1.0.0' } };
/** A 2026-07-28-only server whose discover result is `discover` and whose other results are `results`. */
const modern = (discover: Record<string, unknown> = DISCOVER, results: Array<{ method: string; result: unknown }> = []) => snap({
  url: URL_OK,
  set: (s) => {
    s.era = 'modern';
    s.protocolVersion = '2026-07-28';
    s.initializeRaw = undefined;
    s.discoverRaw = discover;
    s.capabilities = discover.capabilities as Record<string, unknown>;
    s.transport.modernResults = [{ method: 'server/discover', result: discover }, ...results];
  },
});
const withCaps = (caps: Record<string, unknown>) => snap({ set: (s) => { s.capabilities = caps; s.initializeRaw = { protocolVersion: '2025-11-25', capabilities: caps, serverInfo: s.serverInfo }; } });

describe('registration', () => {
  it('SPEC-021..023 are registered with the documented severities and sources', () => {
    const get = (id: string) => RULES.find((r) => r.id === id)!;
    expect(get('SPEC-021').severity).toEqual({ spec: 'info' });
    expect(get('SPEC-021').sources[0]).toBe('https://modelcontextprotocol.io/specification/2026-07-28/deprecated');
    expect(get('SPEC-022').severity).toEqual({ spec: 'info' });
    expect(get('SPEC-022').needs).toEqual(['modern']);
    expect(get('SPEC-023').severity).toEqual({ spec: 'error' });
    expect(get('SPEC-023').sources.join(' ')).toMatch(/docs\/extensions\/overview/);
  });
});

describe('SPEC-021 deprecated protocol features (SEP-2577, SEP-2596)', () => {
  it('reports logging, sampling and roots capabilities as info, once each', () => {
    const f = evaluate(byId('SPEC-021'), withCaps({ tools: {}, logging: {}, sampling: {}, roots: { listChanged: true } }));
    expect(f.map((x) => x.severity)).toEqual(['info', 'info', 'info']);
    expect(f.map((x) => x.message).sort()).toEqual([
      'initialize: capabilities.logging is declared; Logging is deprecated in 2026-07-28 (SEP-2577); log to stderr on stdio or use OpenTelemetry',
      'initialize: capabilities.sampling is declared; Sampling is deprecated in 2026-07-28 (SEP-2577) and is a client capability, not a server one',
      'initialize: capabilities.roots is declared; Roots is deprecated in 2026-07-28 (SEP-2577) and is a client capability, not a server one',
    ].sort());
  });
  it('names both results when a dual-era server declares logging in initialize and server/discover', () => {
    const s = withCaps({ tools: {}, logging: {} });
    s.era = 'dual';
    s.discoverRaw = { ...DISCOVER, capabilities: { tools: {}, logging: {}, completions: {} } };
    expect(messages('SPEC-021', s)).toEqual([
      'initialize and server/discover: capabilities.logging is declared; Logging is deprecated in 2026-07-28 (SEP-2577); log to stderr on stdio or use OpenTelemetry',
    ]);
  });
  it('reports an HTTP+SSE-only server', () => {
    const s = snap({ url: URL_OK, set: (x) => { x.transport.kind = 'sse'; x.era = 'sse-legacy'; } });
    expect(messages('SPEC-021', s)).toEqual(['served only over the HTTP+SSE transport, deprecated since 2025-03-26 (SEP-2596); migrate to Streamable HTTP']);
  });
  it('reports sampling with includeContext thisServer/allServers and roots/list requested through input_required results', () => {
    const ir = {
      resultType: 'input_required',
      inputRequests: {
        a: { method: 'sampling/createMessage', params: { messages: [], maxTokens: 10, includeContext: 'allServers' } },
        b: { method: 'roots/list', params: {} },
        c: { method: 'elicitation/create', params: { message: 'Confirm?', requestedSchema: { type: 'object', properties: {} } } },
      },
    };
    const f = messages('SPEC-021', modern(DISCOVER, [{ method: 'tools/call', result: ir }]));
    expect(f.sort()).toEqual([
      'tools/call result asks the client for sampling/createMessage: Sampling (deprecated in 2026-07-28, SEP-2577; integrate with an LLM provider API instead)',
      'tools/call result: sampling/createMessage uses includeContext "allServers", deprecated (SEP-2596); omit it or use "none"',
      'tools/call result asks the client for roots/list: Roots (deprecated in 2026-07-28, SEP-2577; take directories or files as tool parameters instead)',
    ].sort());
  });
  it('reads active tool-call results too; includeContext "none" is not a finding beyond sampling itself', () => {
    const s = snap({ active: true });
    s.active = { calls: [{ tool: 'summarize', kind: 'valid', args: {}, durationMs: 5, result: { resultType: 'input_required', inputRequests: { k: { method: 'sampling/createMessage', params: { includeContext: 'none' } } } } }] };
    expect(messages('SPEC-021', s)).toEqual(['tools/call summarize result asks the client for sampling/createMessage: Sampling (deprecated in 2026-07-28, SEP-2577; integrate with an LLM provider API instead)']);
  });
  it('is silent on a current server: completions, resources.subscribe, elicitation, Streamable HTTP', () => {
    expect(messages('SPEC-021', withCaps({ tools: {}, completions: {}, resources: { subscribe: true }, extensions: { 'io.modelcontextprotocol/ui': {} } }))).toEqual([]);
    expect(messages('SPEC-021', modern())).toEqual([]);
  });
});

describe('SPEC-022 _meta["io.modelcontextprotocol/serverInfo"] on 2026-07-28 results', () => {
  it('lists the methods whose results lack it, as info', () => {
    const f = evaluate(byId('SPEC-022'), modern(DISCOVER, [
      { method: 'tools/list', result: { resultType: 'complete', tools: [], ttlMs: 1, cacheScope: 'public' } },
      { method: 'tools/list', result: { resultType: 'complete', tools: [], ttlMs: 1, cacheScope: 'public' } },
    ]));
    // server/discover is SRV-013's (review A04-01): one finding per defect.
    expect(f).toMatchObject([{ severity: 'info', message: 'tools/list result lacks _meta["io.modelcontextprotocol/serverInfo"]' }]);
  });
  it('reports a malformed value separately', () => {
    const f = messages('SPEC-022', modern(DISCOVER, [{ method: 'tools/list', result: { resultType: 'complete', tools: [], _meta: { 'io.modelcontextprotocol/serverInfo': 'acme-notes 1.0.0' } } }]));
    expect(f).toEqual(['_meta["io.modelcontextprotocol/serverInfo"] on tools/list is not an object with string name and version']);
  });
  it('is clean when every result carries it (an empty version string is a string)', () => {
    const d = { ...DISCOVER, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'kiwi', version: '' } } };
    expect(messages('SPEC-022', modern(d, [{ method: 'tools/list', result: { resultType: 'complete', tools: [], _meta: SI } }]))).toEqual([]);
  });
  it('leaves the server/discover result to SRV-013, also when no modern results were recorded (dual-era fixtures; review A04-01)', () => {
    const s = withCaps({ tools: {} });
    s.era = 'dual';
    s.discoverRaw = DISCOVER;
    expect(messages('SPEC-022', s)).toEqual([]); // SRV-013 reports it (test/r3-p4-protocol-engine.test.ts)
  });
  it('is skipped unless 2026-07-28 was negotiated (legacy initialize carries serverInfo in its body)', () => {
    const r = evaluate(byId('SPEC-022'), withCaps({ tools: {} }), true);
    expect(r).toEqual([]);
    expect(() => evaluate(byId('SPEC-022'), withCaps({ tools: {} }))).toThrow(/skipped: era legacy/);
  });
});

describe('SPEC-023 capabilities.extensions', () => {
  it('errors when extensions is not an object', () => {
    for (const [v, what] of [[[], 'an array'], [null, 'null'], ['io.modelcontextprotocol/ui', 'string']] as const) {
      expect(evaluate(byId('SPEC-023'), withCaps({ tools: {}, extensions: v }))).toMatchObject([
        { severity: 'error', message: `initialize: capabilities.extensions is ${what}, not an object` },
      ]);
    }
  });
  it('errors on identifiers without a prefix or with invalid labels, and on non-object settings', () => {
    const f = evaluate(byId('SPEC-023'), withCaps({ tools: {}, extensions: { ui: {}, '1acme.com/x': {}, 'com.acme/-bad': {}, 'com.acme/audit': true } }));
    expect(f.map((x) => [x.severity, x.message]).sort()).toEqual([
      ['error', 'initialize: extension identifier "ui" is not a "{vendor-prefix}/{name}" _meta key (no vendor prefix)'],
      ['error', 'initialize: extension identifier "1acme.com/x" is not a "{vendor-prefix}/{name}" _meta key (invalid prefix label)'],
      ['error', 'initialize: extension identifier "com.acme/-bad" is not a "{vendor-prefix}/{name}" _meta key (invalid name)'],
      ['error', 'initialize: settings of extension "com.acme/audit" are boolean, not an object ({} for no settings)'],
    ].sort());
  });
  it('warns on a non-official identifier in a namespace reserved for MCP; official ones pass', () => {
    const f = evaluate(byId('SPEC-023'), withCaps({ tools: {}, extensions: { 'dev.mcp/thing': {}, 'io.modelcontextprotocol/ui': {}, 'io.modelcontextprotocol/skills': { directoryRead: true } } }));
    expect(f.map((x) => [x.severity, x.message])).toEqual([['warning', 'initialize: extension identifier "dev.mcp/thing" uses a prefix reserved for MCP']]);
  });
  it('reports io.modelcontextprotocol/tasks as declared, not verified (info), until the methods are probed', () => {
    const d = { ...DISCOVER, capabilities: { tools: {}, extensions: { 'io.modelcontextprotocol/tasks': {} } }, _meta: SI };
    expect(evaluate(byId('SPEC-023'), modern(d))).toMatchObject([
      { severity: 'info', message: 'server/discover: io.modelcontextprotocol/tasks declared; tasks/get, tasks/update, tasks/cancel not probed (declared, not verified)' },
    ]);
    const answered = ['tasks/get', 'tasks/update', 'tasks/cancel'].map((method) => ({ method, result: { resultType: 'complete' } }));
    expect(messages('SPEC-023', modern(d, answered))).toEqual([]);
  });
  it('cuts a long identifier and leaves secrets to the report redactor', () => {
    const secret = ['sk', 'live', 'SYNTHspec023redactme0001'].join('_'); // assembled at runtime so no key-shaped literal is committed
    const s = withCaps({ tools: {}, extensions: { [`${secret}${'x'.repeat(100)}`]: {} } });
    const f = evaluate(byId('SPEC-023'), s);
    expect(f[0].message).toMatch(/…" is not a/);
    const red = redactDeep(f, buildRedactor({ headers: { 'X-Api-Key': secret } }));
    expect(JSON.stringify(red)).not.toContain(secret);
  });
});

describe('AUTH-012 DCR deprecation (extended message, no new rule)', () => {
  const ISSUER = 'https://auth.acme.test';
  const authSnap = (as: Record<string, unknown>) => snap({
    url: URL_OK,
    set: (s) => {
      s.authProbe = {
        trigger: 'preflight-401', prmAttempts: [], timings: {},
        prm: { url: `${URL_OK.replace('/mcp', '')}/.well-known/oauth-protected-resource/mcp`, via: 'header', json: { resource: URL_OK, authorization_servers: [ISSUER] } },
        as: [{ issuer: ISSUER, attempts: [exchange({ status: 200 })], json: { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, code_challenge_methods_supported: ['S256'], ...as } }],
      };
    },
  });
  it('DCR without CIMD: spec info naming the deprecation and what Claude needs for CIMD', () => {
    const f = evaluate(byId('AUTH-012'), authSnap({ registration_endpoint: `${ISSUER}/register`, token_endpoint_auth_methods_supported: ['none'] }));
    expect(f).toMatchObject([{
      severity: 'info', platforms: ['spec'],
      message: 'DCR only: Dynamic Client Registration is deprecated in 2026-07-28 for new servers; add CIMD (Claude uses it only with client_id_metadata_document_supported: true and "none" in token_endpoint_auth_methods_supported)',
    }]);
  });
  it('cites the deprecated features registry', () => {
    expect(byId('AUTH-012').sources).toContain('https://modelcontextprotocol.io/specification/2026-07-28/deprecated');
  });
  it('CIMD with "none" and DCR: no deprecation finding', () => {
    expect(messages('AUTH-012', authSnap({ registration_endpoint: `${ISSUER}/register`, client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ['none'] }))).toEqual([]);
  });
});
