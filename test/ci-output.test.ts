// GitHub Actions mode, FORCE_COLOR, the Evidence column and the redacted rerun line in markdown,
// and a clean stdout for json and sarif in GitHub Actions with a stale catalog.
// Black box: the built CLI (cli) and runCli with env and isTty passed in; the step summary is a temporary file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { BAD, cli } from './cli-runner.js';

const ANSI = /\x1b\[\d+m/;
const SECRET = 'ci-argv-secret-7f3a9c';
const ENV_SECRET = 'ci-env-secret-5b81d2';
/** The workflow-command lines of stderr. */
const commands = (stderr: string) => stderr.split('\n').filter((l) => l.startsWith('::'));

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-ci-')); });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

describe('GitHub Actions mode', () => {
  it('GITHUB_ACTIONS=true prints ::error/::warning on stderr and appends to $GITHUB_STEP_SUMMARY; untouched without it', async () => {
    const summary = join(dir, 'summary.md');
    writeFileSync(summary, 'previous step\n');
    const args = ['--stdio', BAD, '--target', 'claude', '--env', `API_TOKEN=${ENV_SECRET}`];
    const r = await cli(args, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    expect(r.code, r.stderr).toBe(1);
    const ann = commands(r.stderr);
    expect(ann.find((l) => l.startsWith('::error title=TOOL-011 update_settings::')), r.stderr).toBeDefined();
    // Severity at the --target platforms, as for the exit code: TOOL-013 is a ChatGPT error but a Claude warning.
    expect(ann.find((l) => l.startsWith('::warning title=TOOL-013 archive_items::'))).toBeDefined();
    expect(ann.filter((l) => /title=(TOOL-012|SRV-018|TOOL-027) /.test(l))).toEqual([]); // ChatGPT-only, spec-only, info
    // Escaping: ":" and "," in a property, "%", CR and LF in the message; one line per annotation.
    expect(ann.find((l) => l.startsWith('::error title=APPS-003 ui%3A//bad/widget.html::'))).toBeDefined();
    for (const l of ann) {
      const m = /^::(error|warning) title=([^:]*)::(.*)$/.exec(l);
      expect(m, l).not.toBeNull();
      expect(m![2]).not.toMatch(/[,\r]/);
      expect(m![3]).toContain('%0AFix: ');
      expect(m![3]).not.toMatch(/\r/);
    }
    expect(r.stdout).not.toMatch(/^::/m);
    expect(r.stdout + r.stderr).not.toContain(ENV_SECRET);

    const md = readFileSync(summary, 'utf8');
    expect(md.startsWith('previous step\n')).toBe(true);
    expect(md).toContain('| Result | FAIL (--fail-on error)');
    expect(md).toContain('## Errors (');
    expect(md).toContain('rerun: npx mcp-review-check');
    expect(md).not.toContain(ENV_SECRET);

    const spec = await cli([...args, '--fail-on-spec'], { GITHUB_ACTIONS: 'true' });
    expect(commands(spec.stderr).find((l) => l.startsWith('::error title=SRV-018 server::'))).toBeDefined();

    const untouched = join(dir, 'untouched.md');
    writeFileSync(untouched, '');
    const off = await cli(args, { GITHUB_STEP_SUMMARY: untouched });
    expect(off.code).toBe(1);
    expect(commands(off.stderr)).toEqual([]);
    expect(readFileSync(untouched, 'utf8')).toBe('');
  });

  it('with GITHUB_ACTIONS=true and a stale catalog, stdout with --format json and sarif is one JSON document', async () => {
    const date = /\(rules (\d{4}-\d{2}-\d{2})\)/.exec((await runCli(['--help'], {}, false)).stdout)![1];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(`${date}T12:00:00Z`) + 200 * 86_400_000));
    for (const format of ['json', 'sarif']) {
      const r = await runCli(['--stdio', BAD, '--format', format], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: join(dir, 'summary.md') }, false);
      expect(r.code, r.stderr).toBe(1);
      expect(() => JSON.parse(r.stdout), `${format} stdout`).not.toThrow();
      expect(r.stderr).toMatch(/rule catalog is 200 days old/);
      expect(commands(r.stderr).length, `${format} annotations`).toBeGreaterThan(0);
      expect(r.stdout).not.toMatch(/::(error|warning) /);
    }
  });
});

describe('FORCE_COLOR', () => {
  it('FORCE_COLOR colours text without a TTY', async () => {
    const plain = await runCli(['--stdio', BAD], {}, false);
    expect(plain.stdout).toContain('ERRORS (');
    expect(plain.stdout).not.toMatch(ANSI);

    const forced = await runCli(['--stdio', BAD], { FORCE_COLOR: '1' }, false);
    expect(forced.stdout).toMatch(ANSI);
    // Built CLI with NO_COLOR=1 from the runner: FORCE_COLOR wins, as in Node.
    expect((await cli(['--stdio', BAD], { FORCE_COLOR: '1' })).stdout).toMatch(ANSI);

    expect((await runCli(['--stdio', BAD, '--no-color'], { FORCE_COLOR: '1' }, false)).stdout).not.toMatch(ANSI);
    expect((await runCli(['--stdio', BAD], { FORCE_COLOR: '0' }, true)).stdout).not.toMatch(ANSI);
    const json = await runCli(['--stdio', BAD, '--format', 'json'], { FORCE_COLOR: '1' }, false);
    expect(json.stdout).not.toMatch(ANSI);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
  });
});

describe('markdown evidence and rerun', () => {
  it('markdown has an Evidence column and a redacted «rerun: npx mcp-review-check …» line', async () => {
    const args = ['--format', 'markdown', '--env', `API_TOKEN=${ENV_SECRET}`, '--stdio', `${BAD} --api-key=${SECRET}`];
    const r = await runCli(args, {}, false);
    expect(r.stdout).toContain('| Rule | Platforms | Subject | Message | Fix | Docs | Evidence |');
    const row = r.stdout.split('\n').find((l) => l.startsWith('| INJ-005 '));
    expect(row, r.stdout.slice(0, 2000)).toMatch(/\| `` Ignore previous instructions `` \|$/);

    const rerun = r.stdout.split('\n').filter((l) => l.includes('rerun: npx mcp-review-check'));
    expect(rerun).toHaveLength(1);
    expect(rerun[0]).toContain('--format markdown');
    expect(rerun[0]).toContain('API_TOKEN=«redacted»');
    expect(rerun[0]).toContain('--api-key=«redacted»');
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stdout).not.toContain(ENV_SECRET);
    expect(r.code, r.stderr).toBe(1);
  });
});
