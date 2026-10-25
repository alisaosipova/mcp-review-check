// R-60: when --max-duration runs out, the stdio servers the check started end before the CLI exits —
// also one that ignores stdin EOF or SIGTERM, before or after the handshake, and a fresh-connection child;
// a server slow to exit does not let the abandoned run pass for a finished one.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { cli } from './cli-runner.js';

const STUBBORN = fileURLToPath(new URL('./fixtures/stubborn-server.mjs', import.meta.url));
const THROWER = fileURLToPath(new URL('./fixtures/throw-server.mjs', import.meta.url));
const dirs: string[] = [];

function pidsOf(pidFile: string): number[] {
  try { return readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number); } catch { return []; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Run the CLI against stubborn-server.mjs; the pid file lists every server process the run started. */
async function run(flags: string[], args: string[], server = STUBBORN) {
  const dir = mkdtempSync(join(tmpdir(), 'mrc-stubborn-'));
  dirs.push(dir);
  const pidFile = join(dir, 'pids');
  const r = await cli(['--stdio', `node "${server}" "${pidFile}" ${flags.join(' ')}`, '--format', 'json', '--timeout', '20000', ...args]);
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

// R-4: a server that never answers initialize is left to the SDK's `void close()` (EOF, then SIGTERM after 2 s),
// which the CLI exit cuts short; without --max-duration the check ends every child itself before returning.
describe('R-4: no stdio server outlives the CLI', () => {
  it('main connection: a server that never answers initialize and ignores EOF is gone', async () => {
    const { r, pids } = await run(['--mute'], ['--timeout', '1500']);
    expect(r.code, r.stderr).toBe(3);
    expect(r.json?.coverage?.toolLevel).toBe('connect-failed');
    expect(pids).toHaveLength(1);
    expect(pids.filter(alive)).toEqual([]);
  });

  it('fresh connection: a re-list child that never answers initialize is gone', async () => {
    const { r, pids } = await run(['--mute-fresh'], ['--timeout', '1500']);
    expect(r.json?.coverage?.toolLevel, r.stderr).toBe('ok');
    expect(r.json?.limits?.stopped).toBeUndefined();
    expect(pids).toHaveLength(2);
    expect(pids.filter(alive)).toEqual([]);
  });

  // MRC-2 review round 1: an exception in the check after the handshake (here a tool name that cannot become a
  // string) skipped the cleanup, and a server that ignores EOF outlived the CLI with ppid 1.
  it.each([[[] as string[]], [['--max-duration', '20000']]])('the check throws after the handshake (%j): exit 3 and the server is gone', async (args) => {
    const { r, pids } = await run([], ['--timeout', '5000', ...args], THROWER);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toMatch(/^fatal: TypeError/m);
    expect(pids).toHaveLength(1);
    expect(pids.filter(alive)).toEqual([]);
  });

  // MRC-2 review round 1 tail: the client of a check that throws after the handshake is closed (stdin EOF, then the
  // server's group), not only its process killed by the cleanup; no test caught the close's removal.
  it('runCli in process: the check throws after the handshake and its stdio client is closed (progress.close)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mrc-stubborn-'));
    dirs.push(dir);
    const pidFile = join(dir, 'pids');
    const close = vi.spyOn(StdioClientTransport.prototype, 'close');
    try {
      const r = await runCli(['--stdio', `node "${THROWER}" "${pidFile}"`, '--format', 'json', '--timeout', '5000'], {});
      expect(r.code, r.stderr).toBe(3);
      expect(r.stderr).toMatch(/^fatal: TypeError/m);
      expect(close).toHaveBeenCalledTimes(1);
      expect(pidsOf(pidFile).filter(alive)).toEqual([]);
    } finally {
      close.mockRestore();
    }
  }, 30000);
});
