// R-5 (MRC-2): a stdio server started through a wrapper (npx, .cmd, .bat, sh -c) is ended with everything the
// wrapper started. On Linux and macOS the server runs as the leader of its own process group and the CLI ends the
// group; on Windows the CLI ends the tree with `taskkill /PID <pid> /T /F` before it kills the wrapper. The group
// no longer gets the terminal's Ctrl+C, so the CLI ends it on SIGINT, SIGTERM and SIGHUP and then dies by that signal.
// POSIX: black box, the built CLI with `sh -c 'node stubborn-server.mjs …; :'` (`; :` keeps sh from exec'ing node, so
// the server is the wrapper's child). Windows: no machine here (NG-2), so runCli in process with process.platform set
// to 'win32' after the modules have loaded and spawnSync of node:child_process mocked (exception named in tasks.md).
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { cli, CLI, ROOT } from './cli-runner.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>();
  // Only the emulated Windows run reaches it: taskkill does not exist here, and nothing must be ended for real.
  const spawnSync = vi.fn(() => ({ pid: 0, status: 0, signal: null, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }));
  return { ...actual, default: { ...actual, spawnSync }, spawnSync };
});

const STUBBORN = fileURLToPath(new URL('./fixtures/stubborn-server.mjs', import.meta.url));
const dirs: string[] = [];

function pidsOf(pidFile: string): number[] {
  try { return readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number); } catch { return []; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function pidFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mrc-tree-'));
  dirs.push(dir);
  return join(dir, 'pids');
}

/** The stubborn server (ignores stdin EOF) behind a shell that stays its parent, as cmd.exe does for npx on Windows. */
const wrapped = (pids: string, flags = '') => ['--stdio', '--', 'sh', '-c', `node "${STUBBORN}" "${pids}" ${flags}; :`];

afterEach(() => {
  vi.restoreAllMocks(); // the ChildProcess.prototype.kill spy
  // Whatever the outcome, no server process outlives the test.
  for (const dir of dirs.splice(0)) {
    for (const pid of pidsOf(join(dir, 'pids'))) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Start the built CLI, send it `signal` once the server has started, and resolve with how the CLI ended. */
function signalled(args: string[], pids: string, signal: NodeJS.Signals): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code, sig) => resolve({ code, signal: sig }));
    const t0 = Date.now();
    const poll = setInterval(() => {
      if (pidsOf(pids).length || Date.now() - t0 > 15000) {
        clearInterval(poll);
        setTimeout(() => child.kill(signal), 500); // the handshake is done, listing hangs
      }
    }, 50);
  });
}

describe.skipIf(process.platform === 'win32')('R-5: a server behind a sh -c wrapper is ended with its wrapper', () => {
  it('(a) --max-duration: the server under the wrapper is gone when the CLI exits', async () => {
    const pids = pidFile();
    const r = await cli(['--format', 'json', '--timeout', '20000', '--max-duration', '1500', ...wrapped(pids)]);
    expect(r.json?.limits?.stopped, r.stderr).toMatchObject({ maxDurationMs: 1500, phase: 'listing' });
    expect(pidsOf(pids)).toHaveLength(1);
    expect(pidsOf(pids).filter(alive)).toEqual([]);
  });

  it('(b) no deadline: servers that ignore EOF under the wrapper are gone after the normal close, a fresh connection\'s too', async () => {
    const pids = pidFile();
    const r = await cli(['--format', 'json', '--timeout', '1500', ...wrapped(pids, '--hang-fresh')]);
    expect(r.json?.coverage?.toolLevel, r.stderr).toBe('ok');
    expect(r.json?.limits?.stopped).toBeUndefined();
    expect(pidsOf(pids)).toHaveLength(2);
    expect(pidsOf(pids).filter(alive)).toEqual([]);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)('%s to the CLI during the check: the server is gone and the CLI dies by that signal', async (signal) => {
    const pids = pidFile();
    const r = await signalled(['--format', 'json', '--timeout', '20000', ...wrapped(pids)], pids, signal);
    expect(pidsOf(pids)).toHaveLength(1);
    expect(pidsOf(pids).filter(alive)).toEqual([]);
    expect(r).toEqual({ code: null, signal });
  });
});

describe('R-5 on Windows (process.platform emulated): the tree is ended before the wrapper', () => {
  it('taskkill /PID <pid> /T /F runs before the wrapper is killed at --max-duration', async () => {
    const pids = pidFile();
    const kill = vi.spyOn(ChildProcess.prototype, 'kill');
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await runCli(['--stdio', `node "${STUBBORN}" "${pids}"`, '--format', 'json', '--timeout', '20000', '--max-duration', '1500'], {}, false);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
    const [pid] = pidsOf(pids);
    const taskkill = vi.mocked(spawnSync).mock.calls.findIndex(([cmd, args]) => cmd === 'taskkill' && JSON.stringify(args) === JSON.stringify(['/PID', String(pid), '/T', '/F']));
    expect(vi.mocked(spawnSync).mock.calls, `taskkill for ${pid}`).toContainEqual(['taskkill', ['/PID', String(pid), '/T', '/F'], expect.anything()]);
    const firstKill = kill.mock.contexts.findIndex((c) => (c as ChildProcess).pid === pid);
    expect(firstKill, 'the wrapper is killed after taskkill').toBeGreaterThanOrEqual(0);
    expect(vi.mocked(spawnSync).mock.invocationCallOrder[taskkill]).toBeLessThan(kill.mock.invocationCallOrder[firstKill]);
  });
});
