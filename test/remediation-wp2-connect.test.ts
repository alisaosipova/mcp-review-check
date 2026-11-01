// Regression tests for the WP2-connect remediation (review 2026-11-01): connect.ts, limits.ts, snapshot.ts,
// protocol/recording.ts and diagnose.ts.
import { fileURLToPath } from 'node:url';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, isJsonRpcLine, NON_JSON_KEPT, NON_JSON_LINE_CAP, stdoutTap, type BuildOptions } from '../src/connect.js';
import { RecordingTransport, TRANSPORT_ERRORS_KEPT } from '../src/protocol/recording.js';
import { createRedactor } from '../src/protocol/trace.js';
import { cli } from './cli-runner.js';
import { listen, type Started } from './fixtures/http-bridge.js';

const WP2 = fileURLToPath(new URL('./fixtures/wp2-stdio-server.mjs', import.meta.url));
const server = (...args: string[]) => `node "${WP2}" ${args.join(' ')}`;
const noRedact = createRedactor();

let servers: Started[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });
type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
/** An in-process HTTP fixture; the handler gets the request body read. */
async function http(handler: Handler, path = '/mcp'): Promise<Started> {
  const s = await listen(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    handler(req, res, Buffer.concat(chunks).toString('utf8'));
  }, path);
  servers.push(s);
  return s;
}
const build = (url: string, over: Partial<BuildOptions> = {}) => buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 3000, ...over }).then((r) => r.snap);

describe('stdio stdout tap (R046, F141, F012, C003)', () => {
  it('counts every non-JSON-RPC line but keeps only the first lines, each cut', () => {
    const tap = stdoutTap(noRedact);
    for (let i = 0; i < 5000; i++) tap.push(Buffer.from(`log line ${i} ${'y'.repeat(2000)}\n`));
    expect(tap.out.total).toBe(5000);
    expect(tap.out.lines).toHaveLength(NON_JSON_KEPT);
    expect(tap.out.lines[0].startsWith('log line 0 ')).toBe(true);
    expect(tap.out.lines[0].length).toBe(NON_JSON_LINE_CAP + 1); // the cut plus an ellipsis
  });

  it('treats a JSON log line as foreign output and a JSON-RPC message (or batch) as not', () => {
    expect(isJsonRpcLine('{"level":30,"msg":"request tools/list"}')).toBe(false);
    expect(isJsonRpcLine('[1,2]')).toBe(false);
    expect(isJsonRpcLine('42')).toBe(false);
    expect(isJsonRpcLine('{"jsonrpc":"2.0","id":1,"result":{}}')).toBe(true);
    expect(isJsonRpcLine(' [{"jsonrpc":"2.0","method":"x"}]')).toBe(true);
    const tap = stdoutTap(noRedact);
    tap.push(Buffer.from('{"level":30,"msg":"hi"}\n{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    expect(tap.out).toEqual({ lines: ['{"level":30,"msg":"hi"}'], total: 1 });
  });

  it('keeps only the head of a huge line without a newline, and joins a UTF-8 character split across chunks', () => {
    const tap = stdoutTap(noRedact);
    const chunk = Buffer.alloc(1024 * 1024, 'z');
    for (let i = 0; i < 64; i++) tap.push(chunk);
    tap.push(Buffer.from('\n'));
    expect(tap.out.total).toBe(1);
    expect(tap.out.lines[0].length).toBe(NON_JSON_LINE_CAP + 1);
    const euro = Buffer.from('price €\n');
    tap.push(euro.subarray(0, 7));
    tap.push(euro.subarray(7));
    expect(tap.out.lines[1]).toBe('price €');
  });
});

describe('RecordingTransport (R046, F033)', () => {
  it('keeps the first transport error messages and counts the rest; a response clears its pending request', async () => {
    const inner = { start: async () => {}, send: async () => {}, close: async () => {} } as unknown as Transport;
    const rec = new RecordingTransport(inner);
    await rec.start();
    for (let i = 0; i < 1000; i++) inner.onerror?.(new SyntaxError(`Unexpected token ${i}`));
    inner.onerror?.(new Error('ReadBuffer exceeded maximum size of 10485760 bytes'));
    expect(rec.transportErrors).toHaveLength(TRANSPORT_ERRORS_KEPT);
    expect(rec.transportErrorCount).toBe(1001);
    expect(rec.overflow).toMatch(/ReadBuffer exceeded/);
    await rec.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    expect(rec.pending.size).toBe(1);
    inner.onmessage?.({ jsonrpc: '2.0', id: 7, result: { tools: [] } });
    expect(rec.pending.size).toBe(0);
  });
});

describe('stdio servers that write to stdout (C003, R046)', () => {
  it('SRV-018 reports JSON log lines (pino) on stdout', async () => {
    const r = await cli(['--stdio', server('pino'), '--format', 'json']);
    const f = r.json.findings.find((x: any) => x.ruleId === 'SRV-018');
    expect(f, r.stderr).toBeDefined();
    expect(f.message).toMatch(/^6 non-JSON line\(s\) on stdout: .*level.*request initialize/);
  });

  it('a flood of stdout lines before initialize is counted without keeping every line', async () => {
    const r = await cli(['--stdio', server('spam', '200000'), '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(134);
    expect(r.json.findings.find((x: any) => x.ruleId === 'SRV-018')).toBeDefined();
  }, 60000);
});

describe('a stdio handshake that fails or is stopped keeps what the server printed (R002, R048, C-imp-1)', () => {
  it('--timeout: the fatal names stdout and stderr, points to HTTP, and SRV-018 reports the banner', async () => {
    const r = await cli(['--stdio', server('banner'), '--format', 'json', '--timeout', '1500']);
    expect(r.code, r.stderr).toBe(3);
    const srv003 = r.json.findings.find((x: any) => x.ruleId === 'SRV-003');
    expect(srv003.message).toContain('stderr: srv: waiting for DATABASE_URL');
    expect(srv003.message).toContain('stdout: MCP server listening on http://localhost:3000/mcp');
    expect(srv003.message).toContain('check it over HTTP (mcp-review-check http://localhost:3000/mcp)');
    expect(r.json.findings.find((x: any) => x.ruleId === 'SRV-018')?.message).toContain('listening on');
  });

  it('--max-duration during connect: the stderr cause is in the fatal and --verbose prints stderr', async () => {
    const r = await cli(['--stdio', server('banner'), '--verbose', '--max-duration', '1500', '--timeout', '20000']);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('no handshake within --max-duration (1500 ms); stderr: srv: waiting for DATABASE_URL');
    expect(r.stderr).toContain('[stdio stderr]');
    expect(r.stderr).toContain('srv: waiting for DATABASE_URL');
  });
});

describe('the HTTP+SSE fallback error is kept (R007)', () => {
  it('a 401 on GET /sse only (no POST route) is an auth requirement, not "not an MCP endpoint"', async () => {
    const s = await http((req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/sse')) {
        res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="http://${req.headers.host}/.well-known/oauth-protected-resource"` }).end();
      } else res.writeHead(404).end();
    }, '/sse');
    const snap = await build(s.url);
    expect(snap.coverage.toolLevel).toBe('auth-required');
    expect(snap.authProbe?.challenge?.status).toBe(401);
    expect(snap.transport.kind).toBe('sse');
    expect(snap.fatal).toBeUndefined();
  });

  it('an SSE stream whose endpoint is on another origin reports the SSE error', async () => {
    const s = await http((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: endpoint\ndata: http://internal-backend:8000/messages?session=1\n\n');
      } else res.writeHead(405).end();
    }, '/sse');
    const snap = await build(s.url);
    expect(snap.coverage.toolLevel).toBe('connect-failed');
    expect(snap.fatal).toContain('serves the deprecated HTTP+SSE transport, but its handshake failed: SSE fallback:');
    expect(snap.fatal).toMatch(/origin/i);
    expect(snap.fatal).not.toContain('usually serve');
  });
});

/** A 401 with a Bearer challenge pointing at a PRM document. */
function unauthorized(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="http://${req.headers.host}/meta/prm"` });
  res.end('{"error":"unauthorized"}');
}

describe('auth detection (F006, R044, R045)', () => {
  it('a 401 to credentials sent with --header is "credentials rejected", not "requires OAuth"', async () => {
    const s = await http(unauthorized);
    const snap = await build(s.url, { headers: { 'X-Api-Key': 'k-123' } });
    expect(snap.coverage).toEqual({ toolLevel: 'token-rejected', reason: 'supplied credentials rejected (401)' });
    expect(snap.authProbe?.trigger).toBe('preflight-401'); // the unauthenticated preflight got the 401 first, as with --bearer
    const plain = await build(s.url, { headers: { 'X-Trace': '1' } });
    expect(plain.coverage.toolLevel).toBe('auth-required');
  });

  it('a preflight 403 without a challenge does not hide the 401 challenge the token got', async () => {
    const s = await http((req, res) => {
      if (req.url === '/meta/prm') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ resource: `http://${req.headers.host}/mcp`, authorization_servers: [`http://${req.headers.host}`] })); return; }
      if (!req.headers.authorization) { res.writeHead(403, { 'content-type': 'application/json' }).end('{"message":"Missing Authentication Token"}'); return; }
      unauthorized(req, res);
    }, '/mcp');
    const snap = await build(s.url, { bearer: 'expired' });
    expect(snap.authProbe?.trigger).toBe('bearer-rejected');
    expect(snap.authProbe?.challenge?.status).toBe(401);
    expect(snap.authProbe?.prm?.via).toBe('header');
  });

  it('a public initialize with a 401 on tools/list runs the auth probe instead of reporting list and wire failures', async () => {
    const s = await http((req, res, body) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      const m = JSON.parse(body || '{}');
      if (m.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'half', version: '1' } } }));
      } else if (m.method === 'notifications/initialized') res.writeHead(202).end();
      else unauthorized(req, res);
    });
    const snap = await build(s.url);
    expect(snap.coverage.toolLevel).toBe('auth-required');
    expect(snap.authProbe?.challenge?.status).toBe(401);
    expect(snap.listMeta).toEqual({});
    expect(snap.transport.probes.unknownMethod).toBeUndefined();
  });
});
