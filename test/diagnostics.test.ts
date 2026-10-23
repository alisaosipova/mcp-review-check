// B7 connection diagnostics: pure helpers.
import { describe, expect, it } from 'vitest';
import { describeCause, describeHttpFailure, networkCause, schemeSuggestion, suggestedEndpoint } from '../src/diagnose.js';

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

  it('schemeSuggestion: https for public hosts, http for localhost, nothing for real URLs', () => {
    expect(schemeSuggestion('mcp.example.com/mcp')).toBe('https://mcp.example.com/mcp');
    expect(schemeSuggestion('localhost:3000/mcp')).toBe('http://localhost:3000/mcp');
    expect(schemeSuggestion('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(schemeSuggestion('https://a.test/mcp')).toBeUndefined();
    expect(schemeSuggestion('justaword')).toBeUndefined();
  });
});
