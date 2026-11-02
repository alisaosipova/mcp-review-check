// Regression tests for the W4A-cli remediation (review 2026-11-01): exit 4 for a --max-duration stop after the
// handshake (F011), the opt-in --fail-on-incomplete and the ::warning annotation for a partial check (R013).
// Black box: the built CLI (cli) against stdio and in-process HTTP fixtures; unit: annotations() on snapshots.
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { annotations } from '../src/report/github.js';
import { buildReport } from '../src/report/index.js';
import { RULES } from '../src/rules/index.js';
import { runRules } from '../src/rules/engine.js';
import { startAuthServer } from './fixtures/auth-server.js';
import type { Started } from './fixtures/http-bridge.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
import { cli, GOOD } from './cli-runner.js';
import { loadSnapshot } from './helpers.js';

const HANG = `node ${fileURLToPath(new URL('./fixtures/hang-server.mjs', import.meta.url))}`;
const STOP = ['--max-duration', '1500', '--timeout', '20000'];
const OWN_WARNING = '::warning title=mcp-review-check::';
const commands = (stderr: string) => stderr.split('\n').filter((l) => l.startsWith('::'));

const servers: Started[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });
const track = (s: Started) => (servers.push(s), s);

describe('exit 4: stopped by --max-duration after the handshake (F011)', () => {
  it('a stop after the handshake exits 4 at any --fail-on and with --fail-on-incomplete; before it, 3', async () => {
    const [plain, never, flag, early] = await Promise.all([
      cli(['--stdio', HANG, ...STOP, '--format', 'json']),
      cli(['--stdio', HANG, ...STOP, '--format', 'json', '--fail-on', 'never']),
      cli(['--stdio', HANG, ...STOP, '--format', 'json', '--fail-on-incomplete']),
      cli(['--stdio', 'node -e "setInterval(() => {}, 1000)"', '--format', 'json', '--timeout', '20000', '--max-duration', '1500']),
    ]);
    for (const r of [plain, never, flag]) {
      expect(r.code, r.stderr).toBe(4);
      expect(r.json.limits.stopped).toMatchObject({ phase: 'listing' });
      expect(r.json.summary.failed).toBe(true);
    }
    expect(early.code, early.stderr).toBe(3); // no handshake: a connect failure, not a stop
  });

  it('--help documents exit 4 and --fail-on-incomplete', async () => {
    const help = (await runCli(['--help'], {}, false)).stdout;
    const block = help.match(/^Exit codes:\n([\s\S]*?)\n\n/m)?.[1] ?? '';
    expect([...block.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1])).toEqual(['0', '1', '2', '3', '4', '128+N']);
    expect(block).toMatch(/^ {2}4 +Stopped by --max-duration after the handshake/m);
    expect(block).toMatch(/--fail-on-incomplete, a partial check/);
    expect(help).toMatch(/^ {2}--fail-on-incomplete {4}Exit 3 when the check is partial/m);
    for (const line of [...block.split('\n'), ...help.split('\n').filter((l) => /incomplete|exit 4/.test(l))]) expect(line.length, line).toBeLessThanOrEqual(120);
  });
});

describe('--fail-on-incomplete and the partial-check annotation (R013)', () => {
  it('auth-required: exit follows --fail-on without the flag, exit 3 with it', async () => {
    const s = track(await startAuthServer({}));
    const [never, flag, flagJson] = await Promise.all([
      cli([s.url, '--fail-on', 'never']),
      cli([s.url, '--fail-on', 'never', '--fail-on-incomplete']),
      cli([s.url, '--fail-on-incomplete', '--format', 'json']),
    ]);
    expect(never.code, never.stderr).toBe(0);
    expect(flag.code, flag.stderr).toBe(3);
    expect(flagJson.code).toBe(3);
    expect(flagJson.json.coverage.toolLevel).toBe('auth-required');
  });

  it('token-rejected: exit 3 with the flag, a ::warning naming the reason in GitHub Actions, the token never shown', async () => {
    const TOKEN = 'tok_rejected_SYNTH_4a1b2c3d';
    const s = track(await startAuthServer({ validToken: 'right-token-value', mcp: createGoodServer }));
    const r = await cli([s.url, '--bearer', TOKEN, '--fail-on', 'never', '--fail-on-incomplete', '--format', 'json'], { GITHUB_ACTIONS: 'true' });
    expect(r.code, r.stderr).toBe(3);
    const own = commands(r.stderr).filter((l) => l.startsWith(OWN_WARNING));
    expect(own, r.stderr).toHaveLength(1);
    expect(own[0]).toMatch(/Partial check: token-rejected \(token rejected \(401\)\); tool-level checks were skipped/);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it('the ::warning is printed without the flag too, and a run that passes stays exit 0', async () => {
    const s = track(await startAuthServer({}));
    const r = await cli([s.url, '--fail-on', 'never'], { GITHUB_ACTIONS: 'true' });
    expect(r.code, r.stderr).toBe(0);
    const own = commands(r.stderr).filter((l) => l.startsWith(OWN_WARNING));
    expect(own, r.stderr).toHaveLength(1);
    expect(own[0]).toMatch(/Partial check: auth-required \(server requires auth; pass --bearer <token>\)/);
    expect(own[0]).toMatch(/\d+ rules skipped/);
    expect(own[0]).toContain('--fail-on-incomplete');
  });

  it('a complete check is unaffected by the flag and gets no partial-check annotation', async () => {
    const r = await cli(['--stdio', GOOD, '--fail-on-incomplete', '--format', 'json'], { GITHUB_ACTIONS: 'true' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.coverage.toolLevel).toBe('ok');
    expect(commands(r.stderr).filter((l) => l.startsWith(OWN_WARNING))).toEqual([]);
  });

  it('annotations(): one ::warning for a partial snapshot, none for a complete one, none besides the ::error of a stop', () => {
    const report = (name: string, edit: (s: ReturnType<typeof loadSnapshot>) => void = () => {}) => {
      const s = loadSnapshot(name);
      edit(s);
      return buildReport(s, runRules(s, RULES), [], 'error', new Date('2026-11-01T10:00:00Z'), 1);
    };
    expect(annotations(report('auth-required')).filter((l) => l.startsWith(OWN_WARNING))).toHaveLength(1);
    expect(annotations(report('minimal-http')).filter((l) => l.startsWith(OWN_WARNING))).toEqual([]);
    const listFailed = annotations(report('minimal-http', (s) => { s.coverage = { toolLevel: 'list-failed', reason: 'tools/list failed: boom\n::error::x' }; }));
    const warn = listFailed.filter((l) => l.startsWith(OWN_WARNING));
    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain('boom%0A::error::x'); // server text cannot start a workflow command of its own
    const stopped = annotations(report('minimal-http', (s) => {
      s.coverage = { toolLevel: 'stopped', reason: 'stopped' };
      s.limits = { ...s.limits, truncated: s.limits?.truncated ?? [], stopped: { maxDurationMs: 1500, phase: 'listing' } };
    }));
    expect(stopped.filter((l) => l.startsWith(OWN_WARNING))).toEqual([]);
    expect(stopped.filter((l) => l.startsWith('::error title=mcp-review-check::Stopped by --max-duration'))).toHaveLength(1);
  });
});
