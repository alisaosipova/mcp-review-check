// Rule engine (1.2.0, review round 4 P3; spec §1.3, §4.2): a throwing rule is skipped and counted (A13-02), ignored
// findings are sorted (I-A13-5), a hostile tool name does not stop the run (A13-01), and SRV-003 is not a passed test
// for a stdio server (A10-06).
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTERNAL_REASON, runRules, sortFindings } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import { defineRule, type RuleMeta } from '../src/rules/types.js';
import { buildReport } from '../src/report/index.js';
import { renderJunit } from '../src/report/junit.js';
import { runCli } from '../src/cli.js';
import { cli } from './cli-runner.js';
import { loadSnapshot, snap } from './helpers.js';

const meta: RuleMeta = { id: 'TEST-100', title: 't', severity: { claude: 'error', chatgpt: 'warning', spec: 'info' }, needs: [], rationale: 'r', fix: 'f', sources: ['https://x.test'] };
const boom = defineRule({ ...meta, id: 'TEST-101' }, () => { throw new Error('boom'); });
const finds = defineRule({ ...meta, id: 'TEST-102' }, () => [{ message: 'x' }]);

describe('a rule that throws (A13-02)', () => {
  it('is skipped with "internal error: <message>", not counted as run, and counted in internalErrors', () => {
    const r = runRules(snap(), [boom, finds]);
    expect(r.skipped).toEqual([{ ruleId: 'TEST-101', reason: `${INTERNAL_REASON}: boom` }]);
    expect(r.rulesRun).toBe(1);
    expect(r.internalErrors).toBe(1);
    expect(r.findings.find((f) => f.ruleId === 'INTERNAL')).toMatchObject({ severity: 'info', message: 'TEST-101 threw: boom' });
    expect('internalErrors' in runRules(snap(), [finds])).toBe(false); // only set when a rule threw
  });

  it('leaves coverage and the gate alone: summary.failed and incompleteFails stay false even with --fail-on-incomplete', () => {
    const s = snap();
    const r = runRules(s, [boom]);
    expect(r.internalErrors).toBe(1);
    expect(s.coverage.toolLevel).toBe('ok');
    const rep = buildReport(s, r, [], 'error', new Date('2026-11-05T00:00:00Z'), 1, false, true);
    expect(rep.summary.failed).toBe(false);
    expect(rep.incompleteFails).toBe(false);
  });

  it('a rule outside --target that throws counts in internalErrors but is not listed as skipped', () => {
    const chatgptOnly = defineRule({ ...meta, id: 'TEST-103', severity: { chatgpt: 'info' }, needs: [] }, () => { throw new Error('x'); });
    const r = runRules(snap({ target: 'claude' }), [chatgptOnly]);
    expect(r.internalErrors).toBe(1);
    expect(r.skipped).toEqual([{ ruleId: 'TEST-103', reason: 'not applicable to --target claude' }]);
  });

  it('a thrown non-Error with a hostile toString is reported, not rethrown', () => {
    const odd = defineRule({ ...meta, id: 'TEST-104', severity: { spec: 'info' }, needs: [] }, () => { throw { toString: 'x' }; });
    const r = runRules(snap(), [odd]);
    expect(r.skipped[0].reason).toBe(`${INTERNAL_REASON}: {"toString":"x"}`);
  });
});

describe('ignored findings (I-A13-5)', () => {
  it('come out sorted like the reported ones', () => {
    const many = defineRule({ ...meta, id: 'TEST-105', severity: { spec: 'info' }, needs: [] }, () => [
      { message: 'b', tool: 'zeta' }, { message: 'a', severity: 'error', tool: 'beta' }, { message: 'c', tool: 'alpha' },
    ]);
    const r = runRules(snap(), [many], { ignore: ['TEST-105'] });
    expect(r.ignored.map((f) => f.message)).toEqual(['a', 'c', 'b']);
    expect(r.ignored).toEqual(sortFindings([...r.ignored]));
  });
});

describe('SRV-003 on a stdio target (A10-06)', () => {
  it('the JUnit suites list it as skipped with "stdio target", never as passed', () => {
    const s = snap();
    const r = runRules(s, RULES);
    expect(r.skipped.find((x) => x.ruleId === 'SRV-003')?.reason).toBe('stdio target');
    const xml = renderJunit(buildReport(s, r, [], 'error', new Date('2026-11-05T00:00:00Z'), 1));
    const cases = xml.match(/<testcase [^>]*name="SRV-003 [^"]*"[^>]*?(\/>|>[\s\S]*?<\/testcase>)/g) ?? [];
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect(c).toContain('<skipped message="stdio target"/>');
  });
});

describe('a tool named by a {"toString":"x"} object (A13-01)', () => {
  const server = `node ${fileURLToPath(new URL('./fixtures/r111-p3-hostile-server.mjs', import.meta.url))}`;

  it('gives a JSON report with the name as JSON text, not a fatal exit 3', async () => {
    const run = await cli(['--stdio', server, '--format', 'json', '--timeout', '10000']);
    expect(run.stderr).not.toMatch(/fatal|Cannot convert object to primitive/);
    expect(run.code).not.toBe(3);
    expect(run.json?.findings.some((f: { ruleId: string }) => f.ruleId === 'INTERNAL')).toBe(false);
    expect(JSON.stringify(run.json.findings)).toContain('{\\"toString\\":\\"x\\"}');
  }, 60000);
});

describe('a failed connect whose auth probe ran (review of A04-06)', () => {
  it('a loopback 403 with a WWW-Authenticate challenge keeps its AUTH findings', async () => {
    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(403, { 'WWW-Authenticate': 'Bearer realm="x", error="insufficient_scope"', 'Content-Type': 'application/json' });
      res.end('{"error":"forbidden"}');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const r = await runCli([`http://127.0.0.1:${port}/mcp`, '--format', 'json', '--timeout', '3000'], {});
      const doc = JSON.parse(r.stdout);
      expect(doc.coverage.toolLevel).toBe('connect-failed');
      const ids = doc.findings.map((f: { ruleId: string }) => f.ruleId);
      for (const id of ['AUTH-002', 'AUTH-004', 'AUTH-015', 'AUTH-016']) expect(ids, id).toContain(id);
      expect(doc.skipped.filter((x: { ruleId: string; reason: string }) => ['AUTH-002', 'AUTH-004', 'AUTH-015', 'AUTH-016'].includes(x.ruleId))).toEqual([]);
    } finally {
      await new Promise((done) => server.close(done));
    }
  }, 60000);

  it('the auth need reads "stdio target" on a stdio target that did not start', () => {
    const s = snap({ set: (x) => { x.fatal = 'could not start'; x.coverage = { toolLevel: 'connect-failed' }; } });
    expect(runRules(s, RULES).skipped.find((x) => x.ruleId === 'AUTH-002')?.reason).toBe('stdio target');
  });
});

describe('handshake is a soft need (review of A04-03)', () => {
  it('a 401 whose body has JSON-RPC code "bad" keeps SPEC-016', () => {
    const s = loadSnapshot('auth-required');
    s.transport.observedErrors = [{ source: 'initialize (HTTP 401)', requestId: 1, responseId: 1, code: 'bad', message: 'unauthorized' }];
    const r = runRules(s, RULES);
    expect(r.findings.find((f) => f.ruleId === 'SPEC-016')?.message).toMatch(/error code "bad" is not an integer/);
  });

  it('an SSE-only server behind a 401 keeps SPEC-021; without that data the rule is skipped with the auth reason', () => {
    const s = loadSnapshot('auth-required');
    s.transport.kind = 'sse';
    expect(runRules(s, RULES).findings.find((f) => f.ruleId === 'SPEC-021')?.message).toMatch(/HTTP\+SSE transport/);
    expect(runRules(loadSnapshot('auth-required'), RULES).skipped.find((x) => x.ruleId === 'SPEC-021')?.reason).toBe('server requires auth; pass --bearer <token>');
  });
});
