// Review round 3, package P2 (transport and proxy): ALL_PROXY redaction, NO_PROXY parity with undici, SSE response
// selection, 5xx and TLS-behind-a-proxy diagnoses, one stdio close sequence, the notification tally, and a server
// that answers only initialize.
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildSnapshot, GroupStdioTransport, STALLED_TIMEOUT_MS } from '../src/connect.js';
import { describeCause, describeHttpFailure } from '../src/diagnose.js';
import { ModernClient } from '../src/protocol/modern.js';
import { createRedactor, createTracer } from '../src/protocol/trace.js';
import { bypassesProxy, installProxy, PROXY_URL_VARS, proxyConfig, proxyEnvUrls } from '../src/proxy.js';
import { buildRedactor, scrub } from '../src/redact.js';

const PASS = ['SYNTH', 'allproxy', '7c1e'].join('_');
const USER = ['synthuser', '42'].join('');
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const PROXY_KEYS = [...PROXY_URL_VARS, ...PROXY_URL_VARS.map((k) => k.toLowerCase()), 'NO_PROXY', 'no_proxy'];

const realFetch = globalThis.fetch;
let closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  setGlobalDispatcher(new Agent());
  globalThis.fetch = realFetch;
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

/** Run `fn` with exactly these proxy variables in process.env (every other proxy variable unset). */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of new Set([...PROXY_KEYS, ...Object.keys(vars)])) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

async function serve(handler: http.RequestListener, host = '127.0.0.1'): Promise<{ port: number; server: http.Server }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, host, r));
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return { port: (server.address() as net.AddressInfo).port, server };
}

describe('A02-01 / A07-01: ALL_PROXY credentials are redacted like HTTP(S)_PROXY ones', () => {
  it('the redactor reads every variable proxyConfig routes through (one shared list)', () => {
    expect([...PROXY_URL_VARS].sort()).toEqual(['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY']);
    // proxyConfig honours ALL_PROXY, so the redaction list must hold it.
    expect(proxyConfig({ ALL_PROXY: 'http://p:1' })?.httpProxy).toBe('http://p:1');
    expect(proxyEnvUrls({ all_proxy: 'p:1', ALL_PROXY: 'socks5://q:2' })).toEqual(['socks5://q:2', 'http://p:1']);
  });

  for (const name of ['ALL_PROXY', 'all_proxy']) {
    for (const scheme of ['http', 'socks5']) {
      it(`${name}=${scheme}://user:pass@host: user, password and the Basic value are masked`, () => withEnv({ [name]: `${scheme}://${USER}:${PASS}@proxy.corp:3128` }, () => {
        const r = buildRedactor({});
        const text = `denied ${basic(USER, PASS)} ${USER}:${PASS}`;
        const out = scrub(text, r);
        expect(out).not.toContain(PASS);
        expect(out).not.toContain(USER);
        expect(out).not.toContain(Buffer.from(`${USER}:${PASS}`).toString('base64'));
      }));
    }
  }

  it('an echoing proxy from ALL_PROXY leaks nothing into the report', async () => {
    const { port } = await serve((req, res) => {
      const pa = String(req.headers['proxy-authorization'] ?? '');
      const decoded = Buffer.from(pa.replace(/^Basic /, ''), 'base64').toString();
      res.writeHead(404, { 'content-type': 'text/html' }).end(`<html><head><title>denied ${pa} ${decoded}</title></head></html>`);
    });
    const env = { ALL_PROXY: `http://${USER}:${PASS}@127.0.0.1:${port}` };
    await withEnv(env, async () => {
      installProxy(env);
      const r = await runCli(['http://mcp.example.invalid/mcp', '--no-config', '--format', 'json', '--timeout', '3000'], env, false);
      const out = r.stdout + r.stderr;
      expect(out).toContain('denied'); // the proxy's page did reach the report
      expect(out).not.toContain(PASS);
      expect(out).not.toContain(USER);
      expect(out).not.toContain(Buffer.from(`${USER}:${PASS}`).toString('base64'));
    });
  });
});

describe('A02-02: bypassesProxy decides NO_PROXY as undici does', () => {
  it('matches EnvHttpProxyAgent on the same inputs', async () => {
    const direct = (host: string) => serve((_q, s) => { s.end('direct'); }, host);
    const v4 = await direct('127.0.0.1');
    const v6 = await direct('::1');
    const proxy = await serve((req, res) => {
      const u = new URL(req.url!);
      res.end(`proxy ${u.host}`);
    });
    const targets = [`http://127.0.0.1:${v4.port}/`, `http://[::1]:${v6.port}/`, `http://localhost:${v4.port}/`];
    const values = ['localhost,*', '*', '[::1]', `[::1]:${v6.port}`, '[::1]:1', '127.0.0.1', `127.0.0.1:${v4.port}`, '127.0.0.1:1', '.0.0.1', '*.0.0.1', 'localhost', '::1', ''];
    const mismatches: string[] = [];
    for (const noProxy of values) {
      const agent = new EnvHttpProxyAgent({ httpProxy: `http://127.0.0.1:${proxy.port}`, httpsProxy: `http://127.0.0.1:${proxy.port}`, noProxy, proxyTunnel: false });
      for (const t of targets) {
        const body = await (await undiciFetch(t, { dispatcher: agent })).text();
        const u = new URL(t);
        const ours = bypassesProxy(u.hostname, Number(u.port), noProxy);
        const theirs = body === 'direct';
        if (ours !== theirs) mismatches.push(`NO_PROXY=${JSON.stringify(noProxy)} ${t}: ours=${ours ? 'direct' : 'proxy'} undici=${theirs ? 'direct' : 'proxy'}`);
      }
      await agent.close();
    }
    expect(mismatches).toEqual([]);
  });

  it('"*" inside a list matches nothing; a bracketed IPv6 entry matches the bracketed host', () => {
    expect(bypassesProxy('127.0.0.1', 9, 'localhost,*')).toBe(false);
    expect(bypassesProxy('[::1]', 9, '[::1]')).toBe(true);
    expect(bypassesProxy('::1', 9, '[::1]:9')).toBe(true);
    expect(bypassesProxy('x', 1, '*')).toBe(true);
  });
});

describe('A02-03: an SSE body yields the response, not a server request with the same id', () => {
  it('ModernClient.request and listAll get the result after a same-id ping', async () => {
    const { port } = await serve((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const id = JSON.parse(raw).id;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' })}\n\n`);
        res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } })}\n\n`);
      });
    });
    const c = new ModernClient(new URL(`http://127.0.0.1:${port}/mcp`), createTracer(createRedactor()), {});
    const r = await c.request('tools/list');
    expect(r.result).toEqual({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] });
    expect(r.idMismatch).toBeUndefined();
    const l = await c.listAll('tools/list', 'tools');
    expect(l.error).toBeUndefined();
    expect(l.items.map((t) => t.name)).toEqual(['echo']);
  });

  it('a 200 without any response says so instead of a bare "HTTP 200"', async () => {
    const { port } = await serve((req, res) => {
      req.resume();
      req.on('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'x' } })}\n\n`); });
    });
    const c = new ModernClient(new URL(`http://127.0.0.1:${port}/mcp`), createTracer(createRedactor()), {});
    const l = await c.listAll('tools/list', 'tools');
    expect(l.error).toBe('HTTP 200 without a JSON-RPC response to tools/list');
  });
});

describe('A02-04: a 5xx gateway page is not "not an MCP endpoint"', () => {
  const page = '<html><head><title>502 Bad Gateway</title></head><body><center>nginx</center></body></html>';
  it('502/503 HTML names the gateway and keeps the path', () => withEnv({}, () => {
    for (const status of [502, 503]) {
      const d = describeHttpFailure(new URL('http://127.0.0.1:18760/api'), { status, contentType: 'text/html', body: page, message: `HTTP ${status}: …` });
      expect(d.kind).toBe('http');
      expect(d.summary).not.toMatch(/not an MCP endpoint/);
      expect(d.hint ?? '').not.toMatch(/try http/);
      expect(d.summary).toMatch(new RegExp(`HTTP ${status} \\("502 Bad Gateway" HTML page\\): the gateway or proxy in front of the server could not reach 127\\.0\\.0\\.1:18760`));
    }
  }));
  it('an empty 502 through a proxy names the proxy, without a dangling ": "', () => withEnv({ HTTP_PROXY: `http://${USER}:${PASS}@127.0.0.1:18740` }, () => {
    const d = describeHttpFailure(new URL('http://127.0.0.1:18799/mcp'), { status: 502, message: 'HTTP 502: Streamable HTTP error: Error POSTing to endpoint: ' });
    expect(d.summary).toBe('HTTP 502: the HTTP proxy http://127.0.0.1:18740/ could not reach 127.0.0.1:18799');
    expect(JSON.stringify(d)).not.toContain(PASS);
  }));
  it('a plain-text 503 body stays in the diagnosis, on one line and capped', () => withEnv({}, () => {
    const url = new URL('http://127.0.0.1:18761/mcp');
    const d = describeHttpFailure(url, { status: 503, contentType: 'text/plain', message: 'Streamable HTTP error: Error POSTing to endpoint: upstream connect error\nor disconnect/reset before headers' });
    expect(d.summary).toBe('HTTP 503: the gateway or proxy in front of the server could not reach 127.0.0.1:18761 (it answered: upstream connect error or disconnect/reset before headers)');
    const sse = describeHttpFailure(url, { status: 502, message: 'Error POSTing to endpoint (HTTP 502): no healthy upstream' });
    expect(sse.summary).toMatch(/\(it answered: no healthy upstream\)$/);
    const long = describeHttpFailure(url, { status: 504, message: `Error POSTing to endpoint: ${'x'.repeat(500)}` });
    expect(long.summary).toMatch(/\(it answered: x{200}…\)$/);
  }));
  it('a plain-text 502 body that echoes the token is redacted in the report', async () => {
    const token = ['sk', 'live', 'SYNTH', 'gw502body'].join('_');
    const { port } = await serve((req, res) => {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`upstream refused ${String(req.headers.authorization ?? '')}`);
    });
    const r = await runCli([`http://127.0.0.1:${port}/mcp`, '--no-config', '--format', 'json', '--timeout', '3000', '--bearer', token], {}, false);
    const out = r.stdout + r.stderr;
    expect(out).toContain('it answered: upstream refused');
    expect(out).not.toContain(token);
  });
  it('a 404 HTML page is still not an MCP endpoint (unchanged)', () => withEnv({}, () => {
    expect(describeHttpFailure(new URL('http://h/api'), { status: 404, contentType: 'text/html', body: '<html></html>' }).kind).toBe('not-mcp');
  }));
});

describe('A02-05: a TLS failure behind a proxy names the proxy and NODE_EXTRA_CA_CERTS', () => {
  it('with HTTPS_PROXY', () => withEnv({ HTTPS_PROXY: `http://${USER}:${PASS}@127.0.0.1:18730` }, () => {
    const d = describeCause(new URL('https://127.0.0.2:18443/mcp'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    expect(d.kind).toBe('tls');
    expect(d.summary).toBe('TLS certificate presented for 127.0.0.2 through the proxy http://127.0.0.1:18730/ is not trusted (DEPTH_ZERO_SELF_SIGNED_CERT)');
    expect(d.hint).toMatch(/NODE_EXTRA_CA_CERTS/);
    expect(JSON.stringify(d)).not.toContain(PASS);
  }));
  it('without a proxy (unchanged)', () => withEnv({}, () => {
    expect(describeCause(new URL('https://h/mcp'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }).summary).toBe('TLS certificate of h is not trusted (DEPTH_ZERO_SELF_SIGNED_CERT)');
  }));
});

describe('A02-06: a stdio server that ignores stdin EOF and SIGTERM is closed with one wait per step', () => {
  it.skipIf(process.platform === 'win32')('close takes about 4 s (stdin EOF, SIGTERM), not 6 s, and the process is gone', async () => {
    const t = new GroupStdioTransport({ command: process.execPath, args: ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], stderr: 'ignore' });
    await t.start();
    const pid = t.pid!;
    const t0 = Date.now();
    await t.close();
    const took = Date.now() - t0;
    expect(took).toBeLessThan(5500);
    expect(took).toBeGreaterThanOrEqual(3900);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 20000);
});

describe('A04-04: the notification tally keeps server method names as plain keys', () => {
  it('constructor, toString and __proto__ are counted as numbers', async () => {
    const { port } = await serve((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([
          { jsonrpc: '2.0', method: 'constructor' }, { jsonrpc: '2.0', method: 'toString' }, { jsonrpc: '2.0', method: '__proto__' },
          { jsonrpc: '2.0', method: 'toString' }, { jsonrpc: '2.0', id: 1, result: {} },
        ]));
      });
    });
    const tracer = createTracer(buildRedactor({}));
    await tracer.request('n', `http://127.0.0.1:${port}/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), headers: { 'content-type': 'application/json' } });
    const m = tracer.notifications.methods;
    expect(Object.entries(m).sort()).toEqual([['__proto__', 1], ['constructor', 1], ['toString', 2]]);
    expect(Object.values(m).every((v) => typeof v === 'number')).toBe(true);
    expect(JSON.parse(JSON.stringify(tracer.notifications)).methods.toString).toBe(2);
  });
});

describe('A10-02: a server that answers only initialize', () => {
  const HANG = fileURLToPath(new URL('./fixtures/hang-server.mjs', import.meta.url));
  it('later requests wait briefly, a short wait is not reported as a failure, and the CLI hears it once', async () => {
    const stalls: string[] = [];
    const timeoutMs = 4000;
    const { snap } = await buildSnapshot({ target: { kind: 'stdio', command: process.execPath, args: [HANG] }, timeoutMs, onStall: (m) => stalls.push(m) });
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/stopped answering/);
    expect(snap.listMeta.tools?.error).toMatch(/Request timed out/);
    // Not requested with the full wait, so not recorded as failed (no SPEC-020 the full wait would not have given).
    expect(snap.listMeta.resources).toBeUndefined();
    expect(snap.listMeta.prompts).toBeUndefined();
    expect(snap.coverage.toolLevel).toBe('list-failed');
    expect(snap.coverage.reason).toMatch(/stopped answering after initialize: resources\/list, resources\/templates\/list, prompts\/list/);
    const probe = snap.transport.probes.unknownMethod as { durationMs: number; transportError?: string };
    expect(probe.transportError).toMatch(/timed out/);
    expect(probe.durationMs).toBeLessThan(timeoutMs);
    expect(STALLED_TIMEOUT_MS).toBeLessThan(timeoutMs);
  }, 90000);
});
