// End-to-end: the built CLI against in-process HTTP fixtures (bridge, legacy SSE, OAuth, 2026-07-28).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startAuthServer } from './fixtures/auth-server.js';
import { listen, startBridge, type BridgeOptions, type Started } from './fixtures/http-bridge.js';
import { startModernServer } from './fixtures/modern-server.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
// @ts-expect-error untyped .mjs fixture
import { createBadServer } from './fixtures/bad-server.mjs';
// @ts-expect-error untyped .mjs fixture
import { createUiCapServer } from './fixtures/ui-cap-server.mjs';
import { cli, nonInfo, ruleIds } from './cli-runner.js';

let servers: Started[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });
const track = (s: Started) => (servers.push(s), s);
const good = (opts: BridgeOptions = {}) => startBridge(createGoodServer, { rejectForeignOrigin: true, ...opts }).then(track);

interface Recorded { body: any; headers: Record<string, string | string[] | undefined> }

/** Forwards each POST to `target` and records its JSON-RPC body and headers; GET and DELETE get 405 (no stream to relay). */
async function recordingProxy(target: string): Promise<Started & { seen: Recorded[] }> {
  const seen: Recorded[] = [];
  const hop = ['host', 'content-length', 'connection', 'transfer-encoding', 'content-encoding', 'keep-alive'];
  const s = await listen(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    try { seen.push({ body: JSON.parse(body), headers: req.headers }); } catch { /* not JSON: forwarded unrecorded */ }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !hop.includes(k)) headers[k] = v;
    const up = await fetch(new URL(req.url ?? '/', target), { method: 'POST', headers, body, redirect: 'manual' });
    const out: Record<string, string> = {};
    up.headers.forEach((v, k) => { if (!hop.includes(k)) out[k] = v; });
    res.writeHead(up.status, out);
    res.end(Buffer.from(await up.arrayBuffer()));
  });
  return Object.assign(s, { seen });
}

const UI_EXT = { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } };

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

  it('strict Origin validation → SRV-008 info for both hosts (the host Origin values are unverified)', async () => {
    const s = await good({ strictOrigin: true });
    const r = await cli([s.url, '--format', 'json']);
    const f = r.json.findings.filter((x: any) => x.ruleId === 'SRV-008');
    expect(f.map((x: any) => x.platforms[0]).sort()).toEqual(['chatgpt', 'claude']);
    expect(f.every((x: any) => x.severity === 'info' && /not verified/.test(x.message))).toBe(true);
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

  it('R-12: a failed connect (http://localhost:1/mcp) never reads PASS (text, markdown, --output summary line)', async () => {
    const URL1 = 'http://localhost:1/mcp';
    const text = await cli([URL1, '--timeout', '3000', '--no-color']);
    expect(text.code).toBe(3);
    expect(text.stdout).toMatch(/Result: FAIL\b/);
    expect(text.stdout).not.toMatch(/Result: PASS/);
    const md = await cli([URL1, '--timeout', '3000', '--format', 'markdown']);
    expect(md.code).toBe(3);
    expect(md.stdout).toMatch(/\| Result \| FAIL\b/);
    expect(md.stdout).not.toMatch(/\| Result \| PASS/);
    const dir = mkdtempSync(join(tmpdir(), 'mrc-r12-'));
    try {
      const out = await cli([URL1, '--timeout', '3000', '--output', join(dir, 'report.md'), '--format', 'markdown']);
      expect(out.code).toBe(3);
      const summary = out.stderr.split('\n').find((l) => l.startsWith('mcp-review-check: score'));
      expect(summary).toMatch(/ · FAIL\b/);
      expect(summary).not.toMatch(/PASS/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('--max-duration (W1-8): a server that never answers is reported as a connect failure at the deadline', async () => {
    const silent = track(await listen(() => new Promise(() => {})));
    const t0 = Date.now();
    const r = await cli([silent.url, '--format', 'json', '--max-duration', '1500']);
    expect(Date.now() - t0).toBeLessThan(12000);
    expect(r.code).toBe(3);
    expect(r.json.limits.stopped).toMatchObject({ maxDurationMs: 1500, phase: 'connect' });
    expect(r.json.findings.find((f: any) => f.ruleId === 'SRV-003').message).toMatch(/no handshake within --max-duration \(1500 ms\)/);
  });

  it('--max-duration (W1-8): after the handshake the run stops with INCOMPLETE verdicts and names the phase', async () => {
    // Answers initialize (and refuses server/discover and GET); every later request hangs.
    const s = track(await listen(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      for await (const c of req) body += c;
      const m = JSON.parse(body);
      if (m.id === undefined) { res.writeHead(202).end(); return; }
      const reply = (x: object) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...x })); };
      if (m.method === 'initialize') return reply({ result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'hang', version: '1' } } });
      if (m.method === 'server/discover') return reply({ error: { code: -32601, message: 'Method not found' } });
      await new Promise(() => {});
    }));
    const t0 = Date.now();
    const r = await cli([s.url, '--format', 'json', '--timeout', '20000', '--max-duration', '2500']);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect([0, 1], r.stderr).toContain(r.code); // a handshake happened: not exit 3
    expect(r.json.server.era).toBe('legacy');
    expect(r.json.limits.stopped).toMatchObject({ maxDurationMs: 2500, phase: 'listing' });
    expect(r.json.coverage.toolLevel).toBe('stopped');
    expect(r.json.summary.verdicts.claude.verdict).toBe('INCOMPLETE');
    expect(r.json.summary.verdicts.chatgpt.verdict).toBe('INCOMPLETE');
    const md = await cli([s.url, '--format', 'markdown', '--max-duration', '1500']);
    expect(md.stdout).toMatch(/stopped by --max-duration 1500 ms during listing/);
  });

  it('B7: a URL without a scheme gets a suggestion (exit 2)', async () => {
    const r = await cli(['mcp.example.com/mcp']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/did you mean https:\/\/mcp\.example\.com\/mcp\?/);
    expect((await cli(['localhost:3000/mcp'])).stderr).toMatch(/did you mean http:\/\/localhost:3000\/mcp\?/);
  });

  it('R-19: a dotless host with a port and no scheme (mcp:8080/mcp) gets an http:// suggestion (exit 2)', async () => {
    for (const [raw, hint] of [['mcp:8080/mcp', 'http://mcp:8080/mcp'], ['app:3000', 'http://app:3000']]) {
      const r = await cli([raw]);
      expect(r.code, raw).toBe(2);
      expect(r.stderr).toContain(`did you mean ${hint}?`);
    }
  });

  it('R-17: a failed connect to a plain-http URL reads INCOMPLETE, even with the SRV-001 http error', async () => {
    const s = await good();
    const url = s.url;
    await s.close();
    servers = [];
    // --no-local keeps SRV-001 "URL uses http" an error for both directories, as for a public http:// URL.
    const r = await cli([url, '--no-local', '--format', 'json', '--timeout', '3000']);
    expect(r.code).toBe(3);
    expect(r.json.findings.find((f: any) => f.ruleId === 'SRV-001')).toMatchObject({ severity: 'error', platforms: ['claude', 'chatgpt'] });
    expect(r.json.summary.verdicts.claude.verdict).toBe('INCOMPLETE');
    expect(r.json.summary.verdicts.chatgpt.verdict).toBe('INCOMPLETE');
    const text = await cli([url, '--no-local', '--timeout', '3000']);
    expect(text.stdout).toMatch(/Claude: INCOMPLETE[^\n]* · ChatGPT: INCOMPLETE[^\n]* · Result: FAIL \(could not connect\)/);
    expect(text.stdout).not.toContain('BLOCKED');
  });

  it('D-4: the score is one number per server whatever --target; the findings and the exit code follow --target', async () => {
    // A destructive tool without openWorldHint: TOOL-012 is a ChatGPT error, and Claude has nothing against it.
    const s = track(await startBridge(() => {
      const server = createGoodServer();
      server.registerTool(
        'delete_tag',
        { title: 'Delete tag', description: 'Delete one tag from the user\'s Acme Notes workspace by its name.', annotations: { readOnlyHint: false, destructiveHint: true } },
        async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      );
      return server;
    }, { rejectForeignOrigin: true }));
    const [all, claude, chatgpt] = await Promise.all(['all', 'claude', 'chatgpt'].map((t) => cli([s.url, '--format', 'json', '--target', t])));
    expect(chatgpt.json.findings.filter((f: any) => f.ruleId === 'TOOL-012')).toMatchObject([{ severity: 'error', tool: 'delete_tag' }]);
    expect(claude.json.findings.filter((f: any) => f.ruleId === 'TOOL-012')).toEqual([]);
    expect(all.json.summary.score).toBeLessThan(100);
    expect(claude.json.summary.score).toBe(all.json.summary.score);
    expect(chatgpt.json.summary.score).toBe(all.json.summary.score);
    expect([all.code, claude.code, chatgpt.code]).toEqual([1, 0, 1]);
  });

  it('B3 over Streamable HTTP: the UI capability is declared and the text-only re-list feeds APPS-019', async () => {
    const bridge = track(await startBridge(() => createUiCapServer()));
    const proxy = await recordingProxy(bridge.url);
    track(proxy);
    const r = await cli([proxy.url, '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(3);
    // R-5: every initialize declares the extension (raw probes and the SDK handshake) except the one text-only re-list
    const inits = proxy.seen.filter((x) => x.body?.method === 'initialize');
    const declares = (x: Recorded) => JSON.stringify(x.body.params?.capabilities?.extensions ?? null) === JSON.stringify(UI_EXT);
    const raw = inits.filter((x) => x.headers.origin !== undefined); // the Origin probes are raw initialize requests
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.every(declares), JSON.stringify(raw.map((x) => x.body.params?.capabilities))).toBe(true);
    const textOnly = inits.filter((x) => !declares(x));
    expect(textOnly.map((x) => x.body.params?.capabilities)).toEqual([{}]);
    expect(inits.filter(declares).length).toBeGreaterThanOrEqual(3);
    // R-6: the UI hidden behind getUiCapability is seen and the missing text-only fallback is reported
    const ids = ruleIds(r.json);
    expect(ids).toContain('APPS-003');
    expect(r.json.findings.filter((f: any) => f.ruleId === 'APPS-019')).toEqual([expect.objectContaining({ tool: 'get_weather', severity: 'warning' })]);
    const ok = track(await startBridge(() => createUiCapServer({ fallback: true })));
    const withFallback = ruleIds((await cli([ok.url, '--format', 'json'])).json);
    expect(withFallback).toContain('APPS-003');
    expect(withFallback).not.toContain('APPS-019');
  });

  it('B3 on a 2026-07-28 server: _meta clientCapabilities declares the UI extension', async () => {
    const modern = track(await startModernServer());
    const proxy = await recordingProxy(modern.url);
    track(proxy);
    const r = await cli([proxy.url, '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(3);
    const caps = proxy.seen.map((x) => x.body?.params?._meta?.['io.modelcontextprotocol/clientCapabilities']).filter((c) => c !== undefined);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps).toEqual(caps.map(() => ({ extensions: UI_EXT })));
  });
});
