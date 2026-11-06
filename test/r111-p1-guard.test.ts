// Review round 4, package P1 (1.2.0), I-A07-1: one per-line guard over every stderr line but our own annotations.
// Three warning sources are made to carry a newline and a workflow command; no stderr line may start one, while the
// tool's own ::error / ::warning annotations, appended after the guard, still do.
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/catalog.js', async (orig) => ({
  ...(await orig<typeof import('../src/catalog.js')>()),
  staleCatalogWarning: () => 'warning: stale\n::warning title=One::forged by the catalog note\n',
}));
vi.mock('../src/report/text.js', async (orig) => ({
  ...(await orig<typeof import('../src/report/text.js')>()),
  localBanner: () => 'Local target\n::warning title=Two::forged by the banner\n##[warning]legacy',
}));
vi.mock('../src/report/drift.js', async (orig) => ({
  ...(await orig<typeof import('../src/report/drift.js')>()),
  incompleteTools: () => 'partial\r\n::warning title=Three::forged by the save-baseline note',
}));

const { runCli } = await import('../src/cli.js');
const BAD = fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mrc-r111-p1g-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('I-A07-1: one stderr guard', () => {
  it('I-A07-1 three injected warnings start no workflow command; our annotations still do, last', async () => {
    const r = await runCli(['--no-config', '--format', 'json', '--fail-on', 'never', '--save-baseline', join(dir, 'b.json'), '--stdio', '--', process.execPath, BAD], { GITHUB_ACTIONS: 'true' }, false);
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stderr.split('\n');
    // The forged text is there, shown, but none of it starts a command.
    for (const n of ['One', 'Two', 'Three']) expect(r.stderr).toContain(`title=${n}::forged`);
    expect(lines.filter((l) => /forged|legacy/.test(l) && (/^\s*::/.test(l) || l.includes('##[')))).toEqual([]);
    expect(r.stderr).not.toMatch(/\r/);
    // Our own annotations: present, at the end, untouched.
    const ours = lines.filter((l) => /^::(error|warning|notice) /.test(l));
    expect(ours.length).toBeGreaterThan(0);
    const firstOurs = lines.findIndex((l) => /^::(error|warning|notice) /.test(l));
    expect(lines.slice(firstOurs).filter((l) => l !== '').every((l) => /^::(error|warning|notice) /.test(l))).toBe(true);
  });
});
