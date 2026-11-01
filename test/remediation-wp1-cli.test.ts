// Regression tests for the WP1-cli remediation (review 2026-11-01): CLI argument validation, explain and
// --list-rules output, the summary line, the entry-point check and signal handling. In process through runCli
// where the run needs no real process, the built CLI (cli()) where the process itself is under test.
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const URL_ = 'http://127.0.0.1:1/mcp';
const usage = async (args: string[], env: NodeJS.ProcessEnv = {}) => runCli(args, env, false);

describe('--header names (F002)', () => {
  it('a name that is not an HTTP token is a usage error (exit 2), not a connect failure, and the value is not shown', async () => {
    for (const h of ['bad name: SECRETVALUE', 'X(y): SECRETVALUE', 'Ünï: SECRETVALUE']) {
      const r = await usage([URL_, '--header', h]);
      expect(r.code, h).toBe(2);
      expect(r.stderr, h).toContain('--header name must be an HTTP token');
      expect(r.stderr, h).not.toContain('SECRETVALUE');
    }
  });
});

describe('--timeout and --max-duration take whole milliseconds only (F015)', () => {
  it.each(['0x10', '1e2', '1.5', ' 100', '100 ', '+100', ''])('%j is a usage error', async (v) => {
    for (const flag of ['--timeout', '--max-duration']) {
      const r = await usage([URL_, `${flag}=${v}`]);
      expect(r.code, `${flag} ${v}`).toBe(2);
      expect(r.stderr).toContain(`${flag} must be a positive whole number of milliseconds`);
    }
  });
});
