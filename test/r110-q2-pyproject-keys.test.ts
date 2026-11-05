// 1.1.0, package Q2 review fixes: pyprojectSetsUvSource reads quoted keys and inline tables.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { pyprojectSetsUvSource } from '../src/rules/listing.js';
const FIX = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));
const run = (args: string[]) => runCli(args, {}, false);
type F = { ruleId: string; severity: string; message: string; path?: string };
const findings = (stdout: string): F[] => JSON.parse(stdout).findings;

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r110q2-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('review Q2: quoted keys and inline tables in pyproject.toml', () => {
  it('the reviewer forms are uv package sources', () => {
    expect(pyprojectSetsUvSource('[tool.uv]\n"index-url" = "https://x"\n')).toBe(true);
    expect(pyprojectSetsUvSource('[tool]\nuv = { index-url = "https://x" }\n')).toBe(true);
    expect(pyprojectSetsUvSource('[tool.uv]\npip = { index-url = "x" }\n')).toBe(true);
  });

  it('other quoted and inline spellings are sources too', () => {
    expect(pyprojectSetsUvSource("[tool.uv]\n'extra-index-url' = ['https://x']\n")).toBe(true);
    expect(pyprojectSetsUvSource('[tool]\n"uv"."find-links" = ["https://x"]\n')).toBe(true);
    expect(pyprojectSetsUvSource('tool = { uv = { default-index = "https://x" } }\n')).toBe(true);
    expect(pyprojectSetsUvSource('[tool]\nuv = { dev-dependencies = ["pytest"], pip = { "extra-index-url" = ["https://x"] } }\n')).toBe(true);
    expect(pyprojectSetsUvSource('[tool]\nuv.pip = { find-links = ["https://x"] }\n')).toBe(true);
  });

  it('inline tables without a uv source, nested source tables and other tools stay clean', () => {
    expect(pyprojectSetsUvSource('[tool.uv]\nsources = { acme = { index = "corp" } }\n')).toBe(false);
    expect(pyprojectSetsUvSource('[tool.uv.sources]\nacme = { index = "corp" }\n')).toBe(false);
    expect(pyprojectSetsUvSource('[tool]\nuv = { dev-dependencies = ["index-url = x"] }\n')).toBe(false);
    expect(pyprojectSetsUvSource('[tool]\npdm = { index-url = "https://x" }\n')).toBe(false);
    expect(pyprojectSetsUvSource('[tool.pdm]\n"index-url" = "https://x"\n')).toBe(false);
    expect(pyprojectSetsUvSource('[project]\nname = "acme"\n"index-url" = "x"\n')).toBe(false);
    expect(pyprojectSetsUvSource('[tool.uv]\n# index-url = "https://x"\n')).toBe(false);
  });

  it('LST-009 fires on a quoted [tool.uv] "index-url" next to uv run --locked', async () => {
    const root = join(dir, 'quoted');
    cpSync(join(FIX, 'plugin-valid'), root, { recursive: true });
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'uv', args: ['run', '--locked', 'server.py'] } } }));
    writeFileSync(join(root, 'pyproject.toml'), '[tool.uv]\n"index-url" = "https://pypi.evil.test/simple"\n');
    const f = findings((await run(['--plugin-dir', root, '--target', 'claude', '--format', 'json'])).stdout);
    expect(f.filter((x) => x.ruleId === 'LST-009').map((x) => x.path)).toEqual(['pyproject.toml']);
  });
});
