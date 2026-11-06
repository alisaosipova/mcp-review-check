// 1.3.0 block B4 (server and protocol checks; review round 4 A04-07, A11-02, C-02, C-03, C-04). One describe per
// finding id. Every server is local, on 127.0.0.1.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/connect.js';
import { RecordingTransport, UNSOLICITED_IDS_KEPT } from '../src/protocol/recording.js';
import { runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import type { Rule } from '../src/rules/types.js';
import { isLoopbackHost, isNonPublicIp } from '../src/rules/util/net.js';
import type { DnsResult, Snapshot } from '../src/snapshot.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
import { startBridge } from './fixtures/http-bridge.js';
import { evaluate, exchange, snap, tool } from './helpers.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });
const byId = (id: string): Rule => RULES.find((r) => r.id === id)!;
const URL_OK = 'https://mcp.acme.test/mcp';

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string, port: number) => void): Promise<string> {
  let port = 0;
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, res, body, port));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }));
  port = (srv.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}/mcp`;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const parse = (body: string): { id?: unknown; method?: string } => { try { return JSON.parse(body); } catch { return {}; } };

/** A minimal 2025-11-25 Streamable HTTP server; `extra` adds messages to a response, `evil` answers the foreign Origin. */
function mcpServer(o: { extra?: (m: { id?: unknown; method?: string }) => unknown[]; evil?: number } = {}): Promise<string> {
  return serve((req, res, body) => {
    const m = parse(body);
    if (o.evil && /evil/.test(String(req.headers.origin ?? ''))) return json(res, o.evil, { jsonrpc: '2.0', error: { code: -32600, message: 'Origin not allowed' } });
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    let reply: unknown;
    if (m.method === 'initialize') reply = { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'b4', version: '1' } } };
    else if (m.method === 'tools/list') reply = { jsonrpc: '2.0', id: m.id, result: { tools: [] } };
    else reply = { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } };
    const extra = o.extra?.(m) ?? [];
    return json(res, 200, extra.length ? [...extra, reply] : reply);
  });
}

describe('C-04 non-public IPv6 forms that embed IPv4, and reserved ranges', () => {
  const nonPublic = [
    '::127.0.0.1', '::7f00:1', '::10.0.0.1', // IPv4-compatible ::/96
    '::ffff:0:a00:1', '::ffff:0:127.0.0.1', // IPv4-translated ::ffff:0:0:0/96
    '64:ff9b::a00:1', '64:ff9b::192.168.1.1', // NAT64
    '2002:a00:1::1', '2002:c0a8:101::', // 6to4
    '100::1', 'fec0::1', 'feff::1', '2001::1', '2001:0:4136:e378::1', '192.88.99.1',
    '::ffff:10.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', // unchanged
  ];
  const isPublic = ['8.8.8.8', '2606:2800:220:1::1', '::ffff:8.8.8.8', '::8.8.8.8', '::ffff:0:808:808', '64:ff9b::808:808', '2002:808:808::1', '2001:4860::8888', '2400:cb00::1', '192.88.100.1'];
  it.each(nonPublic)('%s is non-public', (ip) => { expect(isNonPublicIp(ip)).toBe(true); });
  it.each(isPublic)('%s is public', (ip) => { expect(isNonPublicIp(ip)).toBe(false); });

  it('isLoopbackHost reads 127/8 written IPv4-compatible, and not other compatible or translated forms', () => {
    for (const h of ['::127.0.0.1', '[::127.0.0.1]', '::7f00:1', '::ffff:127.0.0.1', '::1']) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ['::', '::8.8.8.8', '::10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1']) expect(isLoopbackHost(h), h).toBe(false);
  });

  const dns = (aaaa: string[]): DnsResult => ({ host: 'mcp.acme.test', a: ['93.184.216.34'], aaaa });
  it('SRV-004: an AAAA record in NAT64 or 6to4 form of a private address is an error; a public one is not', () => {
    const pos = evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = dns(['64:ff9b::a00:1', '2002:c0a8:101::1']); } }));
    expect(pos.map((f) => f.severity)).toEqual(['error']);
    expect(pos[0].message).toMatch(/non-public address 64:ff9b::a00:1, 2002:c0a8:101::1/);
    expect(evaluate(byId('SRV-004'), snap({ url: URL_OK, set: (s) => { s.transport.dns = dns(['64:ff9b::808:808']); } }))).toEqual([]);
  });

  const URI = 'ui://acme/board.html';
  const uiSnap = (resourceDomains: string[]): Snapshot => snap({
    url: URL_OK,
    tools: [tool({ name: 'show_board', outputSchema: { type: 'object' }, _meta: { ui: { resourceUri: URI } } })],
    resources: [{ uri: URI, name: 'board', mimeType: 'text/html;profile=mcp-app' }],
    set: (s) => {
      s.resourceReads[URI] = { ok: true, durationMs: 5, raw: { contents: [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: '<!doctype html><html><body>x</body></html>', _meta: { ui: { csp: { resourceDomains } }, 'openai/widgetDomain': 'https://widgets.acme.test' } }] } };
    },
  });
  it('APPS-006: a CSP origin on an IPv4-compatible loopback or a 6to4 private address names a private IP', () => {
    for (const d of ['https://[::127.0.0.1]', 'https://[2002:a00:1::1]']) {
      const f = evaluate(byId('APPS-006'), uiSnap([d]));
      expect(f.map((x) => x.message).join('\n'), d).toMatch(/names localhost or a private IP/);
    }
    expect(evaluate(byId('APPS-006'), uiSnap(['https://[2002:808:808::1]'])).filter((x) => /private IP/.test(x.message))).toEqual([]);
  });
});

describe('A04-07 SRV-006 handles a 303 redirect', () => {
  it('a POST that gets a cross-host 303 is an error that says the POST becomes a GET', async () => {
    const url = await serve((_req, res, _body, port) => { res.writeHead(303, { location: `http://localhost:${port + 1}/mcp` }); res.end(); });
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 5000 });
    const r = runRules(s, RULES);
    const f = r.findings.filter((x) => x.ruleId === 'SRV-006');
    expect(f.map((x) => [x.severity, x.message])).toContainEqual(['error', expect.stringMatching(/^POST redirects \(303\) to another host: http:\/\/localhost:\d+\/mcp; a 303 turns the POST into a GET/)]);
    expect(r.skipped.find((x) => x.ruleId === 'SRV-006')).toBeUndefined();
  }, 30000);

  it('a same-host 303 on POST is a warning; a GET 303 has no POST note; a 200 gives nothing', () => {
    const same = evaluate(byId('SRV-006'), snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 303, headers: { location: '/mcp/' } }); } }));
    expect(same.map((x) => x.severity)).toEqual(['warning']);
    expect(same[0].message).toMatch(/register the final URL; a 303 turns the POST into a GET/);
    const get = evaluate(byId('SRV-006'), snap({ url: URL_OK, set: (s) => { s.transport.probes.get = exchange({ method: 'GET', status: 303, headers: { location: 'https://docs.acme.test/' } }); } }));
    expect(get.map((x) => x.severity)).toEqual(['warning']);
    expect(get[0].message).not.toMatch(/turns/);
    expect(evaluate(byId('SRV-006'), snap({ url: URL_OK, set: (s) => { s.transport.preflight = exchange({ status: 200 }); } }))).toEqual([]);
  });
});

describe('A11-02 SRV-003: an SSE-only server is a ChatGPT error (OpenAI: the production endpoint must support Streamable HTTP)', () => {
  it('a legacy HTTP+SSE fixture: chatgpt error, claude and spec warning, citing the OpenAI page', async () => {
    const b = await startBridge(createGoodServer, { sseOnly: true });
    closers.push(() => b.close());
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url: b.url }, timeoutMs: 5000 });
    expect(s.transport.kind).toBe('sse');
    const f = runRules(s, RULES).findings.filter((x) => x.ruleId === 'SRV-003');
    expect(f).toHaveLength(1);
    expect(f[0].severityByPlatform).toEqual({ claude: 'warning', chatgpt: 'error', spec: 'warning' });
    expect(byId('SRV-003').sources).toContain('https://developers.openai.com/plugins/build/mcp-server');
  }, 30000);

  it('a Streamable HTTP fixture gets no SRV-003 finding', async () => {
    const b = await startBridge(createGoodServer);
    closers.push(() => b.close());
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url: b.url }, timeoutMs: 5000 });
    expect(runRules(s, RULES).findings.filter((x) => x.ruleId === 'SRV-003')).toEqual([]);
  }, 30000);
});

describe('C-03 SRV-008: a foreign Origin must get exactly 403', () => {
  it('a 400 rejection of the foreign Origin is a spec warning naming the status', async () => {
    const url = await mcpServer({ evil: 400 });
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 5000 });
    const f = runRules(s, RULES).findings.filter((x) => x.ruleId === 'SRV-008');
    expect(f.map((x) => [x.platforms, x.severity, x.message])).toEqual([[['spec'], 'warning', 'foreign Origin rejected with 400; the spec requires 403 Forbidden']]);
  }, 30000);

  it('a 403 rejection gives no finding', async () => {
    const url = await mcpServer({ evil: 403 });
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 5000 });
    expect(runRules(s, RULES).findings.filter((x) => x.ruleId === 'SRV-008')).toEqual([]);
  }, 30000);

  const probes = (evil: number, none = 200, kind: Snapshot['transport']['kind'] = 'streamable-http') => snap({ url: URL_OK, set: (s) => {
    s.transport.kind = kind;
    s.transport.probes.originNone = exchange({ label: 'originNone', status: none });
    s.transport.probes.originEvil = exchange({ label: 'originEvil', status: evil });
  } });
  it('401, 407 and 429 say nothing about the Origin; a failing no-Origin request or an HTTP+SSE target gives no finding', () => {
    expect(evaluate(byId('SRV-008'), probes(404)).map((x) => x.message)).toEqual(['foreign Origin rejected with 404; the spec requires 403 Forbidden']);
    for (const st of [401, 407, 429, 500]) expect(evaluate(byId('SRV-008'), probes(st)), String(st)).toEqual([]);
    expect(evaluate(byId('SRV-008'), probes(400, 400))).toEqual([]);
    expect(evaluate(byId('SRV-008'), probes(400, 200, 'sse'))).toEqual([]);
  });
});

describe('C-02 SPEC-016: responses whose id answers no pending request', () => {
  /** A fake inner transport: `deliver` hands a message to the recorder as if the server sent it. */
  function recorder(): { rec: RecordingTransport; deliver: (m: unknown) => void } {
    const inner = { start: async () => {}, send: async () => {}, close: async () => {} } as unknown as Transport;
    const rec = new RecordingTransport(inner);
    return { rec, deliver: (m) => inner.onmessage?.(m as JSONRPCMessage) };
  }

  it('record() keeps one summary (exact count, first ids) for results and errors; a flood adds nothing else', async () => {
    const { rec, deliver } = recorder();
    await rec.start();
    await rec.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as JSONRPCMessage);
    deliver({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    deliver({ jsonrpc: '2.0', id: 1, result: { tools: [] } }); // answered before
    for (let i = 0; i < 2000; i++) deliver({ jsonrpc: '2.0', id: 100000 + i, error: { code: -32603, message: 'x' } });
    deliver({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); // id null: not unsolicited
    const summary = rec.errors.filter((e) => e.unsolicited);
    expect(summary).toEqual([{ source: 'unsolicited responses', unsolicited: { count: 2001, ids: [1, 100000, 100001, 100002, 100003] } }]);
    expect(rec.errors.filter((e) => e.source === 'unsolicited response')).toHaveLength(UNSOLICITED_IDS_KEPT - 1);
    expect(rec.errors.filter((e) => e.source === 'response' && e.responseId === null)).toHaveLength(1);
    expect(rec.errors.length).toBeLessThan(10);
  });

  it('a clean exchange records no summary', async () => {
    const { rec, deliver } = recorder();
    await rec.start();
    await rec.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as JSONRPCMessage);
    deliver({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    expect(rec.errors).toEqual([]);
  });

  it('an HTTP server that adds responses to requests never sent gets one SPEC-016 warning; a clean one none', async () => {
    let sent = false; // once, on the SDK's first tools/list (the wire probes reuse the method)
    const url = await mcpServer({ extra: (m) => (m.method === 'tools/list' && !sent && (sent = true) ? [{ jsonrpc: '2.0', id: 'stray-1', result: {} }, { jsonrpc: '2.0', id: 99999, error: { code: -32603, message: 'late' } }] : []) });
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 5000 });
    const f = runRules(s, RULES).findings.filter((x) => x.ruleId === 'SPEC-016');
    expect(f.map((x) => [x.severity, x.message])).toEqual([['warning', 'JSON-RPC responses answer no pending request: 2 (ids "stray-1", 99999)']]);
    const clean = await mcpServer();
    const { snap: c } = await buildSnapshot({ target: { kind: 'http', url: clean }, timeoutMs: 5000 });
    expect(c.transport.observedErrors?.some((e) => e.unsolicited)).toBe(false);
  }, 30000);

  it('the rule text reads singular for one response and marks a cut id list', () => {
    const one = snap({ set: (x) => { x.transport.observedErrors = [{ source: 'unsolicited responses', unsolicited: { count: 1, ids: [7] } }]; } });
    expect(evaluate(byId('SPEC-016'), one).map((x) => [x.severity, x.message])).toEqual([['warning', 'JSON-RPC response answers no pending request: 1 (ids 7)']]);
    const many = snap({ set: (x) => { x.transport.observedErrors = [{ source: 'unsolicited responses', unsolicited: { count: 20000, ids: [1, 2] } }]; } });
    expect(evaluate(byId('SPEC-016'), many)[0].message).toBe('JSON-RPC responses answer no pending request: 20000 (ids 1, 2, ...)');
  });
});
