// End-to-end: the built CLI against the GOOD and BAD stdio fixture servers.
import { existsSync, readFileSync, rmSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BAD, cli, GOOD, nonInfo, ruleIds } from './cli-runner.js';

const GOOD_PATH = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const UI_CAP = `node ${fileURLToPath(new URL('./fixtures/ui-cap-server.mjs', import.meta.url))}`;
const HANG = `node ${fileURLToPath(new URL('./fixtures/hang-server.mjs', import.meta.url))}`;
const HUGE = `node ${fileURLToPath(new URL('./fixtures/huge-server.mjs', import.meta.url))}`;
const LEAKY = `node ${fileURLToPath(new URL('./fixtures/leaky-server.mjs', import.meta.url))}`;
const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

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

  it('JSON has schemaVersion and tool.catalogAgeDays', async () => {
    const before = Date.now();
    const r = await cli(['--stdio', GOOD, '--format', 'json']);
    const after = Date.now();
    expect(r.code, r.stderr).toBe(0);
    expect(Object.keys(r.json)[0]).toBe('schemaVersion');
    expect(r.json.schemaVersion).toBe(1);
    const born = Date.parse(`${r.json.tool.catalogDate}T00:00:00Z`);
    const age = (t: number) => Math.max(0, Math.floor((t - born) / 86_400_000));
    expect(Number.isInteger(r.json.tool.catalogAgeDays)).toBe(true);
    expect(r.json.tool.catalogAgeDays).toBeGreaterThanOrEqual(age(before));
    expect(r.json.tool.catalogAgeDays).toBeLessThanOrEqual(age(after));
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

  it('no tools/call without --active (BAD, --verbose: trace and stderr)', async () => {
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
      expect(res.locations[0].physicalLocation.artifactLocation.uri).toBe('.mcp-review-check');
    }
  });

  it('markdown and --output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mrc-'));
    const out = join(dir, 'report.md');
    try {
      const r = await cli(['--stdio', GOOD, '--format', 'markdown', '--output', out]);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/score 100\/100 .* PASS \(--fail-on error\) · report written to/);
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
    const both = await cli(['--stdio', 'node x.js', '--stdio', '--', 'node', 'y.js']);
    expect(both.code).toBe(2);
    expect((await cli(['--stdio', '--'])).stderr).toMatch(/--stdio needs a command/);
    expect((await cli(['https://a.test/mcp', '--stdio', '--', 'node', 'x.js'])).code).toBe(2);
  });

  it('--stdio -- <command> [args...]: argv after -- is passed verbatim, options go before --', async () => {
    const r = await cli(['--format', 'json', '--stdio', '--', process.execPath, GOOD_PATH]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.server.serverInfo.name).toBe('acme-notes');
    expect(r.json.server.command).toBe(`${process.execPath} ${GOOD_PATH}`);
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
    expect(r.json.manual).toEqual([]); // no manual checklist when nothing connected
  });

  it('a stdio server that cannot start never reads PASS (text, markdown, --output summary line)', async () => {
    const DEAD = 'node -e "process.exit(1)"';
    const text = await cli(['--stdio', DEAD, '--no-color']);
    expect(text.code).toBe(3);
    expect(text.stdout).toMatch(/Result: FAIL\b/);
    expect(text.stdout).not.toMatch(/Result: PASS/);
    const md = await cli(['--stdio', DEAD, '--format', 'markdown']);
    expect(md.code).toBe(3);
    expect(md.stdout).toMatch(/\| Result \| FAIL\b/);
    expect(md.stdout).not.toMatch(/\| Result \| PASS/);
    const dir = mkdtempSync(join(tmpdir(), 'mrc-r12-'));
    try {
      const out = await cli(['--stdio', DEAD, '--output', join(dir, 'report.txt')]);
      expect(out.code).toBe(3);
      const summary = out.stderr.split('\n').find((l) => l.startsWith('mcp-review-check: score'));
      expect(summary).toMatch(/ · FAIL\b/);
      expect(summary).not.toMatch(/PASS/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an 80 000-character description is truncated and reported (JSON limits, text notice)', async () => {
    const r = await cli(['--stdio', HUGE, '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(3);
    expect(r.json.limits?.truncated).toEqual([{ where: 'tool run_sql', length: 80000, cap: 16384 }]);
    const tool8 = r.json.findings.find((f: any) => f.ruleId === 'TOOL-008' && /characters/.test(f.message));
    expect(tool8?.message).toMatch(/description is over 16384 characters/);
    const text = await cli(['--stdio', HUGE]);
    expect(text.stdout).toContain('1 oversized input truncated before pattern checks: tool run_sql (80000 chars, cap 16 KB).');
    const md = await cli(['--stdio', HUGE, '--format', 'markdown']);
    expect(md.stdout).toContain('> 1 oversized input truncated before pattern checks: tool run_sql (80000 chars, cap 16 KB).');
  });

  it('MCP Apps capability: UI hidden behind getUiCapability is checked; a missing text-only fallback is APPS-019', async () => {
    const r = await cli(['--stdio', UI_CAP, '--format', 'json']);
    const ids = ruleIds(r.json);
    // the UI resource is seen (it is listed only for clients that declare io.modelcontextprotocol/ui)
    expect(r.json.findings.filter((f: any) => f.ruleId === 'APPS-003').map((f: any) => f.message)).toEqual([expect.stringMatching(/text\/plain/)]);
    expect(r.json.skipped.some((x: any) => x.reason === 'no UI resources')).toBe(false);
    expect(r.json.findings.filter((f: any) => f.ruleId === 'APPS-019')).toEqual([expect.objectContaining({ tool: 'get_weather', severity: 'warning' })]);
    expect(ids).not.toContain('SRV-019'); // the text-only list is not a "tool set changed between connections" finding
    const fallback = await cli(['--stdio', `${UI_CAP} --fallback`, '--format', 'json']);
    expect(ruleIds(fallback.json)).toContain('APPS-003');
    expect(ruleIds(fallback.json)).not.toContain('APPS-019');
  });

  it('--max-duration: a server that never answers is stopped at the deadline with a partial report', async () => {
    const t0 = Date.now();
    const r = await cli(['--stdio', HANG, '--format', 'json', '--timeout', '20000', '--max-duration', '2500']);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(r.code, r.stderr).toBe(3); // a stop after the handshake is exit 3 too
    expect(r.json.limits.stopped).toMatchObject({ maxDurationMs: 2500, phase: 'listing' });
    expect(r.json.coverage.toolLevel).toBe('stopped');
    expect(r.json.summary.verdicts.claude.verdict).toBe('INCOMPLETE');
    const text = await cli(['--stdio', HANG, '--max-duration', '1500']);
    expect(text.stdout).toMatch(/stopped by --max-duration 1500 ms during listing/);
    expect((await cli(['--stdio', HANG, '--max-duration', '0'])).code).toBe(2);
  });

  it('--max-duration: a stdio server that never completes initialize exits 3 at the deadline', async () => {
    const t0 = Date.now();
    const r = await cli(['--stdio', 'node -e "setInterval(() => {}, 1000)"', '--format', 'json', '--timeout', '20000', '--max-duration', '1500']);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(r.code).toBe(3);
    expect(r.json.limits.stopped).toMatchObject({ maxDurationMs: 1500, phase: 'connect' });
    expect(r.json.findings.find((f: any) => f.ruleId === 'SRV-003').message).toMatch(/no handshake within --max-duration \(1500 ms\)/);
  });

  it('exit code follows --target: a spec-only error passes unless --fail-on-spec, and the Result line says why', async () => {
    // leaky-server writes a log line to stdout: SRV-018, a spec-only error. Nothing fails Claude or ChatGPT.
    for (const target of ['claude', 'chatgpt', 'all']) {
      const r = await cli(['--stdio', LEAKY, '--target', target, '--no-color']);
      expect(r.code, target).toBe(0);
      expect(r.stdout).toContain('Result: PASS (--fail-on error) · spec: 1 error (SRV-018) not gated; add --fail-on-spec to fail on spec findings');
    }
    const strict = await cli(['--stdio', LEAKY, '--target', 'claude', '--fail-on-spec', '--format', 'json']);
    expect(strict.code).toBe(1);
    expect(strict.json.summary).toMatchObject({ failed: true, gate: { platforms: ['claude', 'spec'], reason: 'spec: 1 error (SRV-018)', notGated: null } });
    // the BAD server fails on its directory findings, and the reason names them
    const bad = await cli(['--stdio', BAD, '--target', 'claude', '--no-color']);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toMatch(/Result: FAIL \(--fail-on error\) · claude: \d+ errors \((INJ|TOOL|DATA|APPS)-\d+/);
  });

  it('a FAIL also names the spec findings that were not gated, and not those a directory counted', async () => {
    const [text, json] = await Promise.all([cli(['--stdio', BAD, '--target', 'claude', '--no-color']), cli(['--stdio', BAD, '--target', 'claude', '--format', 'json'])]);
    expect(text.code).toBe(1);
    expect(text.stdout).toMatch(/Result: FAIL \(--fail-on error\) · claude: \d+ errors \([^\n]* · spec: \d+ errors? \([^\n]*\) not gated; add --fail-on-spec/);
    const notGated: string = json.json.summary.gate.notGated;
    expect(notGated).toMatch(/^spec: \d+ errors? \([A-Z]+-\d+.*\) not gated; add --fail-on-spec to fail on spec findings$/);
    // A finding that is an error for Claude as well as for the spec failed the run: it is not listed as not gated.
    const claudeErrors = new Set(json.json.findings.filter((f: any) => (f.severityByPlatform?.claude ?? 'info') === 'error').map((f: any) => f.ruleId));
    const listed = /\(([^)]*)\) not gated/.exec(notGated)![1].split(', ');
    expect(listed.filter((id) => claudeErrors.has(id))).toEqual([]);
  });

  it('--list-rules, --help and --version exit 0', async () => {
    const list = await cli(['--list-rules']);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('TOOL-011');
    expect(list.stdout).toContain('MAN-031');
    expect((await cli(['--help'])).stdout).toMatch(/provisional/);
    expect((await cli(['--version'])).stdout.trim()).toBe(PKG_VERSION);
    expect((await cli(['--help'])).stdout).toMatch(/--stdio -- <command>/);
    expect((await cli(['--help'])).stdout).toMatch(/--fail-on-spec {10}Also fail on MCP spec findings/);
  });
});

// A fixture server starts only when run as the main module. Its path as typed (Windows C:\..., a link, a space)
// differs from its file URL, so the check must compare real paths: the servers here run through a linked directory.
describe('fixture servers run as the main module under any path form', () => {
  it.each([['good-server.mjs', 0], ['bad-server.mjs', 1], ['ui-cap-server.mjs', 1]] as const)('%s through a linked directory: connects, exit %i', async (file, code) => {
    const dir = mkdtempSync(join(tmpdir(), 'mrc-main '));
    try {
      symlinkSync(fileURLToPath(new URL('./fixtures', import.meta.url)), join(dir, 'fx'), 'junction');
      const r = await cli(['--stdio', `node "${join(dir, 'fx', file)}"`, '--format', 'json']);
      expect(r.code, r.stderr).toBe(code);
      expect(r.json?.coverage?.toolLevel, r.stderr).toBe('ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
