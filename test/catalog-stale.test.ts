// R-62: a check run warns on stderr when the rule catalog is more than 90 days old (black box: runCli only).
// The catalog date is read from the --help header, so the test does not depend on how the source stores it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const FAILING_SERVER = 'node -e "process.exit(1)"';

async function catalogDate(): Promise<string> {
  const help = await runCli(['--help'], {}, false);
  const m = /\(rules (\d{4}-\d{2}-\d{2})\)/.exec(help.stdout);
  expect(m, help.stdout.slice(0, 200)).not.toBeNull();
  return m![1];
}

/** Freeze Date (only Date: the stdio child and its timeouts keep real timers) at noon UTC, `days` after the catalog date. */
function clockAt(date: string, days: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000));
}

describe('stale rule catalog', () => {
  afterEach(() => vi.useRealTimers());

  it('R-62: a catalog older than 90 days warns on stderr; --help and --version do not', async () => {
    const date = await catalogDate();
    clockAt(date, 91);
    const r = await runCli(['--stdio', FAILING_SERVER, '--format', 'json', '--timeout', '5000'], {}, false);
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(new RegExp(`warning: the rule catalog is 91 days old \\(rules ${date}\\)`));
    expect((await runCli(['--version'], {}, false)).stderr).toBe('');
    expect((await runCli(['--help'], {}, false)).stderr).toBe('');

    vi.setSystemTime(new Date(Date.parse(`${date}T12:00:00Z`) + 90 * 86_400_000));
    const fresh = await runCli(['--stdio', FAILING_SERVER, '--format', 'json', '--timeout', '5000'], {}, false);
    expect(fresh.code).toBe(3);
    expect(fresh.stderr).not.toMatch(/rule catalog is/);
  });

  it('U-12: with a stale catalog stdout stays a single JSON or SARIF document', async () => {
    const date = await catalogDate();
    clockAt(date, 200);
    for (const format of ['json', 'sarif']) {
      const r = await runCli(['--stdio', FAILING_SERVER, '--format', format, '--timeout', '5000'], {}, false);
      expect(r.code).toBe(3);
      expect(() => JSON.parse(r.stdout), `${format} stdout`).not.toThrow();
      expect(r.stdout).not.toMatch(/rule catalog is/);
    }
  });
});
