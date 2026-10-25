// Exit 3 has one outcome everywhere. A --max-duration stop after the handshake exits 3 and reads
// INCOMPLETE (stopped at --max-duration during <phase>) in text, markdown, the step summary and the --output line, also
// with errors found before the stop and with --fail-on never; JSON summary.failed is true on exit 3; in GitHub Actions
// exit 3 prints exactly one ::error with the cause, the unexpected-failure path (no report) as well.
// Black box: the built CLI (cli); unit: buildReport, resultLine and annotations; runCli in process with a failing
// buildSnapshot for the unexpected-failure path.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { annotations } from '../src/report/github.js';
import { buildReport, resultLine } from '../src/report/index.js';
import { RULES } from '../src/rules/index.js';
import { runRules } from '../src/rules/engine.js';
import type { Finding } from '../src/rules/types.js';
import { cli } from './cli-runner.js';
import { listen, type Started } from './fixtures/http-bridge.js';
import { loadSnapshot } from './helpers.js';

// Only the in-process runCli of the unexpected-failure test meets this: the other cases run the built CLI.
vi.mock('../src/connect.js', async (orig) => ({
  ...(await orig<typeof import('../src/connect.js')>()),
  buildSnapshot: vi.fn(async (o: { bearer?: string }) => { throw new Error(`unexpected failure near ${o.bearer}\n    at somewhere (x.js:1:1)`); }),
}));

const HANG = `node ${fileURLToPath(new URL('./fixtures/hang-server.mjs', import.meta.url))}`;
const STOP = ['--max-duration', '1500', '--timeout', '20000'];
const INCOMPLETE = 'INCOMPLETE (stopped at --max-duration during listing)';
const OWN = '::error title=mcp-review-check::';
/** The workflow-command lines of stderr. */
const commands = (stderr: string) => stderr.split('\n').filter((l) => l.startsWith('::'));
const f = (ruleId: string, severity: Finding['severity'], over: Partial<Finding> = {}): Finding => ({
  ruleId, title: 't', severity, platforms: ['claude'], message: 'm', fix: 'fix', docs: ['https://x.test'], ...over,
});

let dir = '';
const servers: Started[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-incomplete-')); });
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  for (const s of servers.splice(0)) await s.close();
});

/** A URL nothing listens on. */
async function closedPort(): Promise<string> {
  const s = await listen(() => {});
  await s.close();
  return s.url;
}

/** Answers initialize over plain http (SRV-001 error with --no-local); every later request hangs (as in e2e-http.test.ts). */
async function hangAfterHandshake(): Promise<Started> {
  const s = await listen(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    for await (const c of req) body += c;
    const m = JSON.parse(body);
    if (m.id === undefined) { res.writeHead(202).end(); return; }
    const reply = (x: object) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...x })); };
    if (m.method === 'initialize') return reply({ result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'hang', version: '1' } } });
    if (m.method === 'server/discover') return reply({ error: { code: -32601, message: 'Method not found' } });
    await new Promise(() => {});
  });
  servers.push(s);
  return s;
}

describe('a --max-duration stop after the handshake is exit 3 and INCOMPLETE', () => {
  it('a stop after the handshake exits 3 and reads INCOMPLETE (stopped at --max-duration during listing) in text, markdown, step summary and the --output line', async () => {
    const summary = join(dir, 'summary.md');
    const out = join(dir, 'report.txt');
    const [text, md, written] = await Promise.all([
      cli(['--stdio', HANG, ...STOP]),
      cli(['--stdio', HANG, ...STOP, '--format', 'markdown'], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary }),
      cli(['--stdio', HANG, ...STOP, '--output', out]),
    ]);
    expect(text.code, text.stderr).toBe(3);
    expect(text.stdout).toContain(`Result: ${INCOMPLETE}\n`);
    expect(md.code, md.stderr).toBe(3);
    expect(md.stdout).toContain(`| Result | ${INCOMPLETE} |`);
    expect(readFileSync(summary, 'utf8')).toContain(`| Result | ${INCOMPLETE} |`);
    expect(written.code, written.stderr).toBe(3);
    expect(written.stderr).toMatch(new RegExp(`^mcp-review-check: score .* · ${INCOMPLETE.replace(/[()]/g, '\\$&')} · report written to `, 'm'));
    expect(readFileSync(out, 'utf8')).toContain(`Result: ${INCOMPLETE}`);
  });

  it('--fail-on never still exits 3 on a stop', async () => {
    const r = await cli(['--stdio', HANG, ...STOP, '--fail-on', 'never']);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stdout).toContain(`Result: ${INCOMPLETE}\n`);
  });

  it('errors found before the stop: exit 3 and the Result names them after INCOMPLETE', async () => {
    const s = await hangAfterHandshake();
    const r = await cli([s.url, '--no-local', ...STOP]);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stdout).toMatch(/Result: INCOMPLETE \(stopped at --max-duration during listing\) · claude: \d+ errors? \([^)]*SRV-001/);
  });

  it('resultLine of a stopped snapshot without fatal reads INCOMPLETE with the phase and the gate reason; a stop before the handshake stays FAIL (could not connect)', () => {
    const srv001 = f('SRV-001', 'error', { platforms: ['claude', 'chatgpt'], severityByPlatform: { claude: 'error', chatgpt: 'error' } });
    const s = loadSnapshot('minimal-http');
    s.coverage = { toolLevel: 'stopped', reason: 'stopped by --max-duration (4000 ms) during wire probes' };
    s.limits = { truncated: [], stopped: { maxDurationMs: 4000, phase: 'wire probes' } };
    const r = buildReport(s, { ...runRules(s, RULES), findings: [srv001] }, [], 'error', new Date('2026-10-22T10:00:00Z'), 1);
    expect(resultLine(r)).toBe('INCOMPLETE (stopped at --max-duration during wire probes) · claude: 1 error (SRV-001); chatgpt: 1 error (SRV-001)');
    const never = buildReport(s, { ...runRules(s, RULES), findings: [srv001] }, [], 'never', new Date('2026-10-22T10:00:00Z'), 1);
    expect(resultLine(never)).toBe('INCOMPLETE (stopped at --max-duration during wire probes)');
    const early = loadSnapshot('minimal-http');
    early.fatal = 'no handshake within --max-duration (1500 ms)';
    early.limits = { truncated: [], stopped: { maxDurationMs: 1500, phase: 'connect' } };
    expect(resultLine(buildReport(early, { ...runRules(early, RULES), findings: [] }, [], 'error', new Date('2026-10-22T10:00:00Z'), 1))).toBe('FAIL (could not connect)');
  });
});

describe('JSON agrees with exit 3', () => {
  it('exit 3 has summary.failed = true', async () => {
    const [refused, stopped] = await Promise.all([
      cli([await closedPort(), '--format', 'json', '--timeout', '3000']),
      cli(['--stdio', HANG, ...STOP, '--format', 'json']),
    ]);
    expect(refused.code, refused.stderr).toBe(3);
    expect(refused.json.summary.failed).toBe(true);
    expect(stopped.code, stopped.stderr).toBe(3);
    expect(stopped.json.limits.stopped).toMatchObject({ phase: 'listing' });
    expect(stopped.json.summary.failed).toBe(true);
  });
});

describe('exit 3 in GitHub Actions', () => {
  it('exit 3 prints exactly one ::error with the cause', async () => {
    const [refused, stopped] = await Promise.all([
      cli([await closedPort(), '--format', 'json', '--timeout', '3000'], { GITHUB_ACTIONS: 'true' }),
      cli(['--stdio', HANG, ...STOP, '--format', 'json'], { GITHUB_ACTIONS: 'true' }),
    ]);
    expect(refused.code, refused.stderr).toBe(3);
    expect(commands(refused.stderr).filter((l) => l.startsWith(OWN)), refused.stderr).toHaveLength(1);
    expect(commands(refused.stderr).filter((l) => /^::error title=mcp-review-check::Could not connect: /.test(l))).toHaveLength(1);
    expect(stopped.code, stopped.stderr).toBe(3);
    expect(commands(stopped.stderr).filter((l) => l.startsWith(OWN)), stopped.stderr).toHaveLength(1);
    expect(commands(stopped.stderr).filter((l) => /::error title=mcp-review-check::Stopped by --max-duration .* during listing/.test(l))).toHaveLength(1);
  });

  it('a finished run (exit 0 or 1) has no outcome annotation', () => {
    const s = loadSnapshot('minimal-http');
    const r = buildReport(s, runRules(s, RULES), [], 'error', new Date('2026-10-22T10:00:00Z'), 1);
    expect(annotations(r).filter((l) => l.startsWith(OWN))).toEqual([]);
  });

  it('an unexpected failure (exit 3 without a report) prints exactly one ::error, the --bearer value masked', async () => {
    const SECRET = 'sk-live-CRASHSYNTH0001';
    const r = await runCli(['http://127.0.0.1:1/mcp', '--bearer', SECRET, '--format', 'json'], { GITHUB_ACTIONS: 'true' }, false);
    expect(r.code, r.stderr).toBe(3);
    const own = commands(r.stderr).filter((l) => l.startsWith(OWN));
    expect(own, r.stderr).toHaveLength(1);
    expect(own[0]).toMatch(/unexpected failure near /);
    expect(own[0]).not.toContain('%0A'); // the first line of the error only
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });
});
