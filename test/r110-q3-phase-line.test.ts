// 1.1.0 Q3 (deferred from 1.0.1): a TTY-only phase line on stderr while the check connects and probes. Not in CI, not
// when stderr is not a TTY, not with --quiet; cleared before the report; names no server or value.
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { phaseLine, phaseLineWanted, runCli } from '../src/cli.js';

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const SECRET = ['sk', 'live', 'SYNTHq3phase000000001'].join('_');

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('phaseLine', () => {
  it('draws the phase and the elapsed seconds, redraws every second, and clears the line when stopped', () => {
    vi.useFakeTimers();
    let t = 0;
    const out: string[] = [];
    const line = phaseLine(true, (x) => out.push(x), () => t);
    expect(out).toEqual(['\r\x1b[2Kmcp-review-check: connecting… 0 s']);
    t = 2400;
    line.phase('listing');
    expect(out.at(-1)).toBe('\r\x1b[2Kmcp-review-check: listing… 2 s');
    t = 3100;
    vi.advanceTimersByTime(1000);
    expect(out.at(-1)).toBe('\r\x1b[2Kmcp-review-check: listing… 3 s');
    line.stop();
    expect(out.at(-1)).toBe('\r\x1b[2K');
    const n = out.length;
    vi.advanceTimersByTime(5000);
    line.phase('wire probes');
    expect(out.length).toBe(n); // nothing after stop
  });

  it('disabled: writes nothing', () => {
    const out: string[] = [];
    const line = phaseLine(false, (x) => out.push(x));
    line.phase('listing'); line.clear(); line.stop();
    expect(out).toEqual([]);
  });

  it('wanted only on a TTY stderr outside CI', () => {
    expect(phaseLineWanted(true, {})).toBe(true);
    expect(phaseLineWanted(false, {})).toBe(false);
    expect(phaseLineWanted(true, { CI: 'true' })).toBe(false);
    expect(phaseLineWanted(true, { GITHUB_ACTIONS: 'true' })).toBe(false);
  });
});

describe('runCli shows the line on a TTY stderr only', () => {
  const written = () => {
    const out: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((x: string | Uint8Array) => { out.push(String(x)); return true; }) as typeof process.stderr.write);
    return out;
  };
  const args = ['--format', 'json', '--no-config', '--env', `API_KEY=${SECRET}`, '--stdio', `node "${GOOD}"`];

  it('with a TTY stderr: the line is drawn and cleared before the run returns, without the server or a secret', async () => {
    const out = written();
    const r = await runCli(args, {}, false, undefined, true);
    vi.restoreAllMocks();
    expect(r.code, r.stderr).not.toBe(2);
    expect(out[0]).toMatch(/^\r\x1b\[2Kmcp-review-check: connecting… \d+ s$/);
    expect(out.at(-1)).toBe('\r\x1b[2K');
    // The line follows the run's phases (connect.ts onPhase), not only "connecting" (review Q3-110 phase line).
    expect(out.some((x) => /mcp-review-check: listing… \d+ s$/.test(x)), out.join('|')).toBe(true);
    expect(out.some((x) => /mcp-review-check: wire probes… \d+ s$/.test(x))).toBe(true);
    expect(out.join('')).not.toContain(SECRET);
    expect(out.join('')).not.toContain('good-server');
    expect(r.stderr).not.toContain('\x1b[2K'); // the returned stderr (the report's) never carries the line
  });

  it('no line without a TTY, in CI, or with --quiet', async () => {
    for (const [env, tty, extra] of [[{}, false, []], [{ CI: '1' }, true, []], [{}, true, ['--quiet']]] as const) {
      const out = written();
      await runCli([...extra, ...args], env, false, undefined, tty);
      vi.restoreAllMocks();
      expect(out.join(''), JSON.stringify(env)).not.toContain('\x1b[2K');
    }
  });
});
