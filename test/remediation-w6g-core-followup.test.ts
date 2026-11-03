// Regression tests for the W6G-core-followup remediation (wave 6): a snapshot budget stop is handled like a
// --max-duration stop by the engine and the report, and rpcView and AUTH-021 read the exchange summary, so no probe
// exchange keeps its parsed body (review F036, F146).
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { dropExchangeBodies } from '../src/connect.js';
import { createRedactor, createTracer, summarizeJsonRpc } from '../src/protocol/trace.js';
import { buildReport, resultLine } from '../src/report/index.js';
import { BUDGET_REASON, runRules, STOPPED_REASON, unfinishedPhases } from '../src/rules/engine.js';
import { AUTH_021 } from '../src/rules/auth.js';
import { SPEC_001, SPEC_009, SPEC_019 } from '../src/rules/spec.js';
import { rpcView } from '../src/rules/util/obs.js';
import type { HttpExchange, Snapshot } from '../src/snapshot.js';
import { snap as snapOf, tool } from './helpers.js';

const exchange = (over: Partial<HttpExchange> = {}): HttpExchange => ({ label: 'x', method: 'POST', url: 'http://x.test/mcp', requestHeaders: {}, durationMs: 1, ...over });

const budgetStopped = (phase: string, unfinished?: string[], set?: (s: Snapshot) => void) => snapOf({
  tools: [tool()],
  set: (s) => {
    s.listMeta.tools = { pages: 1, rawPages: [] };
    s.coverage = { toolLevel: 'stopped', reason: `snapshot budget exhausted (1000 bytes) during ${phase}` };
    s.limits = { truncated: [], budgetExhausted: { bytes: 1000, overBytes: 5, phase, completed: [], unfinished: unfinished ?? [phase, 'active tool calls'] } };
    set?.(s);
  },
});

describe('the engine on a snapshot whose byte budget ran out (F146)', () => {
  it('a rule reading a probe of an unfinished phase is skipped with "snapshot budget exhausted"; one that found something reports it', () => {
    expect(BUDGET_REASON).toBe('snapshot budget exhausted');
    expect(runRules(budgetStopped('wire probes'), [SPEC_009]).skipped).toEqual([{ ruleId: 'SPEC-009', reason: BUDGET_REASON }]);
    const found = runRules(budgetStopped('wire probes', undefined, (s) => {
      s.transport.probes.unknownTool = { kind: 'jsonrpc', label: 'unknownTool', result: { content: [] }, durationMs: 1 };
    }), [SPEC_009]);
    expect(found.skipped).toEqual([]);
    expect(found.findings.map((f) => f.ruleId)).toEqual(['SPEC-009']);
  });

  it('a phase that finished before the stop is judged as usual; the unfinished set comes from budgetExhausted', () => {
    const r = runRules(budgetStopped('active tool calls'), [SPEC_009]);
    expect(r.skipped).toEqual([]);
    expect(r.rulesRun).toBe(1);
    expect([...(unfinishedPhases(budgetStopped('listing', ['listing', 'wire probes'])) ?? [])]).toEqual(['listing', 'wire probes', 'whole run']);
  });

  it('a --max-duration stop keeps its own reason', () => {
    const s = budgetStopped('wire probes');
    s.limits = { truncated: [], stopped: { maxDurationMs: 1000, phase: 'wire probes' } };
    s.coverage = { toolLevel: 'stopped', reason: 'stopped by --max-duration (1000 ms) during wire probes' };
    expect(runRules(s, [SPEC_009]).skipped).toEqual([{ ruleId: 'SPEC-009', reason: STOPPED_REASON }]);
  });
});

describe('the report on a budget stop (F146)', () => {
  it('the verdict is INCOMPLETE, summary.failed is true and the result line names the budget and the phase', () => {
    const s = budgetStopped('listing');
    const r = buildReport(s, runRules(s, []), [], 'never', new Date('2026-11-03T10:00:00Z'), 1);
    expect(r.summary.failed).toBe(true);
    expect(r.summary.score).toBeNull();
    expect(Object.values(r.summary.verdicts).every((v) => v!.verdict === 'INCOMPLETE')).toBe(true);
    expect(resultLine(r)).toBe('INCOMPLETE (snapshot budget exhausted during listing)');
  });

  it('a snapshot that was not stopped is unchanged', () => {
    const s = snapOf({ tools: [tool()], set: (x) => { x.listMeta.tools = { pages: 1, rawPages: [] }; } });
    const r = buildReport(s, runRules(s, []), [], 'never', new Date('2026-11-03T10:00:00Z'), 1);
    expect(r.summary.failed).toBe(false);
    expect(resultLine(r)).toMatch(/^PASS/);
  });
});

describe('the exchange summary carries what rpcView and AUTH-021 read (F036)', () => {
  it('summarizeJsonRpc keeps error.data when small, drops it when oversized, and notes isError / contents of a result', () => {
    expect(summarizeJsonRpc({ id: 1, error: { code: -32022, message: 'm', data: { supported: ['2026-07-28'] } } })).toEqual([{ id: 1, error: { code: -32022, message: 'm', data: { supported: ['2026-07-28'] } } }]);
    const big = summarizeJsonRpc({ id: 1, error: { code: 1, message: 'm', data: 'x'.repeat(5000) } })!;
    expect(big[0].error).toEqual({ code: 1, message: 'm' });
    expect(summarizeJsonRpc({ id: 2, result: { isError: true, content: [] } })![0]).toEqual({ id: 2, result: true, resultInfo: { isError: true } });
    expect(summarizeJsonRpc({ id: 3, result: { contents: [1, 2] } })![0].resultInfo).toEqual({ contents: 2 });
    expect(summarizeJsonRpc({ id: 4, result: { a: 1 } })![0].resultValue).toBeUndefined();
    expect(summarizeJsonRpc({ id: 4, result: { a: 1 } }, true)![0].resultValue).toEqual({ a: 1 });
  });

  it('rpcView of an exchange without json equals the view of the one with json', () => {
    const bodies = [
      { jsonrpc: '2.0', id: 7, error: { code: -32022, message: 'bad', data: { supported: ['2026-07-28'] } } },
      { jsonrpc: '2.0', id: 8, result: { isError: true, content: [{ type: 'text', text: 'x' }] } },
      { jsonrpc: '2.0', id: 9, result: { contents: [] } },
    ];
    for (const json of bodies) {
      const base = exchange({ status: 200, requestJson: { id: json.id } });
      const full = rpcView({ ...base, json });
      const slim = rpcView({ ...base, jsonRpc: summarizeJsonRpc(json) });
      expect(slim?.responseId).toBe(full?.responseId);
      expect(slim?.error).toEqual(full?.error);
      expect(slim?.status).toBe(200);
      expect(slim?.requestId).toBe(full?.requestId);
      expect(Boolean(slim?.result)).toBe(Boolean(full?.result));
      const pick = (r: unknown) => ({ isError: (r as { isError?: boolean })?.isError, n: (r as { contents?: unknown[] })?.contents?.length });
      if (full?.result) expect(pick(slim!.result)).toEqual(pick(full.result));
    }
  });

  it('SPEC-001, SPEC-009 and SPEC-019 give the same findings from the summary as from the body', () => {
    for (const body of [{ jsonrpc: '2.0', id: 1, result: { isError: false, content: [] } }, { jsonrpc: '2.0', id: 1, error: { code: -32022, message: 'v', data: { supported: ['2026-07-28'] } } }]) {
      const mk = (slim: boolean) => snapOf({
        tools: [tool()],
        set: (s) => {
          s.listMeta.tools = { pages: 1, rawPages: [] };
          const ex = exchange({ status: 200, requestJson: { id: 1 }, ...(slim ? { jsonRpc: summarizeJsonRpc(body) } : { json: body }) });
          s.transport.probes.unknownTool = ex;
          s.transport.probes.badVersion = ex;
          s.transport.probes.badVersionModern = ex;
        },
      });
      const a = runRules(mk(false), [SPEC_009, SPEC_001, SPEC_019]);
      const b = runRules(mk(true), [SPEC_009, SPEC_001, SPEC_019]);
      expect(b.findings).toEqual(a.findings);
      expect(b.skipped).toEqual(a.skipped);
    }
  });

  it('AUTH-021 reads oauthError and jsonParsed when the token exchanges carry no json', () => {
    const run = (code: Partial<HttpExchange>, refresh: Partial<HttpExchange>) => runRules(snapOf({
      set: (s) => {
        s.options.activeAuth = true;
        s.authProbe = { challenge: exchange({ status: 401 }), prmAttempts: [], as: [], active: { token: [exchange({ status: 400, ...code }), exchange({ status: 400, ...refresh })] } } as unknown as Snapshot['authProbe'];
      },
    }), [AUTH_021]).findings.map((f) => f.message);
    expect(run({ jsonParsed: true }, { jsonParsed: true, oauthError: 'invalid_grant' })).toEqual([]);
    expect(run({}, { jsonParsed: true, oauthError: 'invalid_grant' })).toEqual(['token error body is not JSON (400)']);
    expect(run({ jsonParsed: true }, { jsonParsed: true, oauthError: 'invalid_request' })).toEqual(['bogus refresh_token got 400 "invalid_request"; expected 400 invalid_grant']);
    expect(run({ json: { error: 'x' } }, { json: { error: 'invalid_grant' } })).toEqual([]);
  });
});

describe('no probe exchange retains the parsed body after a run', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });
  const serve = async (answer: (res: ServerResponse) => void) => {
    const srv = createServer((_req, res) => answer(res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
    return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/t`;
  };

  it('the tracer records oauthError and jsonParsed; dropExchangeBodies removes json from probes and token exchanges only, keeping the discover result', async () => {
    const url = await serve((res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'x' })); });
    const tracer = createTracer(createRedactor(), () => 0, undefined, { keepJson: true });
    const { exchange: ex } = await tracer.request('auth token refresh', url, { method: 'POST', body: 'a=b' });
    expect(ex).toMatchObject({ status: 400, jsonParsed: true, oauthError: 'invalid_grant' });
    expect(ex.json).toEqual({ error: 'invalid_grant', error_description: 'x' });

    const prm = exchange({ json: { resource: 'r' }, jsonParsed: true });
    const s = snapOf({});
    s.transport.probes.unknownMethod = ex;
    s.transport.probes.discover = exchange({ status: 200, json: { jsonrpc: '2.0', id: 1, result: { supportedVersions: ['v'] } }, jsonParsed: true, jsonRpc: [{ id: 1, result: true }] });
    s.authProbe = { challenge: ex, prmAttempts: [prm], as: [], active: { token: [{ ...ex }] } } as unknown as Snapshot['authProbe'];
    dropExchangeBodies(s);
    expect((s.transport.probes.unknownMethod as HttpExchange).json).toBeUndefined();
    const disc = s.transport.probes.discover as HttpExchange;
    expect(disc.json).toBeUndefined();
    expect(rpcView(disc)?.result).toEqual({ supportedVersions: ['v'] });
    expect(s.authProbe!.active!.token![0].json).toBeUndefined();
    expect(s.authProbe!.active!.token![0].oauthError).toBe('invalid_grant');
    expect(prm.json).toEqual({ resource: 'r' });
  });
});
