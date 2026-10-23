// End-to-end: the built CLI against the GOOD and BAD stdio fixture servers.
import { existsSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BAD, cli, GOOD, nonInfo, ruleIds } from './cli-runner.js';

/** Snapshot of the rule IDs the BAD fixture must trigger (frozen; update deliberately). */
const BAD_STDIO_RULES = [
  'APPS-001', 'APPS-003', 'APPS-005', 'APPS-007', 'APPS-012', 'APPS-017', 'APPS-018',
  'DATA-001', 'DATA-003', 'DATA-004', 'DATA-005',
  'INJ-001', 'INJ-003', 'INJ-005', 'INJ-006', 'INJ-008',
  'POL-001', 'POL-005',
  'SPEC-008', 'SPEC-009',
  'SRV-002', 'SRV-011', 'SRV-018',
  'TOOL-002', 'TOOL-003', 'TOOL-005', 'TOOL-006', 'TOOL-008', 'TOOL-011', 'TOOL-012', 'TOOL-013', 'TOOL-014',
  'TOOL-016', 'TOOL-018', 'TOOL-019', 'TOOL-023', 'TOOL-024', 'TOOL-025', 'TOOL-026', 'TOOL-027', 'TOOL-028', 'TOOL-029',
];

describe('e2e stdio', () => {
  it('GOOD server: zero errors and zero warnings, exit 0', async () => {
    const r = await cli(['--stdio', GOOD, '--format', 'json']);
    expect(r.code, r.stderr).toBe(0);
    expect(nonInfo(r.json)).toEqual([]);
    expect(r.json.server.serverInfo.name).toBe('acme-notes');
    expect(r.json.server.transport).toBe('stdio');
    expect(r.json.summary.verdicts).toEqual({
      claude: { verdict: 'NO AUTOMATED BLOCKERS', errors: 0, warnings: 0 },
      chatgpt: { verdict: 'NO AUTOMATED BLOCKERS', errors: 0, warnings: 0 },
    });
  });

  it('GOOD server with --active: read-only tools are called and still clean', async () => {
    const r = await cli(['--stdio', GOOD, '--format', 'json', '--active']);
    expect(r.code, r.stderr).toBe(0);
    expect(nonInfo(r.json)).toEqual([]);
    expect(r.json.skipped.some((s: any) => s.ruleId.startsWith('RT-'))).toBe(false);
  });

  it('BAD server: emitted rule IDs match the frozen list, exit 1', async () => {
    const r = await cli(['--stdio', BAD, '--format', 'json']);
    expect(r.code, r.stderr).toBe(1);
    expect(ruleIds(r.json)).toEqual(BAD_STDIO_RULES);
    const srv018 = r.json.findings.find((f: any) => f.ruleId === 'SRV-018');
    expect(srv018.message).toContain('Bad MCP server v0.0.1 starting...');
  });

  it('U-5: no tools/call without --active (BAD, --verbose: trace and stderr)', async () => {
    // Without --active the only tools/call is the documented probe of a non-existent tool (README «What the tool sends»).
    // A preload logs every JSON-RPC method the server reads (with the tool name for tools/call) to a file and to the
    // server's stderr, which --verbose prints.
    const PROBE = 'tools/call mcp_review_check_nonexistent_tool';
    const dir = mkdtempSync(join(tmpdir(), 'mrc-u5-'));
    try {
      const spy = join(dir, 'spy.mjs');
      const log = join(dir, 'methods.log');
      writeFileSync(spy, [
        "import { appendFileSync } from 'node:fs';",
        'const emit = process.stdin.emit;',
        "let buf = '';",
        'process.stdin.emit = function (ev, chunk, ...rest) {',
        "  if (ev === 'data') {",
        '    buf += chunk.toString();',
        "    let i; while ((i = buf.indexOf('\\n')) >= 0) {",
        '      const line = buf.slice(0, i); buf = buf.slice(i + 1);',
        '      try {',
        '        const msg = JSON.parse(line);',
        "        const m = msg.method === 'tools/call' ? `tools/call ${msg.params?.name}` : msg.method;",
        "        if (m) { appendFileSync(process.env.MRC_SPY_LOG, m + '\\n'); process.stderr.write('[spy] ' + m + '\\n'); }",
        '      } catch {}',
        '    }',
        '  }',
        '  return emit.call(this, ev, chunk, ...rest);',
        '};',
      ].join('\n'));
      const cmd = `node --import ${pathToFileURL(spy).href} ${BAD.slice('node '.length)}`;
      const calls = () => readFileSync(log, 'utf8').split('\n').filter((m) => m.startsWith('tools/call'));
      const r = await cli(['--stdio', cmd, '--env', `MRC_SPY_LOG=${log}`, '--format', 'json', '--verbose']);
      expect(r.code, r.stderr).toBe(1);
      const methods = readFileSync(log, 'utf8').split('\n').filter(Boolean);
      expect(methods).toContain('initialize');
      expect(methods).toContain('tools/list');
      expect(calls().filter((m) => m !== PROBE)).toEqual([]);
      expect(r.stderr).toContain('[spy] tools/list');
      expect(r.stderr.split('\n').filter((l) => l.includes('tools/call') && !l.includes(PROBE))).toEqual([]);
      // control: the spy does see calls of real tools once --active is given
      rmSync(log, { force: true });
      await cli(['--stdio', cmd, '--env', `MRC_SPY_LOG=${log}`, '--format', 'json', '--active']);
      expect(calls().filter((m) => m !== PROBE).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--target claude drops chatgpt-only findings', async () => {
    const r = await cli(['--stdio', BAD, '--format', 'json', '--target', 'claude']);
    const ids = ruleIds(r.json);
    expect(ids).not.toContain('TOOL-012');
    expect(ids).not.toContain('DATA-004');
    expect(ids).toContain('TOOL-011');
    expect(r.json.findings.every((f: any) => !f.platforms.includes('chatgpt'))).toBe(true);
    expect(r.json.summary.verdicts.chatgpt).toBeUndefined();
  });

  it('--ignore removes a rule but keeps it under ignored', async () => {
    const r = await cli(['--stdio', BAD, '--format', 'json', '--ignore', 'TOOL-012', '--ignore', 'SRV-018']);
    expect(ruleIds(r.json)).not.toContain('TOOL-012');
    expect(r.json.ignored.map((f: any) => f.ruleId)).toContain('TOOL-012');
  });

  it('--fail-on never exits 0 even with errors', async () => {
    expect((await cli(['--stdio', BAD, '--fail-on', 'never'])).code).toBe(0);
  });

  it('SARIF output is valid 2.1.0', async () => {
    const r = await cli(['--stdio', BAD, '--format', 'sarif']);
    expect(r.json.version).toBe('2.1.0');
    expect(r.json.$schema).toMatch(/sarif/);
    const run = r.json.runs[0];
    expect(run.tool.driver.name).toBe('mcp-review-check');
    for (const res of run.results) {
      expect(res).toHaveProperty('ruleId');
      expect(res).toHaveProperty('message.text');
      expect(['error', 'warning', 'note']).toContain(res.level);
      expect(res.locations[0].physicalLocation.artifactLocation.uri).toMatch(/^stdio:/);
    }
  });

  it('markdown and --output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mrc-'));
    const out = join(dir, 'report.md');
    try {
      const r = await cli(['--stdio', GOOD, '--format', 'markdown', '--output', out]);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/score 100\/100 .* PASS · report written to/);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, 'utf8')).toMatch(/^# Acme Notes 1\.4\.2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exit 2 on usage errors', async () => {
    expect((await cli([])).code).toBe(2);
    expect((await cli(['https://a.test/mcp', '--stdio', 'node x.js'])).code).toBe(2);
    expect((await cli(['https://a.test/mcp', '--target', 'gemini'])).code).toBe(2);
    expect((await cli(['https://a.test/mcp', '--header', 'NoColon'])).code).toBe(2);
    expect((await cli(['https://a.test/mcp', '--bogus'])).code).toBe(2);
    const quote = await cli(['--stdio', "node 'x.mjs"]);
    expect(quote.code).toBe(2);
    expect(quote.stderr).toMatch(/unterminated/);
    expect(quote.stderr).not.toMatch(/\n\s+at /); // no stack trace
    expect((await cli(['https://a.test/mcp', '--timeout', '3000000000'])).code).toBe(2);
  });

  it('unwritable --output: exit 2 with a clear message, report printed instead', async () => {
    const r = await cli(['--stdio', GOOD, '--format', 'json', '--output', '/nonexistent-dir-mrc/r.json']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/cannot write --output/);
    expect(r.json.server.serverInfo.name).toBe('acme-notes');
  });

  it('exit 3 when the stdio server cannot start; report still emitted', async () => {
    const r = await cli(['--stdio', 'node -e "process.exit(1)"', '--format', 'json']);
    expect(r.code).toBe(3);
    expect(r.json.coverage.toolLevel).toBe('connect-failed');
    const srv003 = r.json.findings.find((f: any) => f.ruleId === 'SRV-003');
    expect(srv003?.severity).toBe('error');
    // a local launch failure is not a directory blocker and gets stdio-specific advice
    expect(srv003.platforms).toEqual(['spec']);
    expect(srv003.fix).toMatch(/stdin\/stdout/);
    expect(r.json.summary.verdicts.claude.verdict).not.toBe('BLOCKED');
  });

  it('--list-rules, --help and --version exit 0', async () => {
    const list = await cli(['--list-rules']);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('TOOL-011');
    expect(list.stdout).toContain('MAN-031');
    expect((await cli(['--help'])).stdout).toMatch(/provisional/);
    expect((await cli(['--version'])).stdout.trim()).toBe('0.1.0');
  });
});
