// 1.0.1 integration: the review round 3 integrator notes that touch files outside the fix packages (src/cli.ts,
// src/rules/data.ts, src/report/index.ts, src/report/junit.ts).
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { startAuthServer } from './fixtures/auth-server.js';
import type { Started } from './fixtures/http-bridge.js';

let server: Started | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});

describe('A10-02: the stall notice reaches stderr during the run', () => {
  const HANG = fileURLToPath(new URL('./fixtures/hang-server.mjs', import.meta.url));
  it('is written to process.stderr once, before the run returns', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write);
    const r = await runCli(['--stdio', '--timeout', '4000', '--format', 'json', '--', process.execPath, HANG], {}, false);
    vi.restoreAllMocks();
    const stalls = writes.filter((w) => /stopped answering/.test(w));
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/^mcp-review-check: tools\/list got no answer within --timeout/);
    expect(stalls[0].endsWith('\n')).toBe(true);
    expect(r.stderr).not.toMatch(/stopped answering/); // not repeated at the end
  }, 90000);
});
