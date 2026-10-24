// R-7 (MRC-2): the CLI exits only after stdout and stderr are fully written. A pipe is asynchronous, so a
// process.exit() that waits for stdout alone cut stderr at the pipe buffer (64 KB): annotations and the --output
// summary line were lost (CRIT-6). Black box: the built CLI through spawn, with the parent's stderr reader paused
// until the CLI has written its report, so the pipe buffer fills up whatever the machine speed.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI, ROOT } from './cli-runner.js';

const MANY = `node ${fileURLToPath(new URL('./fixtures/many-tools-server.mjs', import.meta.url))}`;
/** The CI switches a run inherits from a GitHub Actions job (as in cli-runner.ts). */
const CI_ENV = ['GITHUB_ACTIONS', 'GITHUB_STEP_SUMMARY', 'FORCE_COLOR'];

interface SlowRun { code: number | null; stdout: string; stderr: string }

/**
 * Runs the CLI with stderr as a pipe that nobody reads until the --output file exists and one more second has
 * passed (or the CLI has exited): the CLI writes more than the pipe buffer holds while the reader is paused.
 */
function runWithPausedStderr(args: string[], out: string, env: Record<string, string>): Promise<SlowRun> {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !CI_ENV.includes(k)));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...base, NO_COLOR: '1', ...env } });
    child.stderr.pause();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdout.push(c));
    child.stderr.on('data', (c: Buffer) => stderr.push(c));
    let resumeTimer: NodeJS.Timeout | undefined;
    const resume = () => { clearInterval(poll); clearTimeout(resumeTimer); child.stderr.resume(); };
    const poll = setInterval(() => { if (existsSync(out) && !resumeTimer) resumeTimer = setTimeout(resume, 1000); }, 50);
    const kill = setTimeout(() => child.kill('SIGKILL'), 80000);
    child.on('exit', resume);
    child.on('error', (e) => { resume(); clearTimeout(kill); reject(e); });
    child.on('close', (code) => {
      clearTimeout(kill);
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-flush-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('R-7: the CLI exits after stdout and stderr are written', () => {
  it('R-7: every annotation and the --output summary line reach stderr through a pipe', async () => {
    const out = join(dir, 'report.json');
    const r = await runWithPausedStderr(['--stdio', MANY, '--format', 'json', '--output', out], out, { GITHUB_ACTIONS: 'true' });
    expect(r.code, r.stderr.slice(-500)).toBe(1);
    expect(r.stdout).toBe('');
    const report = JSON.parse(readFileSync(out, 'utf8'));
    // One annotation per finding that is an error or a warning on a gated platform (annotations() in report/github.ts).
    const gated: string[] = report.summary.gate.platforms;
    const expected = report.findings.filter((f: any) =>
      gated.some((p) => f.platforms.includes(p) && (f.severityByPlatform?.[p] ?? f.severity) !== 'info')).length;
    expect(expected).toBeGreaterThan(1000); // more than 64 KB of annotations
    expect(Buffer.byteLength(r.stderr)).toBeGreaterThan(64 * 1024);
    const lines = r.stderr.split('\n');
    expect(lines.filter((l) => /^::(error|warning) title=/.test(l)).length).toBe(expected);
    expect(lines[lines.length - 1]).toBe('');
    expect(lines[lines.length - 2]).toMatch(/^mcp-review-check: score .* report written to /);
  }, 90000);
});
