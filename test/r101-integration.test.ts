// 1.0.1 integration: the review round 3 integrator notes that touch files outside the fix packages (src/cli.ts,
// src/rules/data.ts, src/report/index.ts, src/report/junit.ts).
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildReport, resultLine } from '../src/report/index.js';
import { DATA_001, DATA_003, DATA_005 } from '../src/rules/data.js';
import { RULES, runRules } from '../src/rules/index.js';
import { startAuthServer } from './fixtures/auth-server.js';
import type { Started } from './fixtures/http-bridge.js';
import { evaluate, snap, tool, toolWithProps } from './helpers.js';

let server: Started | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});

describe('A10-02: the stall notice reaches stderr during the run', () => {
  const HANG = fileURLToPath(new URL('./fixtures/hang-server.mjs', import.meta.url));
  it('is written to process.stderr once, before the run returns', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write);
    const r = await runCli(['--stdio', '--timeout', '4000', '--format', 'json', '--', process.execPath, HANG], {}, false);
    vi.restoreAllMocks();
    const stalls = writes.filter((w) => /stopped answering/.test(w));
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/^mcp-review-check: tools\/list got no answer within --timeout/);
    expect(stalls[0].endsWith('\n')).toBe(true);
    expect(r.stderr).not.toMatch(/stopped answering/); // not repeated at the end
  }, 90000);
});

describe('A03-03: --active-auth names the DCR client it registered', () => {
  it('prints the registered client_id on stderr, and nothing without --active-auth', async () => {
    server = await startAuthServer({});
    const r = await runCli([server.url, '--active-auth', '--format', 'json', '--timeout', '5000'], {}, false);
    expect(r.stderr).toMatch(/registered DCR client client_id=client-123 at http:\/\/127\.0\.0\.1:\d+\/register/);
    const off = await runCli([server.url, '--format', 'json', '--timeout', '5000'], {}, false);
    expect(off.stderr).not.toContain('client-123');
  }, 60000);
});

describe('A05-04: the DATA skips also see the node a local $ref resolves to', () => {
  const withDefs = (props: Record<string, unknown>, defs: Record<string, unknown>) =>
    tool({ name: 'report', inputSchema: { type: 'object', properties: props, $defs: defs } });
  it('history = {$ref: Hours} with Hours an integer gives no DATA-001', () => {
    const s = snap({ tools: [withDefs({ history: { $ref: '#/$defs/Hours', description: 'Hours back' } }, { Hours: { type: 'integer' } })] });
    expect(evaluate(DATA_001, s)).toEqual([]);
  });
  it('a $ref to a string still warns, and a non-text node with a text $ref still skips', () => {
    const text = snap({ tools: [withDefs({ history: { $ref: '#/$defs/Log', description: 'Past entries' } }, { Log: { type: 'string' } })] });
    expect(evaluate(DATA_001, text).map((f) => f.severity)).toEqual(['warning']);
    // The resolved node only adds a skip: the node as written still decides when it is non-text itself.
    const own = snap({ tools: [withDefs({ history: { $ref: '#/$defs/Log', type: 'integer', description: 'Count' } }, { Log: { type: 'string' } })] });
    expect(evaluate(DATA_001, own)).toEqual([]);
  });
  it('DATA-003 and DATA-005 skip through a $ref too', () => {
    const secret = snap({ tools: [withDefs({ github_token: { $ref: '#/$defs/N', description: 'Count' } }, { N: { type: 'number' } })] });
    expect(evaluate(DATA_003, secret)).toEqual([]);
    const place = snap({ tools: [withDefs({ address: { $ref: '#/$defs/Mail', description: 'Recipient' } }, { Mail: { type: 'string', format: 'email' } })] });
    expect(evaluate(DATA_005, place)).toEqual([]);
    const real = snap({ tools: [withDefs({ address: { $ref: '#/$defs/Street', description: 'Street address' } }, { Street: { type: 'string' } })] });
    expect(evaluate(DATA_005, real)).toHaveLength(1);
  });
});

describe('A10-01 follow-up: the result line of a --fail-on-incomplete failure', () => {
  const resultOf = (out: string) => out.split('\n').find((l) => /Result/.test(l)) ?? '';
  it('names --fail-on-incomplete when no finding reached the gate, and says the partial check once', async () => {
    server = await startAuthServer({});
    const base = [server.url, '--fail-on', 'never', '--fail-on-incomplete'];
    const text = await runCli(base, {}, false);
    expect(text.code, text.stderr).toBe(3);
    expect(resultOf(text.stdout)).toMatch(/Result: FAIL \(--fail-on-incomplete\) · partial check: auth-required$/);
    const quiet = await runCli([...base, '--quiet'], {}, false);
    expect(quiet.code).toBe(3);
    expect(resultOf(quiet.stdout)).toMatch(/Result: FAIL \(--fail-on-incomplete\) · partial check: auth-required \(server requires auth; pass --bearer <token>\)$/);
    expect(resultOf(quiet.stdout).match(/partial check/g)).toHaveLength(1);
    const md = await runCli([...base, '--format', 'markdown'], {}, false);
    expect(resultOf(md.stdout)).toBe('| Result | FAIL (--fail-on-incomplete) · partial check: auth-required |');
    // The JSON report keeps its gate.reason as before: text only.
    const json = await runCli([...base, '--format', 'json'], {}, false);
    expect(json.code).toBe(3);
    expect(JSON.parse(json.stdout).summary.gate.reason).toBe('partial check: auth-required (--fail-on-incomplete)');
  }, 60000);

  it('keeps --fail-on in the head when a finding reached the gate too, with the partial cause merged once', () => {
    // A tools/list that failed, and a DATA-001 error that reached the gate; the CLI adds the partial check to the reason.
    const s = snap({ tools: [toolWithProps('chat', { conversation_history: { type: 'string', description: 'History' } })] });
    s.coverage = { ...s.coverage, toolLevel: 'list-failed', reason: 'tools/list failed' };
    const report = buildReport(s, runRules(s, RULES), [], 'error', new Date(), 1);
    expect(report.summary.failed).toBe(true);
    const gated = report.summary.gate.reason!;
    report.summary.gate.reason = `${gated}; partial check: list-failed (--fail-on-incomplete)`;
    expect(resultLine(report)).toBe(`FAIL (--fail-on error) · ${gated}; partial check: list-failed (--fail-on-incomplete)`);
    const withCauses = resultLine(report, (x) => x, true);
    expect(withCauses.startsWith(`FAIL (--fail-on error) · ${gated}; partial check: list-failed (`)).toBe(true);
    expect(withCauses.match(/partial check/g)).toHaveLength(1);
    // Without --fail-on-incomplete nothing changes: the partial check is the trailing part.
    report.summary.gate.reason = gated;
    expect(resultLine(report, (x) => x, true)).toMatch(new RegExp(`^FAIL \\(--fail-on error\\) · .+ · partial check: list-failed`));
  });
});
