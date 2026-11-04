// Review round 3, package P4 (1.0.1): protocol, server and auth rules, engine.
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { SPEC_022, SPEC_024 } from '../src/rules/spec.js';
import { SRV_003, SRV_013, SRV_018 } from '../src/rules/server.js';
import { buildRedactor, redactDeep } from '../src/redact.js';
import { AUTH_021 } from '../src/rules/auth.js';
import type { HttpExchange, Snapshot } from '../src/snapshot.js';
import { exchange, snap } from './helpers.js';
import { RULES } from '../src/rules/index.js';

const stop = (s: Snapshot) => { s.coverage = { toolLevel: 'stopped' }; s.limits = { truncated: [], stopped: { maxDurationMs: 1500, phase: 'listing', unfinished: ['listing', 'wire probes'] } }; };

describe('A04-02: run-wide notifications and stdio output are partial after a stop', () => {
  it('SPEC-024 is skipped, not passed, when a stopped HTTP run saw no notifications/message', () => {
    const r = runRules(snap({ url: 'https://mcp.acme.test/mcp', set: (s) => { s.era = 'modern'; stop(s); } }), [SPEC_024]);
    expect(r.rulesRun).toBe(0);
    expect(r.skipped).toEqual([{ ruleId: 'SPEC-024', reason: 'stopped by --max-duration' }]);
  });
  it('SRV-018 is skipped, not passed, when a stopped stdio run saw no non-JSON-RPC stdout', () => {
    const r = runRules(snap({ set: (s) => { stop(s); s.transport.stdio = { nonJsonStdout: [], nonJsonTotal: 0, stderrTail: '' }; } }), [SRV_018]);
    expect(r.rulesRun).toBe(0);
    expect(r.skipped).toEqual([{ ruleId: 'SRV-018', reason: 'stopped by --max-duration' }]);
  });
  it('both still report what they saw before the stop, and still pass on a run that was not stopped', () => {
    const http = (stopped: boolean) => snap({ url: 'https://mcp.acme.test/mcp', set: (s) => { s.era = 'modern'; if (stopped) stop(s); s.transport.notifications = { methods: { 'notifications/message': 2 }, message: { total: 2, unrequested: 2, invalidLevel: 0 } }; } });
    expect(runRules(http(true), [SPEC_024]).findings.map((f) => f.ruleId)).toContain('SPEC-024');
    const stdio = (stopped: boolean) => snap({ set: (s) => { if (stopped) stop(s); s.transport.stdio = { nonJsonStdout: ['banner'], nonJsonTotal: 1, stderrTail: '' }; } });
    expect(runRules(stdio(true), [SRV_018]).findings.map((f) => f.ruleId)).toEqual(['SRV-018']);
    const clean = runRules(snap({ url: 'https://mcp.acme.test/mcp', set: (s) => { s.era = 'modern'; } }), [SPEC_024]);
    expect(clean).toMatchObject({ rulesRun: 1, skipped: [], findings: [] });
  });
});

describe('A10-05: rules that need the server are skipped after connect-failed', () => {
  const failed = () => snap({ url: 'https://mcp.acme.test/mcp', set: (s) => {
    s.era = 'unknown'; s.fatal = 'could not complete a handshake: ECONNREFUSED'; s.coverage = { toolLevel: 'connect-failed', reason: 'ECONNREFUSED' };
    s.serverInfo = undefined; s.initializeRaw = undefined; s.capabilities = {}; s.tools = []; s.listMeta = {};
  } });
  it('the HTTP probe rules, SPEC-020 and the serverInfo rules are skipped with "could not connect", not counted as run', () => {
    const ids = ['SRV-006', 'SRV-007', 'SRV-008', 'SRV-009', 'SRV-010', 'SRV-011', 'SRV-012', 'SRV-014', 'SRV-015', 'SRV-016', 'SPEC-020', 'AUTH-003', 'POL-005'];
    const r = runRules(failed(), RULES.filter((x) => ids.includes(x.id)));
    expect(r.rulesRun).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.skipped.filter((x) => x.reason === 'could not connect').map((x) => x.ruleId).sort()).toEqual([...ids].sort());
  });
  it('the URL and DNS rules still run, and every finding of a connect-failed run is kept', () => {
    const ids = ['SRV-001', 'SRV-003', 'SRV-004', 'SRV-005', 'SRV-017', 'AUTH-001'];
    const r = runRules(failed(), RULES.filter((x) => ids.includes(x.id)));
    expect(r.rulesRun).toBe(ids.length);
    expect(r.findings.map((f) => f.ruleId)).toEqual(['SRV-003']);
  });
  it('a connected run is unaffected', () => {
    const r = runRules(snap({ url: 'https://mcp.acme.test/mcp' }), RULES.filter((x) => x.id === 'SRV-007'));
    expect(r.skipped).toEqual([]);
    expect(r.rulesRun).toBe(1);
  });
});

describe('A04-03: AUTH-021 does not read a well-formed RFC 6749 error as a form-parse failure', () => {
  const token = (code: Partial<HttpExchange>) => runRules(snap({ url: 'https://mcp.acme.test/mcp', set: (s) => {
    s.options.activeAuth = true;
    s.authProbe = { challenge: exchange({ status: 401 }), prmAttempts: [], as: [], active: { token: [exchange(code)] } } as unknown as Snapshot['authProbe'];
  } }), [AUTH_021]).findings.map((f) => `${f.severity} ${f.message}`);
  const json = (body: Record<string, string>, status = 401): Partial<HttpExchange> => ({ status, contentType: 'application/json', bodySnippet: JSON.stringify(body), json: body, jsonParsed: true });
  it('invalid_client "missing client authentication for grant_type ..." is no finding', () => {
    expect(token(json({ error: 'invalid_client', error_description: 'missing client authentication for grant_type authorization_code' }))).toEqual([]);
    expect(token({ status: 400, jsonParsed: true, oauthError: 'invalid_grant', bodySnippet: '{"error":"invalid_grant","error_description":"code missing for grant_type authorization_code"}' })).toEqual([]);
  });
  it('the body-text heuristic is a warning; 415 stays an error', () => {
    expect(token(json({ error: 'invalid_request', error_description: 'missing grant_type' }, 400))).toEqual(['warning token endpoint may not parse a form-encoded body (400): its error reads like a parse failure']);
    expect(token({ status: 400, bodySnippet: 'could not parse request body' })).toEqual(['warning token endpoint may not parse a form-encoded body (400): its error reads like a parse failure']);
    expect(token({ status: 415, bodySnippet: '' })).toEqual(['error token endpoint did not parse a form-encoded body (415)']);
  });
});

describe('A04-01: one finding for the server/discover serverInfo, from SRV-013', () => {
  const modern = (meta?: unknown, more: Array<{ method: string; result: unknown }> = []) => snap({ url: 'https://mcp.acme.test/mcp', set: (s) => {
    s.era = 'modern'; s.initializeRaw = undefined;
    s.discoverRaw = { supportedVersions: ['2026-07-28'], capabilities: {}, resultType: 'complete', ...(meta === undefined ? {} : { _meta: { 'io.modelcontextprotocol/serverInfo': meta } }) };
    s.transport.modernResults = more;
  } });
  const both = (s: Snapshot) => runRules(s, [SRV_013, SPEC_022]).findings.map((f) => `${f.ruleId} ${f.severity} ${f.message}`);
  it('a missing serverInfo on server/discover is reported once (SRV-013 warning), not again by SPEC-022', () => {
    expect(both(modern())).toEqual(['SRV-013 warning server/discover result has no _meta["io.modelcontextprotocol/serverInfo"]']);
  });
  it('a malformed one only by SRV-013, at its existing levels', () => {
    expect(both(modern({ name: '', version: 1 })).map((m) => m.split(' ').slice(0, 2).join(' '))).toEqual(['SRV-013 error', 'SRV-013 error']);
  });
  it('SPEC-022 still reports the other 2026-07-28 results', () => {
    const s = modern({ name: 'acme', version: '1' }, [{ method: 'server/discover', result: {} }, { method: 'tools/list', result: { tools: [] } }]);
    expect(both(s)).toEqual(['SPEC-022 info tools/list result lacks _meta["io.modelcontextprotocol/serverInfo"]']);
  });
});

describe('A10-06: stdio start failures get a diagnosis, and the stderr pointer only when there is stderr', () => {
  const failedStdio = (fatal: string, stderrTail = '') => snap({ set: (s) => {
    s.era = 'unknown'; s.fatal = `could not start or initialize the stdio server: ${fatal}`; s.coverage = { toolLevel: 'connect-failed', reason: fatal };
    s.transport.stdio = { nonJsonStdout: [], nonJsonTotal: 0, stderrTail };
  } });
  const fix = (s: Snapshot) => runRules(s, [SRV_003]).findings.map((f) => f.fix);
  it('ENOENT names the command and PATH, with no pointer to a stderr that is empty', () => {
    expect(fix(failedStdio('spawn nonexistent-cmd-xyz ENOENT'))).toEqual(['Command "nonexistent-cmd-xyz" was not found: check PATH or use an absolute path (on Windows, npx is npx.cmd).']);
  });
  it('EACCES reads as not executable', () => {
    expect(fix(failedStdio('spawn ./server.sh EACCES'))[0]).toMatch(/^Command "\.\/server\.sh" is not executable/);
  });
  it('a process that closed the connection before initialize is named as such; the stderr pointer appears when it wrote to stderr', () => {
    expect(fix(failedStdio('MCP error -32000: Connection closed'))).toEqual(['The server process exited or closed stdout before it answered initialize: run the command by hand to see why it stops.']);
    expect(fix(failedStdio('MCP error -32000: Connection closed; stderr: Error: boom', 'Error: boom\n'))[0]).toMatch(/before it answered initialize.*The stderr cause is shown above; --verbose prints all of stderr\.$/);
  });
  it('the new fix text is masked with the rest of the report: a secret in the command is not printed', () => {
    const secret = ['sk', 'live', 'SYNTH0123456789abcdef'].join('_');
    const findings = runRules(failedStdio(`spawn /opt/${secret}/server ENOENT`), [SRV_003]).findings;
    expect(findings[0].fix).toContain(secret); // the rule quotes the command; the report redacts it (cli.ts redactDeep)
    const masked = redactDeep(findings, buildRedactor({ argv: [`/opt/${secret}/server`] }));
    expect(JSON.stringify(masked)).not.toContain(secret);
    expect(masked[0].fix).toMatch(/^Command ".*" was not found/);
  });
});

describe('A10-07: the connect-failure finding of SRV-003 carries transport docs, not the directory-policy page', () => {
  it('HTTP and stdio connect failures link the transport and lifecycle pages; the SSE finding keeps the rule sources', () => {
    const http = runRules(snap({ url: 'https://mcp.acme.test/mcp', set: (s) => { s.era = 'unknown'; s.fatal = 'could not complete a handshake: ECONNREFUSED'; s.coverage = { toolLevel: 'connect-failed' }; } }), [SRV_003]).findings;
    expect(http.map((f) => f.docs)).toEqual([['https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http', 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle']]);
    const stdio = runRules(snap({ set: (s) => { s.era = 'unknown'; s.fatal = 'could not start or initialize the stdio server: spawn x ENOENT'; s.coverage = { toolLevel: 'connect-failed' }; } }), [SRV_003]).findings;
    expect(stdio[0].docs).toEqual(['https://modelcontextprotocol.io/specification/2025-11-25/basic/transports', 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle']);
    expect(stdio[0]).toMatchObject({ severity: 'error', platforms: ['spec'] });
    const sse = runRules(snap({ url: 'https://mcp.acme.test/mcp', set: (s) => { s.transport.kind = 'sse'; } }), [SRV_003]).findings;
    expect(sse[0].docs).toEqual(SRV_003.sources);
  });
  it('the rationale (explain, --list-rules, markdown "Why these rules") covers the connect-failure case', () => {
    expect(SRV_003.rationale).toMatch(/no transport works at all .* spec error/);
  });
});
