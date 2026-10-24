// R-60: when --max-duration runs out, the stdio servers the check started end before the CLI exits —
// also one that ignores stdin EOF or SIGTERM, before or after the handshake, and a fresh-connection child;
// a server slow to exit does not let the abandoned run pass for a finished one.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cli } from './cli-runner.js';

const STUBBORN = fileURLToPath(new URL('./fixtures/stubborn-server.mjs', import.meta.url));
const dirs: string[] = [];

function pidsOf(pidFile: string): number[] {
  try { return readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number); } catch { return []; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Run the CLI against stubborn-server.mjs; the pid file lists every server process the run started. */
async function run(flags: string[], args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'mrc-stubborn-'));
  dirs.push(dir);
  const pidFile = join(dir, 'pids');
  const r = await cli(['--stdio', `node "${STUBBORN}" "${pidFile}" ${flags.join(' ')}`, '--format', 'json', '--timeout', '20000', ...args]);
  return { r, pids: pidsOf(pidFile) };
}

afterEach(() => {
  // Whatever the outcome, no server process outlives the test.
  for (const dir of dirs.splice(0)) {
    for (const pid of pidsOf(join(dir, 'pids'))) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('--max-duration ends the stdio servers it started (R-60)', () => {
  it('after the handshake: a server that ignores stdin EOF is gone when the CLI exits', async () => {
    const { r, pids } = await run([], ['--max-duration', '1500']);
    expect(r.json?.limits?.stopped, r.stderr).toMatchObject({ maxDurationMs: 1500, phase: 'listing' });
    expect(pids).toHaveLength(1);
    expect(pids.filter(alive)).toEqual([]);
  });

  it('before the handshake: exit 3 and the silent server is gone', async () => {
    const { r, pids } = await run(['--mute'], ['--max-duration', '1500']);
    expect(r.code, r.stderr).toBe(3);
    expect(r.json?.limits?.stopped).toMatchObject({ maxDurationMs: 1500, phase: 'connect' });
    expect(pids).toHaveLength(1);
    expect(pids.filter(alive)).toEqual([]);
  });

  it('a server that also ignores SIGTERM is killed', async () => {
    const t0 = Date.now();
    const { r, pids } = await run(['--ignore-term'], ['--max-duration', '1500']);
    expect(r.json?.limits?.stopped, r.stderr).toMatchObject({ maxDurationMs: 1500, phase: 'listing' });
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(pids).toHaveLength(1);
    expect(pids.filter(alive)).toEqual([]);
  });

  it('the child of a fresh connection (tools re-list) is ended as well as the main one', async () => {
    const { r, pids } = await run(['--hang-fresh', '--ignore-term'], ['--max-duration', '4000']);
    expect(r.json?.limits?.stopped, r.stderr).toMatchObject({ maxDurationMs: 4000, phase: 'tools re-list' });
    expect(pids).toHaveLength(2);
    expect(pids.filter(alive)).toEqual([]);
  });

  it('stopped during active tool calls: a server slow to exit on SIGTERM leaves the run INCOMPLETE, not finished with "Not connected"', async () => {
    const { r, pids } = await run(['--slow-active'], ['--active', '--max-duration', '4000']);
    expect(r.json?.limits?.stopped, r.stderr).toMatchObject({ maxDurationMs: 4000, phase: 'active tool calls' });
    expect(r.json.coverage.toolLevel).toBe('stopped');
    expect(r.json.findings.filter((f: any) => f.ruleId === 'RT-005')).toEqual([]);
    expect(Object.values(r.json.summary.verdicts).map((v: any) => v.verdict)).toEqual(['INCOMPLETE', 'INCOMPLETE']);
    expect(pids.length).toBeGreaterThan(0);
    expect(pids.filter(alive)).toEqual([]);
  });
});
