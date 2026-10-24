// R-8 (MRC-2): two redaction tiers. Before the rules only strong values are masked in what the server sent (--bearer,
// --header values, --env under a secret name, URL credentials, argv after a secret flag); an --env value under a plain
// name is masked in the finished report and every channel outside it only, so a word of the protocol or of the
// server's own data in it changes no finding, severity or exit code.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRedactor, scrub } from '../src/redact.js';
import { cli, GOOD } from './cli-runner.js';

/** What R-8 keeps: (rule, severity, tool) of every finding, order aside. */
const triples = (json: any): string[] => json.findings.map((f: any) => `${f.ruleId}|${f.severity}|${f.tool ?? ''}`).sort();

describe('R-8: a word in --env is not masked before the rules', () => {
  it('R-8: a protocol or schema word in --env changes no finding, severity or exit code', async () => {
    const plain = await cli(['--stdio', GOOD, '--format', 'json']);
    expect(plain.code, plain.stderr).toBe(0);
    const words = ['FORMAT=text', 'MODE=title', 'X=object', 'OUT=json', 'KIND=image'];
    const r = await cli(['--stdio', GOOD, ...words.flatMap((w) => ['--env', w]), '--format', 'json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.findings.map((f: any) => f.ruleId), 'no APPS-003 from a masked "text"').not.toContain('APPS-003');
    expect(triples(r.json)).toEqual(triples(plain.json));
    // the words are not secrets: the report keeps them (a mimeType "text/html" stays readable)
    expect(r.stdout).not.toContain('«redacted»');
  });

  it('R-8: an --env value under a plain name that names a field of the server data is masked in the report only', async () => {
    const plain = await cli(['--stdio', GOOD, '--format', 'json']);
    const r = await cli(['--stdio', GOOD, '--env', 'HINT=readOnlyHint', '--format', 'json']);
    expect(r.code, r.stderr).toBe(0);
    // masked before the rules, the annotation key disappeared and TOOL-012 reported every tool
    expect(triples(r.json)).toEqual(triples(plain.json));
    expect(r.stdout).not.toContain('readOnlyHint');
  });

  it('R-8: the strong tier holds --bearer, --header values, URL and argv secrets and --env values under a secret name', () => {
    const input = {
      bearer: 'bearer-STRONG01', headers: { 'X-Trace': 'hdr-STRONG02' }, argv: ['node', 's.js', '--api-key', 'argv-STRONG03'],
      env: { API_TOKEN: 'env-STRONG04', NOTE: 'plain-WEAK05' },
    };
    const strong = buildRedactor(input, true);
    for (const v of ['bearer-STRONG01', 'hdr-STRONG02', 'argv-STRONG03', 'env-STRONG04']) expect(strong.values.has(v), v).toBe(true);
    expect(strong.values.has('plain-WEAK05')).toBe(false);
    expect(buildRedactor(input).values.has('plain-WEAK05'), 'the full set has the weak value').toBe(true);
    expect(buildRedactor({ url: 'https://u:pw-STRONG06@h.test/mcp?token=q-STRONG07' }, true).values).toEqual(new Set(['pw-STRONG06', 'q-STRONG07']));
  });

  it('R-8: protocol and schema words are never treated as secrets, in either tier', () => {
    const text = 'type object string integer array boolean title description properties text image audio resource json html';
    const r = buildRedactor({ bearer: 'object', headers: { 'X-Mode': 'text' }, env: { A: 'title', B: 'json', C: 'image', D: 'string' } });
    expect(r.values.size).toBe(0);
    expect(scrub(text, r)).toBe(text);
  });
});

describe('U-2 with R-8: a weak --env value never reaches a channel', () => {
  const LEAKY = fileURLToPath(new URL('./fixtures/leaky-server.mjs', import.meta.url));
  const WEAK = 'weak-WEAKSYNTH0001';
  // leaky-server echoes $API_TOKEN on stdout and stderr; this start-up hands it the plainly named WEAK_NOTE instead.
  const start = `process.env.API_TOKEN = process.env.WEAK_NOTE ?? ''; process.argv.splice(1, 0, ${JSON.stringify(LEAKY)}); import(${JSON.stringify(pathToFileURL(LEAKY).href)});`;
  const dir = mkdtempSync(join(tmpdir(), 'mrc-tiers-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(['text', 'json', 'markdown', 'sarif'])('%s: report, --output, annotations, job summary, rerun and --verbose stderr carry it masked', async (format) => {
    for (const crash of [false, true]) {
      const args = (opts: string[]) => [...opts, '--format', format, '--verbose', '--stdio', '--', 'node', '-e', start, ...(crash ? ['--crash'] : [])];
      const summary = join(dir, `summary-${format}-${crash}.md`);
      const output = join(dir, `report-${format}-${crash}`);
      const ci = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary };
      const r = await cli(args(['--env', `WEAK_NOTE=${WEAK}`, '--output', output]), ci);
      const all = [r.stdout, r.stderr, readFileSync(summary, 'utf8'), readFileSync(output, 'utf8')].join('\n');
      expect(all, `${format}${crash ? ' --crash' : ''}`).not.toContain('WEAKSYNTH');
      expect(all, 'the channels did carry the value').toContain('«redacted»');
      const plain = await cli(args([]));
      expect(r.code, r.stderr).toBe(plain.code);
      expect(r.code).toBe(crash ? 3 : 0);
      if (format === 'json') expect(triples(JSON.parse(readFileSync(output, 'utf8')))).toEqual(triples(plain.json));
    }
  });
});

describe('R-8 with R-9: the parts of an --env value under a plain name', () => {
  // A raw stdio server whose free-form "sql" tool names its database only in the description. Masked before the rules,
  // "postgres" left the description, and TOOL-026 (a free-form query tool must name its target) reported the tool.
  const server = `const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
const tool = { name: 'query_rows', title: 'Query rows', description: 'Query the postgres database and return the matching rows.', inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'SQL to run' } }, required: ['sql'] }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'pgdb', title: 'Postgres Reader', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [tool] } });
  else send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
});`;
  const run = (opts: string[]) => cli([...opts, '--stdio', '--', 'node', '-e', server]);
  const DB = 'DATABASE_URL=postgres://postgres:postgres@db.test/app';

  it('R-8: a plain URL username or password in --env changes no finding', async () => {
    const plain = await run(['--format', 'json']);
    expect(plain.code, plain.stderr).toBe(0);
    expect(plain.json.findings.map((x: any) => x.ruleId), 'the description names the database').not.toContain('TOOL-026');
    const r = await run(['--env', DB, '--format', 'json']);
    expect(r.code, r.stderr).toBe(plain.code);
    expect(triples(r.json)).toEqual(triples(plain.json));
    // R-9: the finished report still masks them
    const md = await run(['--env', DB, '--format', 'markdown', '--verbose']);
    expect(md.stdout + md.stderr).not.toContain('postgres:postgres@');
    expect(md.stdout).toContain('DATABASE_URL=«redacted»');
    expect(md.stdout).toContain('Query the «redacted» database');
  });

  it('R-8: in the strong tier such parts are only the token-like ones; the full tier has them all', () => {
    const env = { DATABASE_URL: 'postgres://app_user:pw-PLAIN01@db.test/app?token=k-PLAIN02', UPSTREAM: 'Bearer plain-PLAIN03', CACHE_URL: 'redis://ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1@cache.test', NOTE_URL: 'https://x.test/?token=Q7f3kLm9Xz2pR8tVw4' };
    const strong = buildRedactor({ env }, true).values;
    for (const v of ['app_user', 'pw-PLAIN01', 'k-PLAIN02', 'plain-PLAIN03', 'postgres://app_user:pw-PLAIN01@db.test/app?token=k-PLAIN02']) expect(strong.has(v), v).toBe(false);
    for (const v of ['ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', 'Q7f3kLm9Xz2pR8tVw4']) expect(strong.has(v), v).toBe(true);
    const full = buildRedactor({ env }).values;
    for (const v of ['app_user', 'pw-PLAIN01', 'k-PLAIN02', 'plain-PLAIN03']) expect(full.has(v), v).toBe(true);
    // a URL username of --url or of argv joins the strong tier only when it looks like a token; the password stays strong
    expect(buildRedactor({ url: 'https://admin:pw-STRONG08@h.test/mcp' }, true).values).toEqual(new Set(['pw-STRONG08']));
    expect(buildRedactor({ argv: ['node', 's.js', 'https://admin:pw-STRONG09@h.test/'] }, true).values).toEqual(new Set(['pw-STRONG09']));
    expect(buildRedactor({ url: 'https://admin:pw-STRONG08@h.test/mcp' }).values.has('admin')).toBe(true);
    // under a secret name every part stays strong
    expect(buildRedactor({ env: { DB_PASSWORD: 'postgres://app_user:pw-PLAIN01@db.test/app' } }, true).values.has('pw-PLAIN01')).toBe(true);
  });
});
