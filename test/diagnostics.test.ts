// B6 retries and B7 connection diagnostics: pure helpers.
import { describe, expect, it } from 'vitest';
import { cleanErrorMessage } from '../src/connect.js';
import { describeCause, describeHttpFailure, networkCause, schemeSuggestion, suggestedEndpoint } from '../src/diagnose.js';
import { requestWithRetry, retryDelayMs, tlsCheckWithRetry, type Deps } from '../src/probe/network.js';
import { createRedactor, type Tracer } from '../src/protocol/trace.js';
import { attemptStatus, describeAttempts, endedTransient, isTransient } from '../src/rules/util/obs.js';
import { exchange } from './helpers.js';

const U = new URL('https://mcp.acme.test/');

describe('connection diagnostics (B7)', () => {
  it('surfaces the undici cause code', () => {
    const e = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' }) });
    expect(networkCause(e)).toEqual({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' });
    expect(networkCause(new Error('plain'))).toBeUndefined();
  });

  it.each([
    ['ENOTFOUND', 'dns', /hostname mcp\.acme\.test does not resolve \(ENOTFOUND\)/],
    ['ECONNREFUSED', 'refused', /connection refused by mcp\.acme\.test:443/],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout', /timed out/],
    ['ECONNRESET', 'reset', /reset/],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls', /TLS certificate of mcp\.acme\.test is not trusted/],
    ['CERT_HAS_EXPIRED', 'tls', /not trusted \(CERT_HAS_EXPIRED\)/],
  ])('%s → %s', (code, kind, re) => {
    const d = describeCause(U, { code });
    expect(d.kind).toBe(kind);
    expect(d.summary).toMatch(re);
  });

  it('a cause without a code keeps its message (fetch refuses some ports as "bad port")', () => {
    expect(describeCause(new URL('http://localhost:1/mcp'), { message: 'bad port' }).summary).toBe('fetch failed (bad port)');
  });

  it('404/405/HTML: not an MCP endpoint, suggest <url>/mcp; /sse → /mcp', () => {
    const html = describeHttpFailure(U, { status: 405, contentType: 'text/html', body: '<!doctype html><html><head><title>Example Domain</title></head><body>…</body></html>' });
    expect(html).toMatchObject({ kind: 'not-mcp', hint: 'try https://mcp.acme.test/mcp' });
    expect(html.summary).toBe('HTTP 405 with an HTML page ("Example Domain"): https://mcp.acme.test/ is not an MCP endpoint');
    const sse = describeHttpFailure(new URL('https://mcp.deepwiki.test/sse'), { status: 405 });
    expect(sse.hint).toBe('/sse is the deprecated HTTP+SSE path; Streamable HTTP servers usually serve https://mcp.deepwiki.test/mcp');
    expect(describeHttpFailure(new URL('https://a.test/mcp'), { status: 500, message: 'HTTP 500: boom' })).toMatchObject({ kind: 'http', summary: 'HTTP 500: boom' });
    expect(suggestedEndpoint(new URL('https://a.test/api/'))).toBe('https://a.test/api/mcp');
    expect(suggestedEndpoint(new URL('https://a.test/mcp'))).toBeUndefined();
  });

  it('S-26 (R-18): a status below 100 (the SDK\'s -1 for an unexpected content type) is not printed as an HTTP status', () => {
    const page = describeHttpFailure(U, { status: -1, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><title>My App</title></head></html>', message: 'HTTP -1: Unexpected content type' });
    expect(page).toMatchObject({ kind: 'not-mcp', summary: 'response with an HTML page ("My App"): https://mcp.acme.test/ is not an MCP endpoint' });
    expect(page.status).toBeUndefined();
    expect(describeHttpFailure(U, { status: 0 }).summary).toBe('unknown error');
  });

  it('schemeSuggestion: https for public hosts, http for localhost, nothing for real URLs', () => {
    expect(schemeSuggestion('mcp.example.com/mcp')).toBe('https://mcp.example.com/mcp');
    expect(schemeSuggestion('localhost:3000/mcp')).toBe('http://localhost:3000/mcp');
    expect(schemeSuggestion('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(schemeSuggestion('https://a.test/mcp')).toBeUndefined();
    expect(schemeSuggestion('justaword')).toBeUndefined();
  });

  it('R-19: schemeSuggestion reads <label>:<digits> as a local host and port (http://)', () => {
    expect(schemeSuggestion('mcp:8080/mcp')).toBe('http://mcp:8080/mcp');
    expect(schemeSuggestion('app:3000')).toBe('http://app:3000');
    expect(schemeSuggestion('MCP:8080')).toBe('http://MCP:8080');
    expect(schemeSuggestion('mcp')).toBeUndefined();
    expect(schemeSuggestion('mailto:a@b.test')).toBeUndefined();
  });

  it('cleanErrorMessage replaces an HTML page by its title and caps a huge body before regexes (W1-8)', () => {
    const big = `Error POSTing: <!doctype html><html><head><title>Not Found</title></head>${'<script '.repeat(400000)}`;
    const t0 = performance.now();
    expect(cleanErrorMessage(big, 404, createRedactor())).toBe('HTTP 404: Error POSTing: HTML page ("Not Found")');
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('transient failures and retries (B6)', () => {
  it('classifies timeouts, resets, 5xx and 429 as transient; 4xx, 501 and TLS errors are not', () => {
    expect(isTransient(exchange({ error: { name: 'AbortError', message: 'aborted' } }))).toBe(true);
    expect(isTransient(exchange({ error: { name: 'TypeError', causeCode: 'ECONNRESET', message: 'fetch failed' } }))).toBe(true);
    expect(isTransient(exchange({ status: 503 }))).toBe(true);
    expect(isTransient(exchange({ status: 429 }))).toBe(true);
    expect(isTransient(exchange({ status: 404 }))).toBe(false);
    expect(isTransient(exchange({ status: 501 }))).toBe(false);
    expect(isTransient(exchange({ error: { name: 'TypeError', causeCode: 'CERT_HAS_EXPIRED', message: 'fetch failed' } }))).toBe(false);
    expect(attemptStatus(exchange({ error: { name: 'AbortError', message: 'x' } }))).toBe('timeout');
  });

  it('retryDelayMs honours Retry-After (seconds or date, capped at 5 s) and backs off otherwise', () => {
    expect(retryDelayMs(exchange({ status: 429, headers: { 'retry-after': '2' } }), 0)).toBe(2000);
    expect(retryDelayMs(exchange({ status: 429, headers: { 'retry-after': '120' } }), 0)).toBe(5000);
    expect(retryDelayMs(exchange({ status: 503, headers: { 'retry-after': new Date(10_000).toUTCString() } }), 0, 9_000)).toBe(1000);
    expect([0, 1].map((i) => retryDelayMs(exchange({ status: 503 }), i))).toEqual([250, 750]);
  });

  const fakeTracer = (statuses: Array<number | 'timeout'>) => {
    const labels: string[] = [];
    const tracer = {
      request: async (label: string) => {
        labels.push(label);
        const s = statuses.shift()!;
        return { exchange: s === 'timeout' ? exchange({ label, error: { name: 'AbortError', message: 'aborted' } }) : exchange({ label, status: s }) };
      },
    } as unknown as Tracer;
    return { tracer, labels };
  };
  const noWait = async () => {};

  it('requestWithRetry: up to 3 attempts on 5xx, one retry after a timeout, none on a definitive answer', async () => {
    const a = fakeTracer([503, 502, 200]);
    expect((await requestWithRetry(a.tracer, 'p', 'https://x', {}, noWait)).map((e) => e.status)).toEqual([503, 502, 200]);
    expect(a.labels).toEqual(['p', 'p (retry 1)', 'p (retry 2)']);
    expect((await requestWithRetry(fakeTracer([503, 503, 503, 200]).tracer, 'p', 'https://x', {}, noWait))).toHaveLength(3);
    expect((await requestWithRetry(fakeTracer(['timeout', 'timeout', 200]).tracer, 'p', 'https://x', {}, noWait))).toHaveLength(2);
    expect((await requestWithRetry(fakeTracer([404, 200]).tracer, 'p', 'https://x', {}, noWait))).toHaveLength(1);
  });

  it('describeAttempts / endedTransient group attempts by URL', () => {
    const xs = [exchange({ url: 'https://a/x', status: 503 }), exchange({ url: 'https://a/x', status: 503 }), exchange({ url: 'https://a/y', status: 404 })];
    expect(describeAttempts(xs)).toBe('https://a/x: 503, 503; https://a/y: 404');
    expect(endedTransient(xs)).toBe(true);
    expect(endedTransient([exchange({ url: 'https://a/x', status: 503 }), exchange({ url: 'https://a/x', status: 404 })])).toBe(false);
  });

  it('tlsCheckWithRetry retries timeouts and resets, not certificate errors', async () => {
    const deps = (codes: Array<string | undefined>): Deps => ({
      resolve4: async () => [], resolve6: async () => [], now: () => 0, sleep: async () => {},
      tlsCheck: async () => { const c = codes.shift(); return c ? { ok: false, code: c } : { ok: true }; },
    });
    expect(await tlsCheckWithRetry(deps(['ETIMEDOUT', undefined]), 'h', 443)).toEqual({ ok: true, attempts: ['ETIMEDOUT', 'ok'] });
    expect(await tlsCheckWithRetry(deps(['ECONNRESET', 'ECONNRESET', 'ETIMEDOUT']), 'h', 443)).toEqual({ ok: false, code: 'ETIMEDOUT', attempts: ['ECONNRESET', 'ECONNRESET', 'ETIMEDOUT'], transient: true });
    expect(await tlsCheckWithRetry(deps(['ETIMEDOUT', 'ETIMEDOUT', undefined]), 'h', 443)).toEqual({ ok: false, code: 'ETIMEDOUT', attempts: ['ETIMEDOUT', 'ETIMEDOUT'], transient: true });
    expect(await tlsCheckWithRetry(deps(['CERT_HAS_EXPIRED']), 'h', 443)).toEqual({ ok: false, code: 'CERT_HAS_EXPIRED' });
    expect(await tlsCheckWithRetry(deps([]), '[::1]', 443)).toEqual({ ok: true });
  });
});
