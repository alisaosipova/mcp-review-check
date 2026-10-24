import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { argvSecrets, buildRedactor, redactDeep, scrub, urlSecrets } from '../src/redact.js';
import { cleanErrorMessage, stderrSummary } from '../src/connect.js';
import { createRedactor } from '../src/protocol/trace.js';
import { buildReport } from '../src/report/index.js';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import { cli } from './cli-runner.js';
import { loadSnapshot } from './helpers.js';

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

  // R-9 (D-sec-2, D-sec-7, D-sec-8): sources without a flag sign; synthetic values only.
  const PATH_TOK = 'sk-live-PATHSYNTH0123456789';
  const QUERY_TOK = 'ghp_QUERYSYNTHabcdefghijklmnopqrstuvwxyz';
  const USER_TOK = 'ghp_USERSYNTHabcdefghijklmnopqrstuvwxyz01';

  it('R-9: urlSecrets: known-format tokens in query values under any name and in path segments, secret-named fragment parameters, the username', () => {
    expect(urlSecrets(`https://${USER_TOK}@h.test/api/s/${PATH_TOK}/mcp?sig=${QUERY_TOK}&page=2#access_token=FRAGSYNTH0001&state=open`))
      .toEqual([QUERY_TOK, 'FRAGSYNTH0001', PATH_TOK, USER_TOK, USER_TOK]);
    // user:pass@: the username is masked too, a short one is left out as everywhere (under 4 characters)
    expect(urlSecrets(`https://${USER_TOK}:pw-PASSSYNTH01@h.test/mcp`)).toEqual(['pw-PASSSYNTH01', 'pw-PASSSYNTH01', USER_TOK, USER_TOK]);
    // a malformed percent-escape in the userinfo keeps every other value (fail-closed)
    expect(urlSecrets(`https://bad%zzuser:pw-PASSSYNTH02@h.test/mcp?token=abcd`)).toEqual(['abcd', 'pw-PASSSYNTH02', 'pw-PASSSYNTH02', 'bad%zzuser', 'bad%zzuser']);
    // no known-format token: plain path segments, query values and fragments stay
    expect(urlSecrets('https://h.test/mcp/v1/tools?sig=abc&page=2#section-2')).toEqual([]);
  });

  it('R-9: argvSecrets: a positional argument that is a known-format token, once, after the flag-taken values', () => {
    expect(argvSecrets(['server.js', 'sk-live-POSITIONALSYNTH01', '--api-key', QUERY_TOK, '--model', 'gpt-4o-mini-2024-07-18', '@scope/pkg@latest', `https://x.test/s/${PATH_TOK}/mcp`]))
      .toEqual(['sk-live-POSITIONALSYNTH01', QUERY_TOK, PATH_TOK]);
  });

  it('R-9: known token formats are recognized whole (D-sec-2-heuristic), ordinary arguments are not', () => {
    for (const t of ['sk-live-SYNTHabcdefghijklmnop0123', 'sk-proj-SYNTHAbCdEfGhIjKlMnOpQrStUv012345', 'sk_live_SYNTH0123456789abcdefABCD', 'ghp_SYNTHabcdefghijklmnopqrstuvwxyz0123',
      'github_pat_11SYNTH0abcdefghijkl_mnopqrstuvwxyzABCDEF0123456789', 'glpat-SYNTHabcdefghij0123456', 'xoxb-1234567890-SYNTH-abcdefghij', 'AKIASYNTH0EXAMPLE123',
      'npm_SYNTHabcdefghijklmnopqrstuvwxyz01234', 'hf_SYNTHabcdefghijklmnopqrstuvwxyz01', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aCJ9.SYNTHsigABCdef0123']) expect(argvSecrets([t]), t).toEqual([t]);
    for (const a of ['/home/user/project/dist/server.js', 'C:\\Users\\me\\mcp\\server.js', './node_modules/.bin/mcp-server', '@modelcontextprotocol/server-filesystem', 'mcp-server-git@1.2.3',
      '@scope/pkg@latest', '-y', '--directory', 'mcp_server_fetch', 'claude-sonnet-4-5-20250929', 'gpt-4o-mini-2024-07-18', '123e4567-e89b-12d3-a456-426614174000',
      'da39a3ee5e6b4b0d3255bfef95601890afd80709', '2026-10-24T11:11:07.869Z', 'ghcr.io/org/mcp-image:1.4.2', 'db.internal.example.com', 'skeleton-loader-component-v2', 'sk-SK', 'AKIA',
      'eyJhbGciOiJIUzI1NiJ9', 'node_modules_cache_v2_LinuxX64_Node20', 'Dockerfile.production-build-2026', 'x sk-live-SYNTHabcdefghijklmnop0123']) expect(argvSecrets([a]), a).toEqual([]);
  });

  it('R-9: buildRedactor: the URL username and the parts of a composite --env value are strong values', () => {
    expect([...buildRedactor({ url: `http://${USER_TOK}@h.test/mcp` }, true).values]).toContain(USER_TOK);
    const v = [...buildRedactor({ env: { DATABASE_URL: 'postgres://app:pw-DBSYNTH0001@db.test:5432/app', UPSTREAM_AUTH: 'Bearer sk-live-UPSYNTH0002' } }, true).values];
    expect(v).toContain('pw-DBSYNTH0001');
    expect(v).toContain('sk-live-UPSYNTH0002');
    // the whole value under a plain name stays weak (R-8)
    expect(v).not.toContain('postgres://app:pw-DBSYNTH0001@db.test:5432/app');
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

  it('redactDeep copies the report: strings, keys of server data and URL objects are scrubbed, the input is untouched', () => {
    const r = buildRedactor({ bearer: 'tok-SECRET' });
    const shared = { m: 'uses tok-SECRET' };
    const input = { a: [shared, shared], u: new URL('https://x.test/?k=tok-SECRET'), serverInfo: { ['tok-SECRET']: 1 }, n: 3, d: new Date(0) };
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

// Review round 2 (S-25): one-word secret names, header names, the --flag= forms, keys of the report's own structure.
describe('SEC-1 review round 2 (S-25): redactor units', () => {
  it('S-25: a secret sign written as one word with what precedes it is a secret (authtoken, apitoken, secretkey, GITHUBTOKEN, X-Auth:); look-alikes are not', () => {
    expect(argvSecrets(['--authtoken', 'v1-AUTHTOK', '--apitoken=v2-APITOK', '--accesstoken', 'v3-ACCTOK', '--secretkey', 'v4-SECKEY', '--authkey', 'v5-AUTHKEY', 'GITHUBTOKEN=v6-GHTOK', 'X-Auth: v7-XAUTH']))
      .toEqual(['v1-AUTHTOK', 'v2-APITOK', 'v3-ACCTOK', 'v4-SECKEY', 'v5-AUTHKEY', 'v6-GHTOK', 'v7-XAUTH']);
    expect(argvSecrets([
      '--keyboard', 'us', '--monkey', 'george', '--author', 'Ann', '--tokenizer-path', '/t', '--tokenizer', 'cl100k',
      '--maxtokens', '512', '--secretkey-file', 'k.pem', '--authtoken-path', '/a', 'X-Author: Ann',
    ])).toEqual([]);
    const q = urlSecrets('https://x.test/mcp?authtoken=v8-QAUTHTOK&apitoken=v9-QAPITOK&keyboard=us');
    expect(q).toContain('v8-QAUTHTOK');
    expect(q).toContain('v9-QAPITOK');
    expect(q).not.toContain('us');
  });

  it('S-25: the --flag=Header: value and --flag=URL forms in argv give the header token and the URL credentials', () => {
    expect(argvSecrets(['--header=Authorization: Bearer v10-HDREQ'])).toContain('v10-HDREQ');
    const url = argvSecrets(['--server-url=https://u:pw12@h.test/mcp?token=abcd']);
    expect(url).toContain('pw12');
    expect(url).toContain('abcd');
  });

  it('S-25: redactDeep keeps the field names and the own vocabulary of the snapshot and the report; keys are masked only inside what the server sent', () => {
    const r = buildRedactor({ env: { LOG_LEVEL: 'error', MODE: 'summary', STATE: 'failed' } });
    const input = {
      summary: { errors: 1, warnings: 2, failed: true, gate: { failed: 'x' } },
      failOn: 'error',
      findings: [{ ruleId: 'TOOL-001', severity: 'error', platforms: ['claude'], severityByPlatform: { claude: 'error' }, message: 'an error' }],
      snap: {
        serverInfo: { name: 's', 'x-error-hint': 'an error' },
        tools: [{ name: 't', inputSchema: { properties: { error_code: { type: 'string' } } } }],
        resourceReads: { 'ui://error/w': { ok: false, error: 'boom' } },
      },
    };
    const out = redactDeep(input, r) as any;
    expect(Object.keys(out)).toEqual(['summary', 'failOn', 'findings', 'snap']);
    expect(out.failOn).toBe('error');
    expect(out.findings[0]).toEqual({ ruleId: 'TOOL-001', severity: 'error', platforms: ['claude'], severityByPlatform: { claude: 'error' }, message: 'an «redacted»' });
    expect(Object.keys(out.summary)).toEqual(['errors', 'warnings', 'failed', 'gate']);
    expect(out.summary.failed).toBe(true);
    expect(Object.keys(out.summary.gate)).toEqual(['failed']);
    expect(Object.keys(out.snap)).toEqual(['serverInfo', 'tools', 'resourceReads']);
    expect(out.snap.serverInfo).toEqual({ name: 's', 'x-«redacted»-hint': 'an «redacted»' });
    expect(Object.keys(out.snap.tools[0].inputSchema.properties)).toEqual(['«redacted»_code']);
    // a map keyed by what the server chose: its keys are masked, its entries keep their field names
    expect(out.snap.resourceReads).toEqual({ 'ui://«redacted»/w': { ok: false, error: 'boom' } });
  });
});

describe('SEC-1 defence in depth (S-28): redactor units', () => {
  it('S-28: the own vocabulary is kept only outside what the server sent: kind and role under capabilities, initializeRaw, discoverRaw and resourceReads are masked, their keys are not', () => {
    const r = buildRedactor({ env: { K: 'S3cretValue99', LOG_LEVEL: 'error' } });
    const input = {
      summary: { errors: 1, warnings: 0 },
      failOn: 'error',
      findings: [{ ruleId: 'TOOL-001', severity: 'error', platforms: ['claude'], severityByPlatform: { claude: 'error' }, verdict: 'error', message: 'an error' }],
      snap: {
        kind: 'error',
        capabilities: { experimental: { x: { kind: 'S3cretValue99', role: 'S3cretValue99', note: 'S3cretValue99' } } },
        initializeRaw: { capabilities: { experimental: { y: { severity: 'S3cretValue99', error: 1 } } } },
        discoverRaw: { _meta: { 'io.modelcontextprotocol/serverInfo': { role: 'S3cretValue99', kind: ['S3cretValue99'] } } },
        resourceReads: { 'ui://w': { ok: false, error: { kind: 'S3cretValue99' } } },
      },
    };
    const out = redactDeep(input, r) as any;
    expect(out.snap.capabilities).toEqual({ experimental: { x: { kind: '«redacted»', role: '«redacted»', note: '«redacted»' } } });
    expect(out.snap.initializeRaw).toEqual({ capabilities: { experimental: { y: { severity: '«redacted»', error: 1 } } } });
    expect(out.snap.discoverRaw).toEqual({ _meta: { 'io.modelcontextprotocol/serverInfo': { role: '«redacted»', kind: ['«redacted»'] } } });
    expect(out.snap.resourceReads).toEqual({ 'ui://w': { ok: false, error: { kind: '«redacted»' } } });
    // the report's own fields and vocabulary stay: --env LOG_LEVEL=error does not hide a severity or rename summary.errors
    expect(Object.keys(out.summary)).toEqual(['errors', 'warnings']);
    expect(out.failOn).toBe('error');
    expect(out.snap.kind).toBe('error');
    expect(out.findings[0]).toEqual({ ruleId: 'TOOL-001', severity: 'error', platforms: ['claude'], severityByPlatform: { claude: 'error' }, verdict: 'error', message: 'an «redacted»' });
  });
});

describe('R-10', () => {
  const SPLIT = `node ${fileURLToPath(new URL('./fixtures/utf8-split.mjs', import.meta.url))}`;

  it('D-sec-1: stderrSummary and cleanErrorMessage mask before they cut', () => {
    const SECRET = 'sk-live-SUMMARYSYNTH0123456789';
    const r = createRedactor([], [SECRET]);
    const text = 'Error: key '.padEnd(185, '.') + SECRET;
    expect(stderrSummary(text, r)).not.toContain('sk-live-SUMM');
    expect(cleanErrorMessage(text, 500, r)).not.toContain('sk-live-SUMM');
    expect(cleanErrorMessage(text, 500, r)).toMatch(/^HTTP 500: Error: key \.+«redacted»$/);
  });

  it('D-sec-6: a stderr echo split inside a UTF-8 character is still masked', async () => {
    const r = await cli(['--format', 'text', '--verbose', '--env', 'DB_PASSWORD=pw-SYNTHü0001-SECRET', '--stdio', SPLIT]);
    expect(r.stdout + r.stderr).toContain('login failed with password «redacted»');
    expect(r.stdout + r.stderr).not.toContain('0001-SECRE');
  }, 60000);

  it('D-sec-6: a non-JSON stdout line split inside a UTF-8 character is still masked', async () => {
    const r = await cli(['--format', 'json', '--env', 'DB_PASSWORD=pw-SYNTHü0001-SECRET', '--stdio', `${SPLIT} --stdout`]);
    expect(r.json.findings.find((f: any) => f.ruleId === 'SRV-018').message).toContain('login failed with password «redacted»');
    expect(r.stdout + r.stderr).not.toContain('0001-SECRE');
  }, 60000);

  it('D-sec-3: the gate texts are not masked by value', () => {
    const s = loadSnapshot('minimal-http');
    const report = buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', new Date('2026-10-22T10:00:00Z'), 1);
    const gate = { platforms: ['claude'], reason: 'claude: 2 errors (A-1)', notGated: 'spec: 1 error (B-1) not gated' };
    const out = redactDeep({ ...report, summary: { ...report.summary, gate } }, createRedactor([], ['error']));
    expect(out.summary.gate).toEqual(gate);
  });

  it('CRIT-3: a "__proto__" key from server data stays as data', () => {
    const tool = JSON.parse('{"name":"t","inputSchema":{"type":"object","properties":{"__proto__":{"type":"string"},"q":{"type":"string"}}}}');
    const out: any = redactDeep({ tools: [tool] }, buildRedactor({ bearer: 'SYNTH-BEARER-0001' }));
    const props = out.tools[0].inputSchema.properties;
    expect(Object.keys(props)).toEqual(['__proto__', 'q']);
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(JSON.stringify(props)).toBe('{"__proto__":{"type":"string"},"q":{"type":"string"}}');
  });
});
