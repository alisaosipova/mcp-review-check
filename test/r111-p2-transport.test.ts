// 1.2.0 block P2 (transport and diagnosis): session DELETEs are not awaited inline (A02-05), the stop's DELETE follows a
// same-origin 307/308 (A02-01), SOCKS5 failures are diagnosed as the proxy's (A02-02, I-A02-3, I-A02-4), an initialize
// timeout names the request and the wait (A02-04), a 501 to the POST is "not an MCP endpoint" (A10-01), a server that
// accepts and never answers fails in about one connect wait (A10-03), and stdio lines are read in linear time (A09-05).
// Every server is local, on 127.0.0.1.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { Agent, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import crossSpawn from 'cross-spawn';
import { buildSnapshot, GroupStdioTransport, launchStdio, LineSplitter, sameOriginRedirect, SESSION_END_TIMEOUT_MS, stdoutTap } from '../src/connect.js';
import { describeCause, describeHttpFailure } from '../src/diagnose.js';
import { installProxy, proxyRouteLine } from '../src/proxy.js';
import { preflight } from '../src/probe/network.js';
import { createRedactor, createTracer } from '../src/protocol/trace.js';
import { tool } from './helpers.js';

// cross-spawn is spied on, not replaced: on Windows every stdio test in this file launches through it for real; the
// win32 launch-path test replaces one call only (mockImplementationOnce), so it runs on any OS.
vi.mock('cross-spawn', async (importOriginal) => {
  const real = await importOriginal<{ default: typeof import('cross-spawn').default }>();
  return { default: vi.fn(real.default) };
});

const realFetch = globalThis.fetch;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  setGlobalDispatcher(new Agent());
  globalThis.fetch = realFetch;
  await Promise.all(closers.splice(0).map((c) => c()));
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ base: string; port: number }> {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  const port = (srv.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port };
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const rpc = (body: string): { id?: unknown; method?: string } => { try { return JSON.parse(body); } catch { return {}; } };
const INIT = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'p2', version: '1.0.0' } };

/** Run `fn` with process.env keys set (the diagnosis reads the real environment). */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

describe('session DELETEs are not awaited one by one (A02-05)', () => {
  /** A stateful server: every initialize (raw probes and SDK connections) mints a session; DELETE hangs or answers 200. */
  const stateful = (hang: boolean) => {
    let n = 0;
    const deletes: string[] = [];
    return serve((req, res, body) => {
      if (req.method === 'DELETE') { deletes.push(String(req.headers['mcp-session-id'])); if (!hang) { res.writeHead(200); res.end(); } return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      const m = rpc(body);
      if (m.id === undefined) { res.writeHead(202); res.end(); return; }
      if (m.method === 'initialize') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: INIT }, { 'mcp-session-id': `s-${++n}` });
      if (m.method === 'tools/list') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: { tools: [tool({ name: 'search_notes' })] } });
      return json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    }).then((s) => ({ ...s, deletes }));
  };
  const timed = async (url: string) => { const t0 = Date.now(); const r = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 10000 }); return { ...r, ms: Date.now() - t0 }; };

  it('a server that never answers DELETE adds at most about SESSION_END_TIMEOUT_MS to the run', async () => {
    const ok = await stateful(false);
    const hang = await stateful(true);
    const a = await timed(`${ok.base}/mcp`);
    const b = await timed(`${hang.base}/mcp`);
    expect(a.snap.coverage.toolLevel).toBe('ok');
    expect(b.snap.coverage.toolLevel).toBe('ok');
    expect(hang.deletes.length).toBeGreaterThanOrEqual(5); // every minted session still gets its DELETE
    expect(b.ms - a.ms).toBeLessThan(SESSION_END_TIMEOUT_MS + 1000);
    // The DELETEs are no evidence for the rules.
    expect(b.snap.transport.exchanges.filter((e) => e.method === 'DELETE')).toEqual([]);
  }, 30000);
});

describe('the stop\'s DELETE follows a same-origin 307/308 (A02-01)', () => {
  it('reaches the session behind /mcp -> 308 /mcp/', async () => {
    const seen: string[] = [];
    let n = 0;
    const { base } = await serve((req, res, body) => {
      // The SDK's DELETE carries the protocol version; the raw probes' session closes do not.
      seen.push(`${req.method} ${req.url} ${req.headers['mcp-session-id'] ?? '-'}${req.headers['mcp-protocol-version'] ? ' sdk' : ''}`);
      if (req.url === '/mcp') { res.writeHead(308, { location: '/mcp/' }); res.end(); return; }
      if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
      const m = rpc(body);
      if (m.id === undefined) { res.writeHead(202); res.end(); return; }
      if (m.method === 'initialize') return json(res, 200, { jsonrpc: '2.0', id: m.id, result: INIT }, { 'mcp-session-id': `sess-redir-${++n}` });
      if (m.method === 'tools/list') return; // never answered: the run is stopped while it waits
      return json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url: `${base}/mcp` }, timeoutMs: 20000, maxDurationMs: 1500 });
    expect(snap.limits?.stopped).toBeDefined();
    const sdkDeletes = seen.filter((l) => l.startsWith('DELETE') && l.endsWith(' sdk'));
    expect(sdkDeletes).toEqual(['DELETE /mcp sess-redir-2 sdk', 'DELETE /mcp/ sess-redir-2 sdk']); // the 308, then the session
  }, 30000);

  it('follows only 307/308 within the origin and never to a URL with userinfo', () => {
    const from = new URL('http://127.0.0.1:8000/mcp');
    const r = (status: number, location?: string) => ({ status, headers: new Headers(location ? { location } : {}) });
    expect(sameOriginRedirect(from, r(308, '/mcp/'))?.href).toBe('http://127.0.0.1:8000/mcp/');
    expect(sameOriginRedirect(from, r(307, 'http://127.0.0.1:8000/x'))?.href).toBe('http://127.0.0.1:8000/x');
    expect(sameOriginRedirect(from, r(302, '/mcp/'))).toBeUndefined();
    expect(sameOriginRedirect(from, r(308, 'http://127.0.0.1:8001/mcp/'))).toBeUndefined();
    expect(sameOriginRedirect(from, r(308, 'http://evil.invalid/mcp/'))).toBeUndefined();
    expect(sameOriginRedirect(from, r(308, 'http://u:p@127.0.0.1:8000/mcp/'))).toBeUndefined();
    expect(sameOriginRedirect(from, r(308))).toBeUndefined();
    expect(sameOriginRedirect(from, r(308, '/mcp'))).toBeUndefined(); // to itself
  });
});

/** A SOCKS5 server on 127.0.0.1: `auth` asks for user/password and rejects it, `none` offers no acceptable method,
 *  `reply` answers the CONNECT with that RFC 1928 reply code. */
async function socks(mode: { auth: 'reject' } | { none: true } | { reply: number }): Promise<string> {
  const conns = new Set<net.Socket>();
  const srv = net.createServer((c) => {
    conns.add(c); c.on('close', () => conns.delete(c)); c.on('error', () => {});
    c.once('data', () => {
      if ('none' in mode) { c.end(Buffer.from([5, 0xff])); return; }
      if ('auth' in mode) {
        c.write(Buffer.from([5, 2]));
        c.once('data', () => c.end(Buffer.from([1, 1])));
        return;
      }
      c.write(Buffer.from([5, 0]));
      c.once('data', () => c.end(Buffer.from([5, mode.reply, 0, 1, 0, 0, 0, 0, 0, 0])));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { for (const c of conns) c.destroy(); srv.close(() => r()); }));
  return `127.0.0.1:${(srv.address() as AddressInfo).port}`;
}

const SECRET = ['SYNTH', 'sockspass', '7c1e'].join('_');

describe('SOCKS5 proxy failures are the proxy\'s (A02-02, I-A02-3)', () => {
  const target = 'http://127.0.0.1:39999/mcp'; // never reached: the proxy answers first (port 9 is on fetch's bad-port list)
  const run = async (env: Record<string, string>) => {
    installProxy(env);
    return withEnv(env, () => buildSnapshot({ target: { kind: 'http', url: target }, timeoutMs: 3000 })).then((r) => r.snap);
  };

  it('a rejected user name and password', async () => {
    const hp = await socks({ auth: 'reject' });
    const snap = await run({ ALL_PROXY: `socks5://alice:${SECRET}@${hp}` });
    const d = snap.connectDiagnosis!;
    expect(d).toMatchObject({ kind: 'other', code: 'UND_ERR_SOCKS5_AUTH_FAILED' });
    expect(d.summary).toBe(`the SOCKS5 proxy socks5://${hp} rejected the user name and password (UND_ERR_SOCKS5_AUTH_FAILED)`);
    expect(d.hint).toContain('ALL_PROXY');
    expect(JSON.stringify(snap.connectDiagnosis) + snap.fatal).not.toContain(SECRET);
    expect(JSON.stringify(snap.connectDiagnosis)).not.toContain('alice');
  }, 20000);

  it('no acceptable authentication method', async () => {
    const hp = await socks({ none: true });
    const d = (await run({ ALL_PROXY: `socks5://${hp}` })).connectDiagnosis!;
    expect(d.code).toBe('UND_ERR_SOCKS5_AUTH_REJECTED');
    expect(d.summary).toMatch(/SOCKS5 proxy .* requires an authentication method/);
  }, 20000);

  it('maps the reply codes to their causes, end to end', async () => {
    const want: Record<number, { kind: string; text: RegExp }> = {
      5: { kind: 'refused', text: /could not connect to 127\.0\.0\.1:39999: connection refused/ },
      4: { kind: 'other', text: /could not reach 127\.0\.0\.1:39999: host unreachable/ },
      3: { kind: 'other', text: /could not reach 127\.0\.0\.1:39999: network unreachable/ },
      2: { kind: 'other', text: /not allowed by the proxy's rules/ },
    };
    for (const [code, w] of Object.entries(want)) {
      const hp = await socks({ reply: Number(code) });
      const d = (await run({ HTTP_PROXY: `socks5h://${hp}` })).connectDiagnosis!;
      expect(d.code, code).toBe(`UND_ERR_SOCKS5_REPLY_${code}`);
      expect(d.kind, code).toBe(w.kind);
      expect(d.summary, code).toMatch(w.text);
      expect(d.summary, code).toContain('SOCKS5 proxy');
    }
  }, 40000);

  it('a dead SOCKS5 proxy is named as one, with its variable and without CONNECT', () => withEnv({ ALL_PROXY: 'socks5://127.0.0.1:1' }, () => {
    const d = describeCause(new URL('https://mcp.example.com/mcp'), { code: 'ECONNREFUSED' });
    expect(d.kind).toBe('refused');
    expect(d.summary).toBe('cannot reach mcp.example.com:443 through the SOCKS5 proxy socks5://127.0.0.1:1 (ECONNREFUSED)');
    expect(d.hint).toMatch(/^check ALL_PROXY:/);
    expect(d.hint).not.toMatch(/CONNECT|HTTP proxy/);
  }));
});

describe('HTTP proxy diagnoses say what undici does (I-A02-3, I-A02-4)', () => {
  it('CONNECT is named only where undici tunnels', async () => {
    await withEnv({ HTTP_PROXY: 'http://proxy.corp:3128' }, () => {
      // http: target behind an http: proxy: plain forwarding, no CONNECT
      const plain = describeCause(new URL('http://mcp.example.com/mcp'), { code: 'ECONNREFUSED' });
      expect(plain.summary).toContain('through the HTTP proxy http://proxy.corp:3128');
      expect(plain.hint).toMatch(/^check HTTP_PROXY:/);
      expect(plain.hint).not.toContain('CONNECT');
      // https: target: CONNECT tunnel, the proxy comes from HTTP_PROXY (no HTTPS_PROXY set)
      const tunnel = describeCause(new URL('https://mcp.example.com/mcp'), { code: 'ECONNREFUSED' });
      expect(tunnel.hint).toMatch(/^check HTTP_PROXY: .*allows CONNECT/);
    });
    await withEnv({ HTTP_PROXY: 'https://proxy.corp:3129' }, () => {
      // an https: proxy tunnels http: targets too
      const d = describeCause(new URL('http://mcp.example.com/mcp'), { code: 'ECONNRESET' });
      expect(d.summary).toContain('through the HTTPS proxy https://proxy.corp:3129');
      expect(d.hint).toContain('allows CONNECT');
    });
  });

  it('a CONNECT 407 and a plain-forwarding 407 both name the proxy and its variable', () => withEnv({ HTTPS_PROXY: `http://bob:${SECRET}@proxy.corp:3128`, HTTP_PROXY: 'http://fwd.corp:8080' }, () => {
    const tunnel = describeCause(new URL('https://mcp.example.com/mcp'), { code: 'UND_ERR_ABORTED', message: 'Proxy response (407) !== 200 when HTTP Tunneling' });
    expect(tunnel).toMatchObject({ kind: 'http', status: 407 });
    expect(tunnel.summary).toContain('HTTP proxy http://proxy.corp:3128');
    expect(tunnel.hint).toContain('HTTPS_PROXY=http://user:pass@host:port');
    expect(JSON.stringify(tunnel)).not.toContain(SECRET);
    const plain = describeHttpFailure(new URL('http://mcp.example.com/mcp'), { status: 407 });
    expect(plain).toMatchObject({ kind: 'http', status: 407 });
    expect(plain.summary).toContain('http://fwd.corp:8080');
    expect(plain.hint).toContain('HTTP_PROXY=http://user:pass@host:port');
  }));

  it('a 407 behind a SOCKS5 proxy is the server\'s, not the proxy\'s', () => withEnv({ ALL_PROXY: 'socks5://127.0.0.1:1080' }, () => {
    const d = describeHttpFailure(new URL('http://mcp.example.com/mcp'), { status: 407, message: 'HTTP 407' });
    expect(d.summary).not.toContain('proxy socks5');
  }));

  it('the --verbose route line names the proxy, its variable and the method, without credentials', () => {
    const u = new URL('https://mcp.example.com/mcp');
    expect(proxyRouteLine(u, {})).toBeUndefined();
    expect(proxyRouteLine(u, { ALL_PROXY: `socks5://alice:${SECRET}@127.0.0.1:1080`, NO_PROXY: 'localhost' })).toBe('proxy: socks5://127.0.0.1:1080 via ALL_PROXY (SOCKS5; NO_PROXY: localhost)');
    expect(proxyRouteLine(u, { HTTPS_PROXY: 'http://p:3128' })).toBe('proxy: http://p:3128 via HTTPS_PROXY (CONNECT tunnel)');
    expect(proxyRouteLine(new URL('http://mcp.example.com/mcp'), { HTTP_PROXY: 'http://p:3128' })).toBe('proxy: http://p:3128 via HTTP_PROXY (plain forwarding)');
    expect(proxyRouteLine(u, { HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'example.com' })).toBe('proxy: none for mcp.example.com (direct; NO_PROXY: example.com)');
  });
});

describe('an initialize timeout names the request and the wait (A02-04)', () => {
  it('HTTP: the raw probes are answered, the SDK initialize is not', async () => {
    let inits = 0;
    const { base } = await serve((req, res, body) => {
      const m = rpc(body);
      if (m.method === 'initialize' && ++inits > 1) return; // the SDK's: never answered
      res.writeHead(404); res.end();
    });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url: `${base}/mcp` }, timeoutMs: 2000 });
    expect(snap.connectDiagnosis).toMatchObject({ kind: 'timeout', summary: 'initialize got no answer within 2000 ms' });
    expect(snap.connectDiagnosis?.hint).toContain('HTTP connect waits min(--timeout, 15000) ms');
    expect(snap.fatal).not.toContain('Request timed out');
  }, 20000);

  it('stdio: a server that never answers initialize', async () => {
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'] }, timeoutMs: 1500 });
    expect(snap.fatal).toMatch(/^could not start or initialize the stdio server: initialize got no answer within 1500 ms/);
    expect(snap.coverage.reason).not.toContain('Request timed out');
  }, 20000);
});

describe('a 501 to the POST means the URL is not an MCP endpoint (A10-01)', () => {
  const page = '<!DOCTYPE HTML><html><head><title>Error response</title></head><body>501 Unsupported method (\'POST\')</body></html>';
  it('unit: 501 and 405 with an HTML page are not-mcp with the /mcp hint; 500 and 502 stay server errors', () => {
    const u = new URL('http://127.0.0.1:8000/');
    for (const status of [501, 405]) {
      const d = describeHttpFailure(u, { status, contentType: 'text/html', body: page });
      expect(d.kind, String(status)).toBe('not-mcp');
      expect(d.hint, String(status)).toBe('try http://127.0.0.1:8000/mcp');
    }
    expect(describeHttpFailure(u, { status: 500, contentType: 'text/html', body: page }).kind).toBe('http');
    expect(describeHttpFailure(u, { status: 502, contentType: 'text/html', body: page }).kind).toBe('http');
  });

  it('end to end: a static file server', async () => {
    const { base } = await serve((req, res) => {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><title>Index</title></html>'); return; }
      res.writeHead(501, { 'content-type': 'text/html;charset=utf-8' }); res.end(page);
    });
    const { snap } = await buildSnapshot({ target: { kind: 'http', url: `${base}/` }, timeoutMs: 3000 });
    expect(snap.connectDiagnosis).toMatchObject({ kind: 'not-mcp', status: 501, hint: `try ${base}/mcp` });
  }, 20000);
});

describe('a server that accepts the connection and never answers (A10-03)', () => {
  it('fails in about one connect wait with kind no-answer, and the preflight timeout is not retried', async () => {
    const srv = net.createServer(() => {}); // accepts, reads nothing, answers nothing
    const conns = new Set<net.Socket>();
    srv.on('connection', (c) => { conns.add(c); c.on('error', () => {}); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise<void>((r) => { for (const c of conns) c.destroy(); srv.close(() => r()); }));
    const port = (srv.address() as AddressInfo).port;
    const t0 = Date.now();
    const { snap, tracer } = await buildSnapshot({ target: { kind: 'http', url: `http://127.0.0.1:${port}/mcp` }, timeoutMs: 3000 });
    const ms = Date.now() - t0;
    // preflight 3 s, then server/discover and the handshake 2 s each (STALLED_TIMEOUT_MS); before: 4 x 3 s
    expect(ms).toBeLessThan(9000);
    expect(snap.connectDiagnosis).toMatchObject({ kind: 'no-answer' });
    expect(snap.connectDiagnosis?.summary).toBe(`the server accepted the connection on 127.0.0.1:${port} but did not answer POST initialize within 3000 ms`);
    expect(snap.connectDiagnosis?.hint).toContain('raise --timeout');
    expect(tracer?.exchanges.map((e) => e.label)).not.toContain('preflight (retry 1)');
  }, 30000);

  it('a reset preflight is still retried', async () => {
    let n = 0;
    const { base } = await serve((req, res) => {
      if (++n === 1) { req.socket.destroy(); return; }
      json(res, 404, {});
    });
    const tracer = createTracer(createRedactor());
    const ex = await preflight(tracer, new URL(`${base}/mcp`), 3000, async () => {});
    expect(ex.status).toBe(404);
    expect(tracer.exchanges.map((e) => e.label)).toEqual(['preflight', 'preflight (retry 1)']);
  });
});

describe('stdio lines are read in linear time (A09-05)', () => {
  it('LineSplitter: a 62 MB line in 64 KB chunks is joined once', () => {
    const chunk = Buffer.alloc(64 * 1024, 'a');
    const s = new LineSplitter(64 * 1024 * 1024);
    const t0 = Date.now();
    let got: Buffer[] = [];
    for (let i = 0; i < 992; i++) got = got.concat(s.push(chunk)); // 62 MB
    got = got.concat(s.push(Buffer.from('b\nnext\n')));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(got.map((b) => b.length)).toEqual([992 * 64 * 1024 + 1, 4]);
    expect(() => new LineSplitter(10).push(Buffer.alloc(11, 'x'))).toThrow(/ReadBuffer exceeded maximum size of 10 bytes/);
  });

  it('on win32 the stdio server is launched through cross-spawn (npx, pnpm, .cmd and .bat shims), elsewhere not', () => {
    const opts = { shell: false, windowsHide: true };
    vi.mocked(crossSpawn).mockClear();
    vi.mocked(crossSpawn).mockImplementationOnce(() => ({ pid: 1 }) as never);
    launchStdio('npx', ['-y', 'some-mcp'], opts, 'win32');
    expect(vi.mocked(crossSpawn)).toHaveBeenCalledWith('npx', ['-y', 'some-mcp'], opts);
    vi.mocked(crossSpawn).mockClear();
    const child = launchStdio(process.execPath, ['-e', ''], { stdio: 'ignore' }, 'linux');
    child.on('error', () => {});
    expect(vi.mocked(crossSpawn)).not.toHaveBeenCalled();
  });

  it('LineSplitter gives the same lines for any chunking: 1-byte, odd sizes, CRLF and UTF-8 split across chunks', () => {
    const text = Buffer.from('{"a":"é€😀"}\r\n\nsecond line\nthird €\n tail');
    const want = ['{"a":"é€😀"}\r', '', 'second line', 'third €'];
    for (const size of [1, 2, 3, 5, 7, 16, 64, text.length]) {
      const s = new LineSplitter(1024);
      const out: string[] = [];
      for (let i = 0; i < text.length; i += size) out.push(...s.push(text.subarray(i, i + size)).map((b) => b.toString('utf8')));
      expect(out, `chunk ${size}`).toEqual(want);
    }
    const s = new LineSplitter(1024);
    expect(s.push(Buffer.alloc(0))).toEqual([]);
    expect(s.push(Buffer.from('\n')).map(String)).toEqual(['']);
  });

  it('LineSplitter: a line of exactly max bytes passes in any chunking, one byte more throws, also split over chunks', () => {
    for (const size of [1, 3, 10]) {
      const ok = new LineSplitter(10);
      const line = Buffer.from('0123456789\n');
      const got: Buffer[] = [];
      for (let i = 0; i < line.length; i += size) got.push(...ok.push(line.subarray(i, i + size)));
      expect(got.map(String), `chunk ${size}`).toEqual(['0123456789']);
      const over = new LineSplitter(10);
      const long = Buffer.from('0123456789A\n');
      expect(() => { for (let i = 0; i < long.length; i += size) over.push(long.subarray(i, i + size)); }, `chunk ${size}`).toThrow(/ReadBuffer exceeded maximum size of 10 bytes/);
    }
  });

  it('stdoutTap counts a message over the read buffer up to the buffer size, whatever the chunking', () => {
    const MAX = 64 * 1024 * 1024;
    const line = Buffer.alloc(MAX + 3 * 65536, 'z');
    line.write('{"jsonrpc":"2.0","id":1,"result":{"x":"');
    for (const size of [65536, 65536 + 777, 1 << 20, line.length]) {
      let counted = 0;
      const tap = stdoutTap(createRedactor(), (n) => { counted += n; });
      for (let i = 0; i < line.length; i += size) tap.push(line.subarray(i, i + size));
      tap.push(Buffer.from('\n'));
      expect(counted, `chunk ${size}`).toBe(MAX);
    }
  }, 60000);

  it('GroupStdioTransport hands each chunk to onChunk before its line reader, so the budget is charged before an overflow', async () => {
    // A 2 MB line against a 1 MB read buffer, written in small pieces: whatever the pipe chunking, the chunk that
    // overflows the reader was already seen by onChunk.
    const t = new GroupStdioTransport({ command: process.execPath, args: ['-e', "for (let i = 0; i < 512; i++) process.stdout.write('x'.repeat(4096)); process.stdout.write('\\n'); setTimeout(() => {}, 3000)"], stderr: 'pipe', maxBufferSize: 1024 * 1024 });
    let seen = 0;
    let atOverflow = -1;
    t.onChunk = (c) => { seen += c.length; };
    const overflow = new Promise<void>((done) => { t.onerror = (e) => { if (/ReadBuffer exceeded/.test(e.message) && atOverflow < 0) { atOverflow = seen; done(); } }; });
    await t.start();
    expect(t.readsOwnStdout).toBe(true);
    await overflow;
    await t.close();
    expect(atOverflow).toBeGreaterThan(1024 * 1024);
  }, 20000);

  it('a large JSON log line on stdout is still foreign output for SRV-018; a large JSON-RPC message is not', () => {
    const tap = stdoutTap(createRedactor());
    const log = `{"level":30,"msg":"${'x'.repeat(6000)}"}`;
    for (let i = 0; i < log.length; i += 1000) tap.push(Buffer.from(log.slice(i, i + 1000)));
    tap.push(Buffer.from('\n'));
    expect(tap.out.total).toBe(1);
    expect(tap.out.lines[0].startsWith('{"level":30,"msg":"xxx')).toBe(true);
    // "jsonrpc" first (the SDK's order) or last: both are messages
    tap.push(Buffer.from(`{"jsonrpc":"2.0","id":1,"result":{"pad":"${'y'.repeat(6000)}"}}\n`));
    tap.push(Buffer.from(`{"id":2,"result":{"pad":"${'y'.repeat(6000)}"},"jsonrpc":"2.0"}\n`));
    expect(tap.out.total).toBe(1);
  });

  it('stdoutTap charges a large JSON line as its bytes arrive, before the newline', () => {
    const sizes: number[] = [];
    const tap = stdoutTap(createRedactor(), (n) => sizes.push(n));
    const line = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { pad: 'x'.repeat(20000) } }));
    for (let i = 0; i < line.length; i += 1024) tap.push(line.subarray(i, i + 1024));
    const before = sizes.reduce((a, b) => a + b, 0);
    expect(before).toBeGreaterThan(4096);
    tap.push(Buffer.from('\n'));
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(line.length);
    expect(tap.out.total).toBe(0);
  });

  it.skipIf(!!process.env.MCP_REVIEW_CHECK_COVERAGE)('a 62 MB tools/list over stdio is listed within the timeout', async () => {
    const server = `
      const rl = require('node:readline').createInterface({ input: process.stdin });
      const pad = 'd'.repeat(100000);
      const tools = Array.from({ length: 620 }, (_, i) => ({ name: 't' + i, description: pad, inputSchema: { type: 'object' } }));
      rl.on('line', (l) => {
        const m = JSON.parse(l);
        if (m.id === undefined) return;
        const send = (x) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...x }) + '\\n');
        if (m.method === 'initialize') send({ result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'big', version: '1' } } });
        else if (m.method === 'tools/list') send({ result: { tools } });
        else send({ error: { code: -32601, message: 'no' } });
      });`;
    // Bytes copied by Buffer.concat while the run reads: the measure of the quadratic join, independent of machine load.
    // The SDK's ReadBuffer copied about 30 GB for this message (the buffer so far, once per 64 KB chunk).
    const concat = Buffer.concat;
    let copied = 0;
    Buffer.concat = ((list: readonly Uint8Array[], total?: number) => {
      copied += total ?? list.reduce((a, b) => a + b.length, 0);
      return concat(list, total);
    }) as typeof Buffer.concat;
    let snap;
    try {
      ({ snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: ['-e', server] }, timeoutMs: 30000 }));
    } finally { Buffer.concat = concat; }
    expect(snap.listMeta.tools?.error).toBeUndefined();
    expect(snap.tools).toHaveLength(620);
    // The listing is read once and the re-list until the budget stops it: a few joins of the message, not thousands.
    expect(copied).toBeLessThan(4 * 64 * 1024 * 1024);
  }, 180000);
});
