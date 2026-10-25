// Automatic local mode and --local / --no-local. Deploy-time checks (HTTPS, public DNS, tunnel
// domains) are informational for a host without a dot or one whose every address is non-public, and the banner
// names the rules that were downgraded. Black-box over the built CLI, plus the detection with injected resolvers.
import { afterAll, describe, expect, it } from 'vitest';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { lookup } from 'node:dns/promises';
import { hostname, networkInterfaces } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cli, GOOD } from './cli-runner.js';
import { createBridgeHandler, listen, type Started } from './fixtures/http-bridge.js';
import { lookupHost, type Deps } from '../src/probe/network.js';
import { isLocalTarget } from '../src/rules/util/net.js';

function factory() {
  const server = new McpServer({ name: 'local-notes', title: 'Local Notes', version: '1.0.0' });
  server.registerTool('search_notes', {
    title: 'Search notes', description: 'Search the local notes by keyword and return matching note titles.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => ({ content: [{ type: 'text', text: 'no notes' }] }));
  return server;
}

const servers: Array<{ close(): Promise<void> }> = [];
afterAll(async () => { await Promise.all(servers.map((s) => s.close())); });

/** The bridge on one address (not 0.0.0.0): the interface IP or the address the host name resolves to. */
async function serveOn(address: string): Promise<number> {
  const bridge = createBridgeHandler(factory);
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    bridge(req, res).catch((e) => { if (!res.headersSent) res.writeHead(500); res.end(String(e)); });
  });
  await new Promise<void>((r) => server.listen(0, address, r));
  servers.push({ close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  return (server.address() as { port: number }).port;
}

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const privateIp = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal && PRIVATE_V4.test(i.address))?.address;
const shortName = hostname();
const shortNameAddress = shortName.includes('.') ? undefined : await lookup(shortName, { family: 4 }).then((r) => r.address, () => undefined);

const DEPLOY = /^Deploy-time check: /;

async function expectLocal(url: string) {
  const json = (await cli([url, '--format', 'json', '--timeout', '5000'])).json;
  expect(json?.server.localMode, `${url}: localMode`).toBe(true);
  const srv001 = json.findings.filter((f: any) => f.ruleId === 'SRV-001');
  expect(srv001.length, `${url}: SRV-001 for plain http`).toBeGreaterThan(0);
  expect(srv001.every((f: any) => f.severity === 'info' && DEPLOY.test(f.message))).toBe(true);
  const text = await cli([url, '--timeout', '5000']);
  expect(text.stdout).toMatch(/Local target: deploy-time checks are informational \(SRV-001[^)]*\); --no-local for strict checks\./);
}

describe('automatic local mode', () => {
  it.skipIf(!privateIp)('a server on the IP of a non-public interface is checked in local mode, with the banner', async () => {
    const port = await serveOn(privateIp!);
    await expectLocal(`http://${privateIp}:${port}/mcp`);
  });

  it.skipIf(!shortNameAddress)('a host name without a dot (os.hostname()) is checked in local mode, with the banner', async () => {
    const port = await serveOn(shortNameAddress!);
    await expectLocal(`http://${shortName}:${port}/mcp`);
  });

  it('json and sarif keep stdout a document; the banner goes to stderr', async () => {
    const s: Started = await listen(createBridgeHandler(factory));
    servers.push(s);
    for (const format of ['json', 'sarif']) {
      const r = await cli([s.url, '--format', format]);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
      expect(r.stderr).toMatch(/Local target: deploy-time checks are informational \(SRV-001/);
    }
  });

  it('isLocalTarget: no dot, or every address from DNS and the system resolver non-public (injected resolvers)', async () => {
    const fail = Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' });
    const deps = (a: string[] | Error, aaaa: string[] | Error, sys: string[]): Deps => ({
      resolve4: async () => { if (a instanceof Error) throw a; return a; },
      resolve6: async () => { if (aaaa instanceof Error) throw aaaa; return aaaa; },
      lookup: async () => sys,
      tlsCheck: async () => ({ ok: true }), now: () => 0,
    });
    const local = async (host: string, d: Deps) => isLocalTarget(await lookupHost(host, d));
    expect(await local('mcp-server', deps(fail, fail, []))).toBe(true); // docker service name, no dot
    expect(await local('mcp.corp.test', deps(fail, fail, ['172.18.0.2']))).toBe(true); // only /etc/hosts or docker DNS knows it
    expect(await local('mcp.corp.test', deps(['10.0.0.5'], [], ['10.0.0.5']))).toBe(true);
    expect(await local('mcp.acme.test', deps(['93.184.216.34'], [], ['93.184.216.34']))).toBe(false);
    expect(await local('mcp.acme.test', deps(['10.0.0.5', '93.184.216.34'], [], []))).toBe(false);
    expect(await local('typo.acme.test', deps(fail, fail, []))).toBe(false); // does not resolve: strict
    expect(await local('192.168.1.2', deps(fail, fail, []))).toBe(true);
    expect(await local('[::1]', deps(fail, fail, []))).toBe(true);
    expect(await local('8.8.8.8', deps(fail, fail, []))).toBe(false);
    expect(await local('[2606:4700::1]', deps(fail, fail, []))).toBe(false);
  });
});

describe('--local and --no-local', () => {
  it('override the automatic choice for HTTP and stdio; both together is a usage error', async () => {
    const s: Started = await listen(createBridgeHandler(factory));
    servers.push(s);
    const strict = await cli([s.url, '--no-local', '--format', 'json']);
    expect(strict.json?.server.localMode).toBe(false);
    const srv001 = strict.json.findings.filter((f: any) => f.ruleId === 'SRV-001');
    expect(srv001.map((f: any) => f.severity)).toContain('error');
    expect(srv001.some((f: any) => DEPLOY.test(f.message))).toBe(false);
    expect((await cli([s.url, '--no-local'])).stdout).not.toMatch(/Local target/);

    const forced = await cli([s.url, '--local', '--format', 'json']);
    expect(forced.json?.server.localMode).toBe(true);
    expect(forced.json.findings.filter((f: any) => f.ruleId === 'SRV-001').every((f: any) => f.severity === 'info')).toBe(true);

    expect((await cli(['--stdio', GOOD, '--no-local', '--format', 'json'])).json?.server.localMode).toBe(false);
    expect((await cli(['--stdio', GOOD, '--format', 'json'])).json?.server.localMode).toBe(true);
    const both = await cli([s.url, '--local', '--no-local']);
    expect(both.code).toBe(2);
    expect(both.stderr).toMatch(/either --local or --no-local/);
  });
});
