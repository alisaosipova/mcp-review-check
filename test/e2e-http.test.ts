// End-to-end: the built CLI against in-process HTTP fixtures (bridge, legacy SSE, OAuth, 2026-07-28).
import { afterEach, describe, expect, it } from 'vitest';
import { startAuthServer } from './fixtures/auth-server.js';
import { listen, startBridge, type BridgeOptions, type Started } from './fixtures/http-bridge.js';
import { startModernServer } from './fixtures/modern-server.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
// @ts-expect-error untyped .mjs fixture
import { createBadServer } from './fixtures/bad-server.mjs';
import { cli, nonInfo, ruleIds } from './cli-runner.js';

let servers: Started[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });
const track = (s: Started) => (servers.push(s), s);
const good = (opts: BridgeOptions = {}) => startBridge(createGoodServer, { rejectForeignOrigin: true, ...opts }).then(track);

describe('e2e http', () => {
  it('GOOD server over Streamable HTTP: zero errors and zero warnings', async () => {
    const s = await good();
    const r = await cli([s.url, '--format', 'json']);
    expect(r.code, r.stderr).toBe(0);
    expect(nonInfo(r.json)).toEqual([]);
    expect(r.json.server).toMatchObject({ era: 'legacy', transport: 'streamable-http', localMode: true });
    // local mode: deploy-time checks are informational
    expect(r.json.findings.find((f: any) => f.ruleId === 'SRV-001')).toMatchObject({ severity: 'info' });
  });

  it('BAD server over HTTP adds wire-level findings', async () => {
    const s = track(await startBridge(createBadServer, { notification200: true, sessionId: () => 'abc' }));
    const r = await cli([s.url, '--format', 'json']);
    expect(r.code).toBe(1);
    const ids = ruleIds(r.json);
    for (const id of ['SPEC-004', 'SPEC-006', 'SRV-008', 'TOOL-011', 'INJ-005', 'APPS-007']) expect(ids, id).toContain(id);
  });

  it('wrong Content-Type → SPEC-003 error; the SDK cannot connect (exit 3)', async () => {
    const s = track(await startBridge(createGoodServer, { wrongContentType: true }));
    const r = await cli([s.url, '--format', 'json']);
    expect(r.code).toBe(3);
    expect(r.json.findings.find((f: any) => f.ruleId === 'SPEC-003')?.message).toMatch(/text\/plain/);
  });

  it('cross-host redirect → SRV-006 error and exit 3', async () => {
    const s = await good({ redirectTo: 'https://elsewhere.test/mcp' });
    const r = await cli([s.url, '--format', 'json']);
    expect(r.code).toBe(3);
    expect(r.json.findings.find((f: any) => f.ruleId === 'SRV-006')?.message).toMatch(/another host/);
  });

  it('Invalid Host 403 → SRV-007', async () => {
    const s = await good({ invalidHost: true });
    const r = await cli([s.url, '--format', 'json']);
    expect(ruleIds(r.json)).toContain('SRV-007');
    expect(r.code).toBe(3);
  });

  it('overly strict Origin validation → SRV-008 warnings for both hosts', async () => {
    const s = await good({ strictOrigin: true });
    const r = await cli([s.url, '--format', 'json']);
    const f = r.json.findings.filter((x: any) => x.ruleId === 'SRV-008');
    expect(f.map((x: any) => x.platforms[0]).sort()).toEqual(['chatgpt', 'claude']);
    expect(f.every((x: any) => x.severity === 'warning')).toBe(true);
  });

  it('legacy HTTP+SSE only → SSE fallback and SRV-003 warning', async () => {
    const s = await good({ sseOnly: true });
    const r = await cli([s.url, '--format', 'json']);
    expect(r.json.server.transport).toBe('sse');
    expect(r.json.server.era).toBe('sse-legacy');
    expect(r.json.findings.find((f: any) => f.ruleId === 'SRV-003')?.severity).toBe('warning');
    expect(r.json.server.serverInfo.name).toBe('acme-notes');
  });

  it('401 → coverage notice plus auth findings; exit follows --fail-on', async () => {
    const s = track(await startAuthServer({ noS256: true }));
    const r = await cli([s.url]);
    expect(r.stdout).toContain('Server requires OAuth. Auth checks ran');
    expect(r.stdout).toContain('AUTH-011');
    expect(r.code).toBe(1);
    const j = (await cli([s.url, '--format', 'json'])).json;
    expect(j.coverage.toolLevel).toBe('auth-required');
    expect(j.skipped.find((x: any) => x.ruleId === 'TOOL-011').reason).toMatch(/requires auth/);
    expect(j.summary.score).toBeNull();
  });

  it('a clean OAuth server without --bearer is INCOMPLETE, never a pass verdict', async () => {
    const s = track(await startAuthServer({}));
    const r = await cli([s.url, '--format', 'json']);
    expect(r.json.summary.score).toBeNull();
    for (const v of Object.values(r.json.summary.verdicts) as any[]) expect(v.verdict).toMatch(/INCOMPLETE|BLOCKED/);
    expect((await cli([s.url])).stdout).toContain('Score n/a (partial check: auth-required)');
  });

  it('valid --bearer reaches the tools; the token never appears in any output', async () => {
    const TOKEN = 'tok_very_secret_value_123';
    const s = track(await startAuthServer({ validToken: TOKEN, mcp: createGoodServer }));
    for (const format of ['text', 'json', 'markdown', 'sarif']) {
      const r = await cli([s.url, '--bearer', TOKEN, '--format', format, '--verbose', '--header', 'X-Api-Key: other_secret_456']);
      expect(r.stdout + r.stderr, format).not.toContain(TOKEN);
      expect(r.stdout + r.stderr, format).not.toContain('other_secret_456');
      if (format === 'json') {
        expect(r.json.coverage.toolLevel).toBe('ok');
        expect(r.json.server.serverInfo.name).toBe('acme-notes');
      }
    }
    // the env var works too
    const r = await cli([s.url, '--format', 'json'], { MCP_REVIEW_CHECK_TOKEN: TOKEN });
    expect(r.json.coverage.toolLevel).toBe('ok');
  });

  it('rejected --bearer → token-rejected notice', async () => {
    const s = track(await startAuthServer({ validToken: 'right', mcp: createGoodServer }));
    const r = await cli([s.url, '--bearer', 'wrong-token']);
    expect(r.stdout).toContain('rejected the token');
    expect(r.stdout).not.toContain('wrong-token');
  });

  it('modern 2026-07-28 server: era detected, clean SPEC results', async () => {
    const s = track(await startModernServer());
    const r = await cli([s.url, '--format', 'json']);
    expect(r.json.server).toMatchObject({ era: 'modern', protocolVersion: '2026-07-28' });
    expect(r.json.server.serverInfo.name).toBe('acme-docs');
    const spec = r.json.findings.filter((f: any) => f.ruleId.startsWith('SPEC-'));
    expect(spec).toEqual([]);
    expect(r.json.findings.some((f: any) => f.ruleId === 'TOOL-001')).toBe(false);
  });

  it('modern server: Mcp-Name is sent, so --active calls and the resource probe are not rejected with -32020', async () => {
    const s = track(await startModernServer());
    const r = await cli([s.url, '--format', 'json', '--active']);
    expect(r.json.findings.filter((f: any) => f.ruleId.startsWith('SPEC-'))).toEqual([]);
    // the fixture accepts any arguments, so RT-002 proves that tools/call reached the tool; nothing was a JSON-RPC error
    const rt = r.json.findings.filter((f: any) => f.ruleId.startsWith('RT-')).map((f: any) => f.ruleId);
    expect(rt).toContain('RT-002');
    expect(rt).not.toContain('RT-003');
  });

  it('modern server: a tools/list page larger than 256 KB is read in full', async () => {
    const s = track(await startModernServer({ extraTools: 400 }));
    const r = await cli([s.url, '--format', 'json']);
    expect(r.json.coverage.toolLevel).toBe('ok');
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(r.json.skipped.some((x: any) => /tools\/list/.test(x.reason))).toBe(false);
  });

  it('modern bad server: caching and session findings', async () => {
    const s = track(await startModernServer({ bad: true }));
    const ids = ruleIds((await cli([s.url, '--format', 'json'])).json);
    for (const id of ['SPEC-013', 'SPEC-015', 'SPEC-006']) expect(ids, id).toContain(id);
  });

  it('U-11: dual-era server (2026-07-28 and 2025-11-25 on one endpoint): era dual, clean, exit 0', async () => {
    const s = track(await startModernServer({ dual: true }));
    const r = await cli([s.url, '--format', 'json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.server).toMatchObject({ era: 'dual', protocolVersion: '2025-11-25', transport: 'streamable-http' });
    expect(r.json.server.serverInfo.name).toBe('acme-docs');
    expect(r.json.coverage.toolLevel).toBe('ok');
    expect(nonInfo(r.json)).toEqual([]);
    // --active reaches the tools through the 2025-11-25 side; the 2026-07-28 wire probes find nothing to report
    const a = await cli([s.url, '--format', 'json', '--active']);
    expect(a.json.findings.filter((f: any) => f.ruleId.startsWith('SPEC-'))).toEqual([]);
    expect(ruleIds(a.json)).toContain('RT-002');
  });

  it('unreachable server → exit 3 with a report', async () => {
    const s = await good();
    const url = s.url;
    await s.close();
    servers = [];
    const r = await cli([url, '--format', 'json', '--timeout', '3000']);
    expect(r.code).toBe(3);
    const srv003 = r.json.findings.find((f: any) => f.ruleId === 'SRV-003');
    expect(srv003).toMatchObject({ severity: 'error', platforms: ['spec'] });
    // B7: the cause code is surfaced, and a connect failure reads INCOMPLETE (as for stdio), not BLOCKED
    expect(srv003.message).toMatch(/connection refused by 127\.0\.0\.1:\d+ \(ECONNREFUSED\)/);
    expect(r.json.coverage.diagnosis).toMatchObject({ kind: 'refused', code: 'ECONNREFUSED' });
    expect(r.json.summary.verdicts.claude.verdict).toBe('INCOMPLETE');
    expect(r.json.summary.verdicts.chatgpt.verdict).toBe('INCOMPLETE');
    expect(r.json.manual).toEqual([]);
    const text = await cli([url, '--timeout', '3000']);
    expect(text.stdout).toMatch(/Could not connect: connection refused by .*nothing is listening there/);
    expect(text.stdout).not.toMatch(/MANUAL CHECKLIST/);
  });

  it('B7: an HTML 404 page is "not an MCP endpoint" with a /mcp suggestion and no HTML in the report', async () => {
    const page = track(await listen((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><head><title>Page not found</title><style>body{}</style></head><body><h1>Oops</h1>${'<p>filler</p>'.repeat(200)}</body></html>`);
    }, '/'));
    const r = await cli([page.url, '--format', 'json', '--timeout', '3000']);
    expect(r.code).toBe(3);
    const msg = r.json.findings.find((f: any) => f.ruleId === 'SRV-003').message;
    expect(msg).toContain(`HTTP 404 with an HTML page ("Page not found"): ${page.url} is not an MCP endpoint; try ${page.base}/mcp`);
    expect(msg).not.toMatch(/<|filler/);
    expect(r.json.summary.verdicts.claude.verdict).toBe('INCOMPLETE');
  });

  it('B7: a /sse URL that no longer serves SSE suggests /mcp', async () => {
    const gone = track(await listen((_req, res) => {
      res.writeHead(_req.method === 'GET' ? 410 : 405, { 'content-type': 'application/json' });
      res.end('{"error":"SSE transport is deprecated"}');
    }, '/sse'));
    const r = await cli([gone.url, '--format', 'json', '--timeout', '3000']);
    expect(r.code).toBe(3);
    expect(r.json.coverage.reason).toBe(`HTTP 405: ${gone.url} is not an MCP endpoint; /sse is the deprecated HTTP+SSE path; Streamable HTTP servers usually serve ${gone.base}/mcp`);
  });

  it('B7: a URL without a scheme gets a suggestion (exit 2)', async () => {
    const r = await cli(['mcp.example.com/mcp']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/did you mean https:\/\/mcp\.example\.com\/mcp\?/);
    expect((await cli(['localhost:3000/mcp'])).stderr).toMatch(/did you mean http:\/\/localhost:3000\/mcp\?/);
  });
});
