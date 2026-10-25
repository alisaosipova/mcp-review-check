// A stdio server started through a wrapper (npx, .cmd, .bat, sh -c) is ended with everything the
// wrapper started. On Linux and macOS the server runs as the leader of its own process group and the CLI ends the
// group; on Windows the CLI ends the tree with `taskkill /PID <pid> /T /F` before it kills the wrapper. The group
// no longer gets the terminal's Ctrl+C, so the CLI ends it on SIGINT, SIGTERM and SIGHUP and then dies by that signal.
// POSIX: black box, the built CLI with `sh -c 'node stubborn-server.mjs …; :'` (`; :` keeps sh from exec'ing node, so
// the server is the wrapper's child). Windows: no machine here, so runCli in process with process.platform set
// to 'win32' after the modules have loaded and spawnSync of node:child_process mocked.
import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/** Start the built CLI, send it `signal` once `after` servers have started (`twice`: again 300 ms later), and resolve with
 *  how the CLI ended; `at` gets the time of the last signal and of the exit. */
function signalled(args: string[], pids: string, signal: NodeJS.Signals, twice = false, after = 1, at: { signal?: number; exit?: number } = {}): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    // In the pid file's directory: a CLI that dies by SIGQUIT may leave a core file in its working directory.
    const child = spawn(process.execPath, [CLI, ...args], { cwd: dirname(pids), stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code, sig) => { at.exit = Date.now(); resolve({ code, signal: sig }); });
    const send = () => { child.kill(signal); at.signal = Date.now(); };
    const t0 = Date.now();
    const poll = setInterval(() => {
      if (pidsOf(pids).length >= after || Date.now() - t0 > 15000) {
        clearInterval(poll);
        setTimeout(() => { send(); if (twice) setTimeout(send, 300); }, 500); // the handshake is done, listing hangs
      }
    }, 50);
  });
}

/** Processes, with their parent pid, whose command line names this pid file: every server the run started, recorded or not. */
const serversOf = (pids: string) => execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes(pids) && !l.includes(CLI));

describe.skipIf(process.platform === 'win32')('a server behind a sh -c wrapper is ended with its wrapper', () => {
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

  it.each(['SIGTERM', 'SIGINT', 'SIGQUIT'] as const)('%s to the CLI during the check: the server is gone and the CLI dies by that signal', async (signal) => {
    const pids = pidFile();
    const r = await signalled(['--format', 'json', '--timeout', '20000', ...wrapped(pids)], pids, signal);
    expect(pidsOf(pids)).toHaveLength(1);
    expect(pidsOf(pids).filter(alive)).toEqual([]);
    expect(r).toEqual({ code: null, signal });
  });

  // A second Ctrl+C while the first one waits for a server that ignores SIGTERM killed the CLI
  // at once, and the server, out of the terminal's reach in its own group, outlived it with ppid 1.
  it('two SIGINTs 300 ms apart: the second one SIGKILLs the group of a server that ignores SIGTERM', async () => {
    const pids = pidFile();
    const r = await signalled(['--format', 'json', '--timeout', '20000', ...wrapped(pids, '--ignore-term')], pids, 'SIGINT', true);
    expect(pidsOf(pids)).toHaveLength(1);
    expect(pidsOf(pids).filter(alive)).toEqual([]);
    expect(r).toEqual({ code: null, signal: 'SIGINT' });
  });

  it('a second SIGINT ends the CLI within 500 ms, without waiting for a server that ignores SIGTERM', async () => {
    const pids = pidFile();
    const at: { signal?: number; exit?: number } = {};
    const r = await signalled(['--format', 'json', '--timeout', '20000', ...wrapped(pids, '--ignore-term')], pids, 'SIGINT', true, 1, at);
    expect(r).toEqual({ code: null, signal: 'SIGINT' });
    expect(at.exit! - at.signal!).toBeLessThan(500);
    expect(pidsOf(pids).filter(alive)).toEqual([]);
  });

  // After SIGINT the check went on and, once the SIGKILL round had passed, started a fresh
  // connection (the --active client-name re-list); that server, in its own group and deaf to EOF, outlived the CLI with ppid 1.
  it('SIGINT while a fresh connection waits on servers that ignore SIGTERM: no server, started before or after the signal, outlives the CLI', async () => {
    const pids = pidFile();
    const r = await signalled(['--format', 'json', '--active', '--timeout', '20000', '--stdio', `node "${STUBBORN}" "${pids}" --mute-fresh --ignore-term`], pids, 'SIGINT', false, 2);
    expect(r).toEqual({ code: null, signal: 'SIGINT' });
    await new Promise((done) => setTimeout(done, 300)); // a server killed at the exit is reaped
    expect(serversOf(pids)).toEqual([]);
    expect(pidsOf(pids).filter(alive)).toEqual([]);
  });
});

// Signal exit on Windows (process.platform emulated by a preload): a process cannot die by a POSIX signal there (Node's
// process.kill of itself would end it with exit 1, the threshold code, and throws for SIGHUP), so the CLI exits with
// 128 + the signal number instead.
describe.skipIf(process.platform === 'win32')('signal exit on Windows (process.platform emulated)', () => {
  it('SIGINT during the check exits 130 without the CLI signalling itself', async () => {
    const dir = dirname(pidFile());
    const killLog = join(dir, 'kills');
    let hit!: () => void;
    const reached = new Promise<void>((done) => { hit = done; });
    const server = createServer(() => hit()); // never answers: the check waits on its first request
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
      const preload = pathToFileURL(fileURLToPath(new URL('./fixtures/win32-preload.mjs', import.meta.url))).href;
      const child = spawn(process.execPath, ['--import', preload, CLI, url, '--format', 'json', '--timeout', '20000'], { cwd: dir, stdio: 'ignore', env: { ...process.env, MRC_KILL_LOG: killLog } });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => child.once('exit', (code, signal) => done({ code, signal })));
      await reached;
      child.kill('SIGINT');
      expect(await exited).toEqual({ code: 130, signal: null });
      const selfKills = (() => { try { return readFileSync(killLog, 'utf8').split('\n').filter(Boolean); } catch { return []; } })();
      expect(selfKills, 'process.kill(process.pid, …)').toEqual([]);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

describe('process tree on Windows (process.platform emulated): the tree is ended before the wrapper', () => {
  /** runCli as on win32 with the stubborn server (`flags` after the server); taskkill /T must come before the first kill of its pid. */
  async function taskkillFirst(flags: string[]): Promise<void> {
    const pids = pidFile();
    const kill = vi.spyOn(ChildProcess.prototype, 'kill');
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await runCli(['--stdio', `node "${STUBBORN}" "${pids}"`, '--format', 'json', ...flags], {}, false);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
    const [pid] = pidsOf(pids);
    const taskkill = vi.mocked(spawnSync).mock.calls.findIndex(([cmd, args]) => cmd === 'taskkill' && JSON.stringify(args) === JSON.stringify(['/PID', String(pid), '/T', '/F']));
    expect(vi.mocked(spawnSync).mock.calls, `taskkill for ${pid}`).toContainEqual(['taskkill', ['/PID', String(pid), '/T', '/F'], expect.anything()]);
    const firstKill = kill.mock.contexts.findIndex((c) => (c as ChildProcess).pid === pid);
    expect(firstKill, 'the wrapper is killed after taskkill').toBeGreaterThanOrEqual(0);
    expect(vi.mocked(spawnSync).mock.invocationCallOrder[taskkill]).toBeLessThan(kill.mock.invocationCallOrder[firstKill]);
  }

  it('taskkill /PID <pid> /T /F runs before the wrapper is killed at --max-duration', async () => {
    await taskkillFirst(['--timeout', '20000', '--max-duration', '1500']);
  });

  it('without a deadline, the normal close of a server that ignores EOF runs taskkill /PID <pid> /T /F before it kills the wrapper', async () => {
    vi.mocked(spawnSync).mockClear(); // the call order is per pid, but the earlier run's calls are no evidence for this one
    await taskkillFirst(['--timeout', '1500']);
  });
});
