// Regression tests for the WP1-cli remediation (review 2026-11-01): CLI argument validation, explain and
// --list-rules output, the summary line, the entry-point check and signal handling. In process through runCli
// where the run needs no real process, the built CLI (cli()) where the process itself is under test.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { VERSION } from '../src/version.js';
import { BAD, CLI, cli, GOOD, ROOT } from './cli-runner.js';

const URL_ = 'http://127.0.0.1:1/mcp';
const usage = async (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(args, env, false);

describe('--header names (F002)', () => {
  it('a name that is not an HTTP token is a usage error (exit 2), not a connect failure, and the value is not shown', async () => {
    for (const h of ['bad name: SECRETVALUE', 'X(y): SECRETVALUE', 'Ünï: SECRETVALUE']) {
      const r = await usage([URL_, '--header', h]);
      expect(r.code, h).toBe(2);
      expect(r.stderr, h).toContain('--header name must be an HTTP token');
      expect(r.stderr, h).not.toContain('SECRETVALUE');
    }
  });
});

describe('--timeout and --max-duration take whole milliseconds only (F015)', () => {
  it.each(['0x10', '1e2', '1.5', ' 100', '100 ', '+100', ''])('%j is a usage error', async (v) => {
    for (const flag of ['--timeout', '--max-duration']) {
      const r = await usage([URL_, `${flag}=${v}`]);
      expect(r.code, `${flag} ${v}`).toBe(2);
      expect(r.stderr).toContain(`${flag} must be a positive whole number of milliseconds`);
    }
  });
});

/** A stdio server with one read-only tool whose every call fails with an auth message as isError text (RT-009). */
const AUTH_TEXT_SERVER = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
const tool = { name: 'get_data', title: 'Get data', description: 'Returns the stored data for the signed-in user.',
  inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'authtext', version: '1' } } });
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: [tool] } });
  if (m.method === 'tools/call') return send({ id: m.id, result: { isError: true, content: [{ type: 'text', text: 'Not authenticated: please sign in first' }] } });
  send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
});
`;
const authTextStdio = ['--stdio', '--', 'node', '-e', AUTH_TEXT_SERVER];
const rt009 = (json: any) => json.findings.filter((f: any) => f.ruleId === 'RT-009');

describe('--bearer, --header and $MCP_REVIEW_CHECK_TOKEN with --stdio (F001)', () => {
  it('--bearer or --header with --stdio is a usage error: nothing would be sent to the server', async () => {
    for (const extra of [['--bearer', 'tok-SECRETVALUE'], ['--header', 'X-Api-Key: SECRETVALUE']]) {
      const r = await usage([...extra, '--stdio', 'node x.mjs']);
      expect(r.code, extra[0]).toBe(2);
      expect(r.stderr).toContain('--bearer and --header apply only to <url>');
      expect(r.stderr).not.toContain('SECRETVALUE');
    }
  });

  it('an exported $MCP_REVIEW_CHECK_TOKEN does not mark a stdio run as authenticated, so RT-009 still runs', async () => {
    const plain = await usage(['--active', '--format', 'json', '--fail-on', 'never', ...authTextStdio]);
    const withToken = await usage(['--active', '--format', 'json', '--fail-on', 'never', ...authTextStdio], { MCP_REVIEW_CHECK_TOKEN: 'abcdef123456tok' });
    expect(plain.code, plain.stderr).toBe(0);
    expect(withToken.code, withToken.stderr).toBe(0);
    expect(rt009(JSON.parse(plain.stdout)).length).toBeGreaterThan(0);
    expect(rt009(JSON.parse(withToken.stdout))).toEqual(rt009(JSON.parse(plain.stdout)));
  });
});

describe('Authorization from --header and --bearer, and repeated --header names (F005)', () => {
  it('--header "Authorization: …" with --bearer is a usage error; so is a header name given twice in any case', async () => {
    const both = await usage([URL_, '--header', 'Authorization: Bearer AAA-SECRET', '--bearer', 'BBB-SECRET']);
    expect(both.code).toBe(2);
    expect(both.stderr).toContain('either with --bearer or with --header "Authorization: …", not both');
    expect(both.stderr).not.toMatch(/AAA-SECRET|BBB-SECRET/);
    const twice = await usage([URL_, '--header', 'X-A: 1', '--header', 'x-a: 2']);
    expect(twice.code).toBe(2);
    expect(twice.stderr).toContain('--header x-a is given more than once');
  });
});

describe('--cwd, --output and the -- separator are checked before the run (F008, F009, F010)', () => {
  it('a --cwd that does not exist or is a file is a usage error naming --cwd, not "spawn node ENOENT" with exit 3', async () => {
    for (const cwd of [join(tmpdir(), 'mrc-wp1-no-such-dir-SECRETVALUE'), GOOD.slice('node '.length), '']) {
      const r = await usage(['--cwd', cwd, '--stdio', 'node -e 1']);
      expect(r.code, cwd).toBe(2);
      expect(r.stderr).toContain('--cwd must be an existing directory');
      expect(r.stderr).not.toContain('SECRETVALUE');
    }
    expect((await usage([URL_, '--cwd', ''])).stderr).toContain('--env and --cwd apply only to --stdio');
  });

  it('--output "" is a usage error instead of printing the report to stdout', async () => {
    const r = await usage(['--output', '', '--stdio', 'node -e 1']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('--output needs a file path');
  });

  it('--stdio "<command>" together with -- <command>, or -- without a bare --stdio, says so instead of "expected a single <url>"', async () => {
    const both = await usage(['--stdio', 'foo', '--', 'node', 'x']);
    expect(both.code).toBe(2);
    expect(both.stderr).toContain('give --stdio either "<command>" or -- <command> [args...], not both');
    const after = await usage(['--', 'node', 'x', '--stdio', 'foo']);
    expect(after.code).toBe(2);
    expect(after.stderr).toContain('"-- <command> [args...]" needs a bare --stdio before the --');
  });
});

describe('keyword values in any case, --ignore as a comma-separated list (F016, R018)', () => {
  it('--target, --format and --fail-on take any case, as --ignore and explain do', async () => {
    const r = await usage(['--stdio', `node ${GOOD.slice('node '.length)}`, '--target', 'CLAUDE', '--format', 'JSON', '--fail-on', 'Warning']);
    expect(r.code, r.stderr).not.toBe(2);
    const json = JSON.parse(r.stdout);
    expect(json.target).toBe('claude');
    const list = await usage(['--list-rules', 'RT-001', '--format', 'Markdown']);
    expect(list.code, list.stderr).toBe(0);
    expect(list.stdout).toMatch(/^\| ID \| Title/);
  });

  it('--ignore A,B ignores both; a bad entry in a list is named when it looks like an ID', async () => {
    const one = await cli(['--stdio', GOOD, '--format', 'json', '--ignore', 'tool-011,MAN-001']);
    const two = await cli(['--stdio', GOOD, '--format', 'json', '--ignore', 'TOOL-011', '--ignore', 'MAN-001']);
    expect(one.code, one.stderr).toBe(two.code);
    expect(one.json.manual.map((m: any) => m.id)).toEqual(two.json.manual.map((m: any) => m.id));
    expect(one.json.manual.map((m: any) => m.id)).not.toContain('MAN-001');
    expect(one.json.ignored).toEqual(two.json.ignored);
    const bad = await usage([URL_, '--ignore', 'TOOL-006,TOOL-999']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--ignore TOOL-999 is not a rule or MAN ID');
  });
});

describe('the --output summary line (R021)', () => {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // The stubborn server with --target claude has exactly one warning (its fresh connection hangs).
  const stubborn = (dir: string) => ['--target', 'claude', '--timeout', '2000', '--stdio', `node "${fileURLToPath(new URL('./fixtures/stubborn-server.mjs', import.meta.url))}" "${join(dir, 'pids')}" --hang-fresh`];
  it.each([['BAD', BAD], ['GOOD', GOOD], ['stubborn', null]])('%s: "1 error" and "1 warning" in the singular, other counts in the plural', async (name, stdio) => {
    const dir = mkdtempSync(join(tmpdir(), 'mrc-wp1-'));
    const out = join(dir, 'report.json');
    const r = await cli(['--format', 'json', '--output', out, ...(stdio ? ['--stdio', stdio] : stubborn(dir))]);
    const s = JSON.parse(readFileSync(out, 'utf8')).summary;
    if (name === 'stubborn') expect(s.warnings, r.stderr).toBe(1);
    expect(r.stderr).toContain(` · ${plural(s.errors, 'error')} · ${plural(s.warnings, 'warning')} · ${s.info} info · `);
    expect(r.stderr).not.toMatch(/\b1 (errors|warnings)\b/);
  });
});

describe('the entry point without its extension (R005)', () => {
  it('node dist/cli --version prints the version instead of exiting 0 silently', async () => {
    const r = await new Promise<{ code: number | null; stdout: string }>((done) => {
      execFile(process.execPath, [CLI.replace(/\.js$/, ''), '--version'], { cwd: ROOT }, (err, stdout) => done({ code: err ? (err as { code?: number }).code ?? 1 : 0, stdout }));
    });
    expect(r).toEqual({ code: 0, stdout: `${VERSION}\n` });
  });
});

describe('options that do not apply to the run (F004, F161)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mrc-wp1-'));
  const toolArgs = join(dir, 'tool-args.json');
  writeFileSync(toolArgs, JSON.stringify({ search_notes: { keywords: 'x' }, serch_notes: { keywords: 'x' }, create_note: { title: 't' } }));

  it('--active-auth with --stdio is a usage error and prints no DCR notice', async () => {
    const r = await usage(['--active-auth', '--stdio', 'node x.mjs']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--active-auth applies only to <url>');
    expect(r.stderr).not.toContain('Notice');
  });

  it('--tool-args without --active and --sarif-location without --format sarif are said to have no effect', async () => {
    const r = await cli(['--stdio', GOOD, '--tool-args', toolArgs, '--sarif-location', 'svc/mcp', '--format', 'json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('warning: --tool-args has no effect without --active');
    expect(r.stderr).toContain('warning: --sarif-location applies only to --format sarif');
    expect(r.stderr).not.toContain('was not used');
  });

  it('with --active, every --tool-args entry no call used is named with its reason', async () => {
    const r = await cli(['--stdio', GOOD, '--active', '--tool-args', toolArgs, '--format', 'json']);
    expect(r.json?.coverage?.toolLevel, r.stderr).toBe('ok');
    expect(r.stderr).toContain('warning: --tool-args entry "serch_notes" was not used: the server lists no tool by that name');
    expect(r.stderr).toContain('warning: --tool-args entry "create_note" was not used: the tool is not read-only');
    expect(r.stderr).not.toContain('"search_notes" was not used');
    expect(r.stderr).not.toContain('has no effect without --active');
  });
});
