import { extractWWWAuthenticateParams } from '@modelcontextprotocol/sdk/client/auth.js';
import { describe, expect, it } from 'vitest';
import { cmdQuote, splitStdioArgv, tokenizeCommand } from '../src/protocol/stdioArgs.js';
import { parseSseMessages, createRedactor, redactUrl, scrub } from '../src/protocol/trace.js';
import { asDiscoveryUrls, prmCandidates } from '../src/probe/auth.js';
import { cleanErrorMessage, stderrSummary } from '../src/connect.js';
import { mcpNameOf } from '../src/protocol/modern.js';
import { htmlComment } from '../src/rules/injection.js';
import { displayUrl, isNonPublicIPv4, isNonPublicIPv6, registrableDomain } from '../src/rules/util/net.js';
import { schemaMetrics, walkSchema } from '../src/rules/util/schemaWalk.js';
import { firstVerb, isGenericError, snippet, tokenize } from '../src/rules/util/text.js';
import { parseWwwAuthenticate } from '../src/rules/util/wwwAuth.js';

describe('text helpers', () => {
  it('tokenize splits separators, camelCase and digits', () => {
    expect(tokenize('getUserProfile_v2.list:all')).toEqual(['get', 'user', 'profile', 'v', '2', 'list', 'all']);
    expect(tokenize('HTTPRequest')).toEqual(['http', 'request']);
  });
  it('firstVerb finds the first read/write verb', () => {
    expect(firstVerb('acme_delete_note')).toBe('delete');
    expect(firstVerb('noteInfo')).toBeUndefined();
  });
  it('isGenericError', () => {
    expect(isGenericError('Internal Server Error')).toBe(true);
    expect(isGenericError('failed')).toBe(true);
    expect(isGenericError('month required')).toBe(false); // short but specific
    expect(isGenericError('Missing required field "keywords".')).toBe(false);
  });
  it('snippet escapes hidden characters and truncates', () => {
    expect(snippet('a​b')).toBe('a\\u{200B}b');
    expect(snippet('x'.repeat(300), 150, 3).length).toBeLessThanOrEqual(122);
  });
});

describe('walkSchema', () => {
  it('walks nested properties, items, combinators and local $ref with cycle protection', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        userName: { type: 'string' },
        tags: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
        node: { $ref: '#/$defs/Node' },
      },
      $defs: { Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' }, value: { anyOf: [{ type: 'string' }, { type: 'number' }] } } } },
    };
    const seen: string[] = [];
    walkSchema(schema, (v) => { if (v.viaProperty) seen.push(`${v.name}@${v.path}`); });
    expect(seen).toContain('user_name@/properties/userName');
    expect(seen).toContain('label@/properties/tags/items/properties/label');
    expect(seen).toContain('value@/properties/node/$ref/properties/value');
  });
  it('schemaMetrics counts subschemas and depth', () => {
    expect(schemaMetrics({ type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'string' } } } } })).toEqual({ depth: 2, count: 3 });
  });
});

describe('net helpers', () => {
  it('classifies non-public addresses', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.1.1', '172.20.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '224.0.0.1']) expect(isNonPublicIPv4(ip)).toBe(true);
    expect(isNonPublicIPv4('93.184.216.34')).toBe(false);
    for (const ip of ['::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isNonPublicIPv6(ip)).toBe(true);
    expect(isNonPublicIPv6('2606:4700::1111')).toBe(false);
  });
  it('registrableDomain handles multi-label and shared suffixes', () => {
    expect(registrableDomain('mcp.acme.com')).toBe('acme.com');
    expect(registrableDomain('a.b.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('my-app.vercel.app')).toBe('my-app.vercel.app');
  });
});

describe('WWW-Authenticate parser', () => {
  it('parses challenge lists with quoted strings', () => {
    const c = parseWwwAuthenticate('Bearer realm="a, b", resource_metadata="https://x.test/.well-known/oauth-protected-resource", scope="read write", Basic realm=api');
    expect(c).toEqual([
      { scheme: 'bearer', params: { realm: 'a, b', resource_metadata: 'https://x.test/.well-known/oauth-protected-resource', scope: 'read write' } },
      { scheme: 'basic', params: { realm: 'api' } },
    ]);
  });
  it('handles token68 and bare schemes', () => {
    expect(parseWwwAuthenticate('Negotiate abc123==, Bearer')).toEqual([{ scheme: 'negotiate', params: {}, token68: 'abc123==' }, { scheme: 'bearer', params: {} }]);
  });
  it('matches the SDK extractWWWAuthenticateParams (parity)', () => {
    const headers = [
      'Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp", scope="notes.read notes.write"',
      'Bearer error="insufficient_scope", scope="admin", resource_metadata="https://a.test/prm"',
      'Bearer realm="mcp"',
    ];
    for (const h of headers) {
      const sdk = extractWWWAuthenticateParams(new Response(null, { status: 401, headers: { 'www-authenticate': h } }));
      const ours = parseWwwAuthenticate(h).find((c) => c.scheme === 'bearer')!.params;
      expect(ours.resource_metadata).toBe(sdk.resourceMetadataUrl?.href);
      expect(ours.scope).toBe(sdk.scope);
      expect(ours.error).toBe(sdk.error);
    }
  });
});

describe('discovery URL construction', () => {
  it('PRM candidates: header, path-aware, root', () => {
    expect(prmCandidates(new URL('https://a.test/mcp'), 'https://a.test/prm').map((c) => c.via)).toEqual(['header', 'well-known-path', 'well-known-root']);
    expect(prmCandidates(new URL('https://a.test/')).map((c) => c.url)).toEqual(['https://a.test/.well-known/oauth-protected-resource']);
  });
  it('AS discovery URLs for issuers with and without a path', () => {
    expect(asDiscoveryUrls('https://auth.test/tenant1')).toEqual([
      'https://auth.test/.well-known/oauth-authorization-server/tenant1',
      'https://auth.test/.well-known/openid-configuration/tenant1',
      'https://auth.test/tenant1/.well-known/openid-configuration',
    ]);
    expect(asDiscoveryUrls('https://auth.test')).toEqual(['https://auth.test/.well-known/oauth-authorization-server', 'https://auth.test/.well-known/openid-configuration']);
  });
});

describe('protocol helpers', () => {
  it('tokenizeCommand handles quotes and escapes inside double quotes', () => {
    expect(tokenizeCommand(`node "my server.js" --name 'a b' "say \\"hi\\""`)).toEqual(['node', 'my server.js', '--name', 'a b', 'say "hi"']);
    expect(() => tokenizeCommand('node "oops')).toThrow(/unterminated/);
  });
  it('tokenizeCommand keeps backslashes outside quotes literal (Windows paths)', () => {
    expect(tokenizeCommand('node C:\\Users\\me\\server\\index.js --flag')).toEqual(['node', 'C:\\Users\\me\\server\\index.js', '--flag']);
    expect(tokenizeCommand('node \\\\host\\share\\s.js')).toEqual(['node', '\\\\host\\share\\s.js']);
    expect(tokenizeCommand('"C:\\Program Files\\nodejs\\node.exe" D:\\srv\\a.js')).toEqual(['C:\\Program Files\\nodejs\\node.exe', 'D:\\srv\\a.js']);
    expect(tokenizeCommand('node a\\ b')).toEqual(['node', 'a\\', 'b']);
  });
  it('R-15: inside double quotes a backslash escapes only " (Windows rule), so UNC paths, \\$ and a trailing \\ survive', () => {
    expect(tokenizeCommand(String.raw`node "\\srv\My Share\s.js"`)).toEqual(['node', String.raw`\\srv\My Share\s.js`]);
    expect(tokenizeCommand(String.raw`node "C:\Users\me\$work\s.js"`)).toEqual(['node', String.raw`C:\Users\me\$work\s.js`]);
    expect(() => tokenizeCommand(String.raw`node "C:\srv\\" x`)).not.toThrow();
    expect(tokenizeCommand(String.raw`node "C:\srv\\" x`)).toEqual(['node', 'C:\\srv\\', 'x']);
    expect(tokenizeCommand(String.raw`node "a\\\"b"`)).toEqual(['node', 'a\\"b']); // 2n+1 backslashes: n and a literal "
  });
  it('R-15: cmdQuote quotes an argument so that tokenizeCommand gives it back', () => {
    expect(cmdQuote, 'cmdQuote is exported').toBeTypeOf('function');
    for (const x of ['C:\\Program Files\\srv\\', 'say "hi"', 'a\\"b', String.raw`\\srv\My Share\s.js`, 'x\\\\', '']) {
      expect(tokenizeCommand(cmdQuote(x)), x).toEqual([x]);
    }
    expect(cmdQuote('C:\\Program Files\\srv\\')).toBe('"C:\\Program Files\\srv\\\\"');
  });
  it('splitStdioArgv takes the command after `--stdio --` verbatim', () => {
    expect(splitStdioArgv(['--format', 'json', '--stdio', '--', 'node', 'my server.js', '--port', '0'])).toEqual({ args: ['--format', 'json'], command: ['node', 'my server.js', '--port', '0'] });
    expect(splitStdioArgv(['--stdio', '--verbose', '--', 'node', 's.js'])).toEqual({ args: ['--verbose'], command: ['node', 's.js'] });
    expect(splitStdioArgv(['--stdio', '--'])).toEqual({ args: [], command: [] });
    // --stdio with its own value, or no --stdio at all: argv is untouched.
    expect(splitStdioArgv(['--stdio', 'node s.js', '--', 'x'])).toEqual({ args: ['--stdio', 'node s.js', '--', 'x'] });
    expect(splitStdioArgv(['https://a.test/mcp', '--', 'x'])).toEqual({ args: ['https://a.test/mcp', '--', 'x'] });
    expect(splitStdioArgv(['--stdio', 'node s.js'])).toEqual({ args: ['--stdio', 'node s.js'] });
  });
  it('parseSseMessages reads data lines', () => {
    expect(parseSseMessages('event: message\ndata: {"id":1}\n\ndata: {"id":2}\n\n')).toEqual([{ id: 1 }, { id: 2 }]);
  });
  it('redaction scrubs secret values and query credentials', () => {
    const r = createRedactor(['X-Api-Key'], ['supersecret']);
    expect(scrub('token supersecret here', r)).toBe('token «redacted» here');
    expect(redactUrl('https://a.test/mcp?api_key=abc&x=1', r)).toBe('https://a.test/mcp?api_key=«redacted»&x=1');
  });
});

describe('review fixes: helpers', () => {
  it('prmCandidates drops a trailing slash and keeps the query (RFC 9728 §3.1)', () => {
    expect(prmCandidates(new URL('https://a.test/mcp/')).map((c) => c.url)[0]).toBe('https://a.test/.well-known/oauth-protected-resource/mcp');
    expect(prmCandidates(new URL('https://a.test/mcp?tenant=1')).map((c) => c.url)[0]).toBe('https://a.test/.well-known/oauth-protected-resource/mcp?tenant=1');
  });

  it('walkSchema survives a malformed percent escape in $ref', () => {
    const seen: string[] = [];
    expect(() => walkSchema({ type: 'object', properties: { x: { $ref: '#/$defs/100%' } }, $defs: {} }, (v) => seen.push(v.path))).not.toThrow();
    expect(seen).toContain('/properties/x');
  });

  it('htmlComment is linear on many unterminated openers', () => {
    const t0 = performance.now();
    expect(htmlComment('<!--'.repeat(250000))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
    expect(htmlComment('a <!-- b --> c')?.[0]).toBe('<!-- b -->');
  });

  it('mcpNameOf takes params.name or params.uri', () => {
    expect(mcpNameOf('tools/call', { name: 'search' })).toBe('search');
    expect(mcpNameOf('resources/read', { uri: 'ui://w/é.html' })).toBe('ui://w/%C3%A9.html');
    expect(mcpNameOf('tools/list', {})).toBeUndefined();
  });

  it('displayUrl redacts secret query values and userinfo', () => {
    expect(displayUrl('https://u:p@a.test/mcp?api_key=s3cret&x=1')).toBe('https://a.test/mcp?api_key=«redacted»&x=1');
    expect(displayUrl('https://a.test')).toBe('https://a.test');
  });

  it('R-9: displayUrl redacts secret-named fragment parameters, known-format tokens in path segments and query values', () => {
    expect(displayUrl('http://h.test/mcp#access_token=FRAGSYNTH0001&state=open')).toBe('http://h.test/mcp#access_token=«redacted»&state=open');
    expect(displayUrl('https://h.test/api/s/sk-live-PATHSYNTH0123456789/mcp?sig=ghp_QUERYSYNTHabcdefghijklmnopqrstuvwxyz&page=2'))
      .toBe('https://h.test/api/s/«redacted»/mcp?sig=«redacted»&page=2');
    expect(displayUrl('https://h.test/mcp/v1?page=2#section-2')).toBe('https://h.test/mcp/v1?page=2#section-2');
  });

  it('stderrSummary keeps the cause line of a stack trace, not only the bottom frames', () => {
    const tail = 'file:///x/index.js:22\nError running script: ReferenceError: crypto is not defined\n    at run (file:///x/index.js:22:46)\n    at async ModuleLoader.import (node:internal/modules/esm/loader:336:24)';
    expect(stderrSummary(tail, createRedactor())).toMatch(/^Error running script: ReferenceError: crypto is not defined \| at async ModuleLoader/);
  });

  it('cleanErrorMessage strips HTML pages and shows the status', () => {
    const m = cleanErrorMessage(`Streamable HTTP error: Error POSTing to endpoint: <!doctype html><html><head><title>Example Domain</title></head><body>${'x'.repeat(600)}</body></html>`, 405, createRedactor());
    expect(m).toBe('HTTP 405: Streamable HTTP error: Error POSTing to endpoint: HTML page ("Example Domain")');
    expect(m).not.toContain('<');
    expect(m.length).toBeLessThan(220);
  });
});
