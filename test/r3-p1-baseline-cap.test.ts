// Review round 3, package P1 (1.0.1), A01-08: --save-baseline warns when the report is larger than --baseline reads
// (INPUT_FILE_CAP). The cap is mocked down to 4 KiB so the GOOD fixture's report is over it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';

vi.mock('../src/input-file.js', async (orig) => ({ ...(await orig<typeof import('../src/input-file.js')>()), INPUT_FILE_CAP: 4096 }));

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r3-p1-cap-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('A01-08: a baseline over the read cap is said at save time', () => {
  it('A01-08 --save-baseline over INPUT_FILE_CAP warns; --json-output alone does not', async () => {
    const r = await runCli(['--no-config', '--save-baseline', join(dir, 'b.json'), '--fail-on', 'never', '--stdio', '--', process.execPath, GOOD], {}, false);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/warning: --save-baseline: the report is \d+\.\d MiB, over the 0\.00390625 MiB that --baseline reads|warning: --save-baseline: the report is .* over the .* MiB that --baseline reads, so a later --baseline run cannot use it/);
    const j = await runCli(['--no-config', '--json-output', join(dir, 'j.json'), '--fail-on', 'never', '--stdio', '--', process.execPath, GOOD], {}, false);
    expect(j.stderr).not.toMatch(/over the .* MiB that --baseline reads/);
  });
});
