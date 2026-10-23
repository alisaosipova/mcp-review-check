import { describe, expect, it } from 'vitest';
import { argvSecrets, buildRedactor, redactDeep, scrub, urlSecrets } from '../src/redact.js';

describe('redactor (B2)', () => {
  it('argvSecrets: values after secret-looking flags, --flag=value, KEY=value, URL credentials, header args', () => {
    expect(argvSecrets(['server.js', '--api-key', 'A1', '--token=B2', 'DB_PASSWORD=C3', '--port', '3000', '--verbose'])).toEqual(['A1', 'B2', 'C3']);
    expect(argvSecrets(['mcp-remote', 'https://x.test/mcp', '--header', 'Authorization: Bearer T0K'])).toEqual(['Bearer T0K', 'T0K']);
    expect(argvSecrets(['--db', 'postgres://u:p%40ss@db.test/x', 'https://x.test/?api_key=Q9'])).toEqual(['p%40ss', 'p@ss', 'Q9']);
    // a flag without a value (next arg is another flag) takes nothing
    expect(argvSecrets(['--token', '--verbose'])).toEqual([]);
    // look-alike flags are not secrets
    expect(argvSecrets(['--keyword', 'cats', '--key-file', 'k.pem', '--tokens-max', '10'])).toEqual([]);
    // camelCase flags are secret-looking too; a value may start with a single "-"
    expect(argvSecrets(['--accessToken', 'A1', '--clientSecret=B2', '--authToken', 'C3', 'apiKey=D4', '--password', '-abc1234'])).toEqual(['A1', 'B2', 'C3', 'D4', '-abc1234']);
    expect(argvSecrets(['--maxTokens', '10', '--keyFile', 'k.pem', '--monkey', 'x', '--token', '--verbose'])).toEqual([]);
  });

  it('urlSecrets: secret query values and the userinfo password', () => {
    expect(urlSecrets('https://u:pw@x.test/mcp?token=abc&q=1')).toEqual(['abc', 'pw', 'pw']);
    expect(urlSecrets('not a url')).toEqual([]);
  });

  it('buildRedactor: bearer, header values, env values; trivial values are never redacted', () => {
    const r = buildRedactor({
      bearer: 'bearer-SECRET', headers: { 'X-Api-Key': 'hdr-SECRET', Authorization: 'Bearer tok-SECRET' },
      argv: ['node', 's.js', '--api-key', 'argv-SECRET'], env: { API_TOKEN: 'env-SECRET', DEBUG: 'false', PORT: '3000' },
    });
    const text = 'bearer-SECRET hdr-SECRET tok-SECRET argv-SECRET env-SECRET destructiveHint: false port 3000';
    expect(scrub(text, r)).toBe('«redacted» «redacted» «redacted» «redacted» «redacted» destructiveHint: false port 3000');
    expect(r.headerNames.has('x-api-key')).toBe(true);
  });

  it('scrub also replaces JSON-escaped and percent-encoded forms, longest secret first', () => {
    const r = buildRedactor({ env: { A: 'ab"c/d e', B: 'ab"c/d e-LONGER' } });
    expect(scrub('x ab"c/d e-LONGER y', r)).toBe('x «redacted» y');
    expect(scrub(JSON.stringify({ k: 'ab"c/d e' }), r)).toBe('{"k":"«redacted»"}');
    expect(scrub(`stdio:${encodeURIComponent('run ab"c/d e')}`, r)).toBe('stdio:run%20«redacted»');
  });

  it('redactDeep copies the report: strings, keys and URL objects are scrubbed, the input is untouched', () => {
    const r = buildRedactor({ bearer: 'tok-SECRET' });
    const shared = { m: 'uses tok-SECRET' };
    const input = { a: [shared, shared], u: new URL('https://x.test/?k=tok-SECRET'), ['tok-SECRET']: 1, n: 3, d: new Date(0) };
    const out = redactDeep(input, r);
    expect(JSON.stringify(out)).not.toContain('tok-SECRET');
    expect(out.a[0]).toBe(out.a[1]); // shared references stay shared
    expect(out.u).toBeInstanceOf(URL);
    expect(out.d).toBe(input.d);
    expect(input.a[0].m).toBe('uses tok-SECRET');
    // nothing to redact: same object back
    expect(redactDeep(input, buildRedactor({}))).toBe(input);
  });
});

// Review round 1 (S-22): the secret sign in any segment of a name, raw query values, deep data.
describe('SEC-1 review (S-22): redactor units', () => {
  it('SEC-1 review: a secret sign in any segment of a flag, KEY= or query name; pointers to a secret are not secrets', () => {
    expect(argvSecrets(['--auth-header', 'Bearer sk-AUTHHDR13', '--api-key-value', 'sk-APIVAL14', '--client-secret-value=sk-CSVAL15', 'AUTH_TOKEN_VALUE=sk-ATVAL16']))
      .toEqual(['Bearer sk-AUTHHDR13', 'sk-AUTHHDR13', 'sk-APIVAL14', 'sk-CSVAL15', 'sk-ATVAL16']);
    // false positives: a file, a path, a directory, an id, a URL, a limit or a look-alike word is not the secret itself
    expect(argvSecrets([
      '--token-file', 't.txt', '--password-file=p.txt', '--auth-dir', '/etc/auth', '--key-id', 'k1', '--secret-path', '/run/s',
      '--auth-url', 'https://as.test/authorize', '--max-tokens', '4096', '--keyword', 'cats', '--monkey-patch', 'enabled',
      '--sessionId', 'abc-123', 'TOKEN_LIMIT=500000', '--tokenizer', 'cl100k',
    ])).toEqual([]);
    const all = urlSecrets('https://x.test/mcp?api-key=sk-QAK1&credential=sk-QCR2&client_secret=sk-QCS3&access-token=sk-QAT4&auth_token=sk-QAU5&apiKey=sk-QCA6&q=plain1&key_id=kid7');
    for (const v of ['sk-QAK1', 'sk-QCR2', 'sk-QCS3', 'sk-QAT4', 'sk-QAU5', 'sk-QCA6']) expect(all, v).toContain(v);
    expect(all).not.toContain('plain1');
    expect(all).not.toContain('kid7');
  });

  it('SEC-1 review: urlSecrets keeps the raw query value too ("+", lowercase %2f), not only the decoded one', () => {
    const raw = urlSecrets('https://x.test/mcp?api_key=sk-PLUS+SECRET11&token=sk-abc%2fLOWER12');
    expect(raw).toContain('sk-PLUS+SECRET11');
    expect(raw).toContain('sk-abc%2fLOWER12');
    expect(raw).toContain('sk-PLUS SECRET11');
    expect(raw).toContain('sk-abc/LOWER12');
  });

  it('SEC-1 review: redactDeep walks data 20 000 levels deep without overflowing the stack and redacts the bottom', () => {
    const r = buildRedactor({ bearer: 'tok-DEEPSECRET' });
    let deep: any = { leaf: 'uses tok-DEEPSECRET' };
    for (let i = 0; i < 20000; i++) deep = { a: deep, list: [i, 'tok-DEEPSECRET'] };
    let out: any;
    expect(() => { out = redactDeep(deep, r); }, 'redactDeep throws on deep data').not.toThrow();
    let depth = 0;
    let x = out;
    while (x.a) { expect(x.list[1]).toBe('«redacted»'); x = x.a; depth++; }
    expect(depth).toBe(20000);
    expect(x.leaf).toBe('uses «redacted»');
  });
});
