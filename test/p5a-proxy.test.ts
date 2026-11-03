// HTTP(S)_PROXY / NO_PROXY support: global fetch goes through the proxy, NO_PROXY bypasses it, 407 and a dead proxy are diagnosed, credentials are redacted.
import http from 'node:http';
import net from 'node:net';
import { Agent, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { listen, startBridge, type Started } from './fixtures/http-bridge.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
import { runCli } from '../src/cli.js';
import { bypassesProxy, installProxy, proxyConfig, proxyForUrl } from '../src/proxy.js';
import { describeCause } from '../src/diagnose.js';
import { defaultDeps, tlsCheckWithRetry } from '../src/probe/network.js';
import { buildRedactor, scrub } from '../src/redact.js';

const PASS = ['SYNTH', 'proxypass', '9f3a1c'].join('_');
const realFetch = globalThis.fetch;
let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  setGlobalDispatcher(new Agent());
  globalThis.fetch = realFetch;
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

interface Proxy { url: string; port: number; seen: string[] }
/** A forward proxy for http: and a CONNECT proxy; `status` answers every request with that status instead (407). */
async function startProxy(status?: number): Promise<Proxy> {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (status) { res.writeHead(status, { 'proxy-authenticate': 'Basic realm="corp"' }).end(); return; }
    const u = new URL(req.url!);
    const up = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode!, r.headers); r.pipe(res); });
    req.pipe(up);
  });
  server.on('connect', (req, socket) => {
    seen.push(`CONNECT ${req.url}`);
    if (status) { socket.end(`HTTP/1.1 ${status} Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="corp"\r\n\r\n`); return; }
    const [h, p] = req.url!.split(':');
    const up = net.connect(Number(p), h, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.pipe(socket); socket.pipe(up); });
    up.on('error', () => socket.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return { url: `http://127.0.0.1:${port}`, port, seen };
}
const mcp = async (): Promise<Started> => { const s = await startBridge(createGoodServer, {}); closers.push(s.close); return s; };

/** Run `fn` with process.env keys set (the redactor and the diagnosis read the real environment). */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

describe('proxy env parsing', () => {
  it('reads both cases, adds a scheme, ignores an empty set', () => {
    expect(proxyConfig({})).toBeUndefined();
    expect(proxyConfig({ https_proxy: 'proxy:3128', NO_PROXY: 'a.com' })).toEqual({ httpProxy: undefined, httpsProxy: 'http://proxy:3128', noProxy: 'a.com' });
  });
  it('NO_PROXY matching', () => {
    expect(bypassesProxy('api.example.com', 443, '.example.com')).toBe(true);
    expect(bypassesProxy('example.com', 443, '*.example.com')).toBe(true);
    expect(bypassesProxy('badexample.com', 443, 'example.com')).toBe(false);
    expect(bypassesProxy('h', 8080, 'h:9090')).toBe(false);
    expect(bypassesProxy('h', 9090, 'h:9090')).toBe(true);
    expect(bypassesProxy('x', 1, '*')).toBe(true);
    expect(proxyForUrl(new URL('https://a.example.com/'), { HTTPS_PROXY: 'http://p:1', NO_PROXY: 'example.com' })).toBeUndefined();
    expect(proxyForUrl(new URL('http://a.com/'), { HTTPS_PROXY: 'http://p:1' })).toBeUndefined();
  });
  it('installs nothing without a proxy variable', () => {
    expect(installProxy({})).toBe(false);
    expect(installProxy({ HTTP_PROXY: 'http://127.0.0.1:1' })).toBe(true);
  });
});

describe('proxy end to end', () => {
  it('sends the check through the proxy', async () => {
    const s = await mcp();
    const p = await startProxy();
    const env = { HTTP_PROXY: p.url };
    installProxy(env);
    const r = await withEnv(env, () => runCli([s.url, '--format', 'json'], env, false));
    expect(r.code, r.stderr).toBe(0);
    expect(p.seen.length).toBeGreaterThan(0);
    expect(p.seen.every((l) => l.includes(`:${new URL(s.url).port}`))).toBe(true);
  });

  it('NO_PROXY bypasses the proxy', async () => {
    const s = await mcp();
    const p = await startProxy();
    const env = { HTTP_PROXY: p.url, NO_PROXY: '127.0.0.1' };
    installProxy(env);
    const r = await withEnv(env, () => runCli([s.url, '--format', 'json'], env, false));
    expect(r.code, r.stderr).toBe(0);
    expect(p.seen).toEqual([]);
  });

  it('diagnoses a 407 from the proxy and redacts its credentials', async () => {
    const s = await mcp();
    const p = await startProxy(407);
    const env = { HTTP_PROXY: p.url.replace('//', `//corpuser:${PASS}@`) };
    installProxy(env);
    const r = await withEnv(env, () => runCli([s.url, '--format', 'json'], env, false));
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/407/);
    expect(out).toMatch(/proxy/i);
    expect(out).toContain(`127.0.0.1:${p.port}`);
    expect(out).not.toContain(PASS);
    expect(out).not.toContain('corpuser');
  });

  it('names a dead proxy as the cause', async () => {
    const s = await mcp();
    const dead = await listen(() => {});
    const url = dead.base;
    await dead.close();
    const env = { HTTP_PROXY: url };
    installProxy(env);
    const r = await withEnv(env, () => runCli([s.url, '--format', 'json'], env, false));
    const out = r.stdout + r.stderr;
    expect(r.code).not.toBe(0);
    expect(out).toMatch(/HTTP proxy/);
    expect(out).toContain(new URL(url).host);
  });
});

describe('HTTP_PROXY alone also covers https', () => {
  it('proxyForUrl and describeCause agree with the agent', () => withEnv({ HTTP_PROXY: 'http://proxy.corp:3128' }, () => {
    const u = new URL('https://mcp.example.com/mcp');
    expect(proxyForUrl(u, { HTTP_PROXY: 'http://proxy.corp:3128' })).toBe('http://proxy.corp:3128');
    expect(describeCause(u, { code: 'ECONNREFUSED' }).summary).toContain('http://proxy.corp:3128');
  }));
});

describe('proxy diagnosis units', () => {
  const proxied = { HTTPS_PROXY: `http://corpuser:${PASS}@proxy.corp:3128` };
  it('names the redacted proxy for ECONNREFUSED and a CONNECT 407', () => withEnv(proxied, () => {
    const u = new URL('https://mcp.example.com/mcp');
    const a = describeCause(u, { code: 'ECONNREFUSED' });
    expect(a).toMatchObject({ kind: 'refused' });
    expect(a.summary).toContain('http://proxy.corp:3128');
    expect(JSON.stringify(a)).not.toContain(PASS);
    const b = describeCause(u, { code: 'UND_ERR_SOCKET', message: 'Proxy response (407) !== 200 when HTTP Tunneling' });
    expect(b).toMatchObject({ kind: 'http', status: 407 });
    expect(JSON.stringify(b)).not.toContain('corpuser');
  }));

  it('a host excluded by NO_PROXY is diagnosed as direct', () => withEnv({ ...proxied, NO_PROXY: 'example.com' }, () => {
    expect(describeCause(new URL('https://mcp.example.com/mcp'), { code: 'ECONNREFUSED' }).summary).toMatch(/connection refused by mcp\.example\.com/);
  }));

  it('reports the raw TLS check as inconclusive behind a proxy', () => withEnv(proxied, async () => {
    const r = await tlsCheckWithRetry({ ...defaultDeps, tlsCheck: () => { throw new Error('must not connect'); } }, 'mcp.example.com', 443);
    expect(r).toMatchObject({ ok: false, transient: true });
    expect(r.code).toMatch(/cannot go through the HTTP proxy http:\/\/proxy\.corp:3128/);
    expect(JSON.stringify(r)).not.toContain(PASS);
  }));

  it('runs the raw TLS check when NO_PROXY excludes the host', () => withEnv({ ...proxied, NO_PROXY: 'mcp.example.com' }, async () => {
    let called = false;
    await tlsCheckWithRetry({ ...defaultDeps, tlsCheck: async () => { called = true; return { ok: true }; } }, 'mcp.example.com', 443);
    expect(called).toBe(true);
  }));

  it('the redactor masks proxy URL credentials', () => withEnv(proxied, () => {
    const red = buildRedactor({});
    const text = scrub(`connect to http://corpuser:${PASS}@proxy.corp failed; Basic ${Buffer.from(`corpuser:${PASS}`).toString('base64')}`, red);
    expect(text).not.toContain(PASS);
    expect(text).not.toContain('corpuser');
  }));
});
