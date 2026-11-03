// HTTP(S)_PROXY / NO_PROXY support: global fetch goes through the proxy, NO_PROXY bypasses it, 407 and a dead proxy are diagnosed, credentials are redacted.
import http from 'node:http';
import net from 'node:net';
import { Agent, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { listen, startBridge, type Started } from './fixtures/http-bridge.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
import { runCli } from '../src/cli.js';
import { bypassesProxy, installProxy, ProxyConfigError, proxyConfig, proxyForUrl } from '../src/proxy.js';
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

/** Forward-only proxy: answers absolute-URI requests, refuses CONNECT (405). */
async function startForwardOnly(): Promise<Proxy> {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (!/^http:\/\//.test(req.url!)) { res.writeHead(400).end(); return; }
    const u = new URL(req.url!);
    const up = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode!, r.headers); r.pipe(res); });
    req.pipe(up);
  });
  server.on('connect', (req, socket) => { seen.push(`CONNECT ${req.url}`); socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return { url: `http://127.0.0.1:${port}`, port, seen };
}

/** Minimal SOCKS5 server (no auth, CONNECT only); records the target as host:port and whether it was a domain name. */
async function startSocks(): Promise<Proxy> {
  const seen: string[] = [];
  const socks = new Set<net.Socket>();
  const server = net.createServer((c) => {
    socks.add(c); c.on('close', () => socks.delete(c));
    c.once('data', () => {
      c.write(Buffer.from([5, 0]));
      c.once('data', (d) => {
        const atyp = d[3];
        let host: string; let off: number;
        if (atyp === 3) { host = d.subarray(5, 5 + d[4]).toString(); off = 5 + d[4]; } else if (atyp === 1) { host = [...d.subarray(4, 8)].join('.'); off = 8; } else { c.destroy(); return; }
        const port = d.readUInt16BE(off);
        seen.push(`SOCKS5 ${atyp === 3 ? 'domain' : 'ip'} ${host}:${port}`);
        const up = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
          c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          up.pipe(c); c.pipe(up);
        });
        up.on('error', () => c.destroy());
        c.on('error', () => up.destroy());
      });
    });
    c.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  closers.push(() => new Promise<void>((r) => { server.close(() => r()); for (const x of socks) x.destroy(); }));
  return { url: `socks5://127.0.0.1:${port}`, port, seen };
}

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

describe('plain-forwarding proxy for http: targets', () => {
  it('forwards a GET and a POST as absolute-URI requests without CONNECT', async () => {
    const s = await mcp();
    const p = await startForwardOnly();
    const env = { HTTP_PROXY: p.url };
    installProxy(env);
    const r = await withEnv(env, () => runCli([s.url, '--format', 'json'], env, false));
    expect(r.code, r.stderr).toBe(0);
    expect(p.seen.some((l) => l.startsWith('POST http://127.0.0.1:'))).toBe(true);
    expect(p.seen.some((l) => l.startsWith('GET http://127.0.0.1:'))).toBe(true);
    expect(p.seen.some((l) => l.startsWith('CONNECT'))).toBe(false);
  });
});

describe('SOCKS5 proxy', () => {
  it('routes the run through socks5:// and socks5h:// and ALL_PROXY, sending the host name', async () => {
    for (const mk of [(u: string) => ({ HTTP_PROXY: u }), (u: string) => ({ ALL_PROXY: u }), (u: string) => ({ HTTP_PROXY: u.replace('socks5:', 'socks5h:') })]) {
      const s = await mcp();
      const p = await startSocks();
      const env = mk(p.url);
      installProxy(env);
      const r = await withEnv(env, () => runCli([s.url.replace('127.0.0.1', 'localhost'), '--format', 'json'], env, false));
      expect(r.code, r.stderr).toBe(0);
      expect(p.seen.length).toBeGreaterThan(0);
      expect(p.seen[0]).toContain(`domain localhost:${new URL(s.url).port}`);
      globalThis.fetch = realFetch;
    }
  });

  it('rejects socks4 and other schemes, naming the variable without credentials', () => {
    for (const v of ['socks4://u:' + PASS + '@h:1080', 'socks4a://h:1080', 'ftp://h:21']) {
      let err: unknown;
      try { installProxy({ HTTPS_PROXY: v }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ProxyConfigError);
      expect((err as Error).message).toMatch(/^HTTPS_PROXY: unsupported proxy scheme/);
      expect((err as Error).message).not.toContain(PASS);
    }
    expect(() => installProxy({ ALL_PROXY: 'socks4://h:1' })).toThrow(/^ALL_PROXY:/);
  });

  it('the CLI exits 2 with the message', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['dist/cli.js', 'http://127.0.0.1:1/mcp'], { env: { PATH: process.env.PATH, HTTP_PROXY: 'socks4://u:' + PASS + '@h:1' }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/HTTP_PROXY: unsupported proxy scheme/);
    expect(r.stderr).not.toContain(PASS);
  });

  it('a bad proxy variable does not block --version, --help, --list-rules or explain', async () => {
    const { spawnSync } = await import('node:child_process');
    for (const args of [['--version'], ['--help'], ['--list-rules'], ['explain', 'TOOL-011']]) {
      const r = spawnSync(process.execPath, ['dist/cli.js', ...args], { env: { PATH: process.env.PATH, HTTPS_PROXY: 'socks4://u:' + PASS + '@h:1' }, encoding: 'utf8' });
      expect(r.status, args.join(' ')).toBe(0);
      expect(r.stderr).not.toContain(PASS);
    }
  });
});

describe('experimental warning', () => {
  it('drops only the undici proxy ExperimentalWarning', async () => {
    const orig = process.emitWarning;
    const seen: string[] = [];
    const onWarning = (w: Error) => seen.push(`${w.name}: ${w.message}`);
    process.on('warning', onWarning);
    try {
      installProxy({ HTTP_PROXY: 'http://127.0.0.1:1' });
      process.emitWarning('SOCKS5 proxy support is experimental and subject to change', 'ExperimentalWarning');
      process.emitWarning('[UNDICI-EHPA] EnvHttpProxyAgent is experimental, expect them to change at any time.', 'ExperimentalWarning');
      process.emitWarning('some other experimental feature', 'ExperimentalWarning');
      process.emitWarning('unrelated warning');
      await new Promise((r) => setTimeout(r, 20));
    } finally { process.off('warning', onWarning); process.emitWarning = orig; }
    expect(seen).toEqual(['ExperimentalWarning: some other experimental feature', 'Warning: unrelated warning']);
  });
});
