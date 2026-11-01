// Regression tests for the WP1-cli remediation (review 2026-11-01): CLI argument validation, explain and
// --list-rules output, the summary line, the entry-point check and signal handling. In process through runCli
// where the run needs no real process, the built CLI (cli()) where the process itself is under test.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { cli, GOOD } from './cli-runner.js';

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
