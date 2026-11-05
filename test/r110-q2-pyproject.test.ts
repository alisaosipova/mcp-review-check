// 1.1.0, package Q2: C-02 LST-009 and the pyproject.toml uv index.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const FIX = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));
const run = (args: string[]) => runCli(args, {}, false);
type F = { ruleId: string; severity: string; message: string; path?: string };
const findings = (stdout: string): F[] => JSON.parse(stdout).findings;

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r110q2-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A copy of plugin-valid whose local server runs `command args`, with extra files. */
function plugin(name: string, command: string, args: string[], files: Record<string, string | Buffer> = {}): string {
  const root = join(dir, name);
  cpSync(join(FIX, 'plugin-valid'), root, { recursive: true });
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'acme-local': { command, args } } }));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), body);
  }
  return root;
}
const lst = async (root: string, ...ids: string[]) =>
  findings((await run(['--plugin-dir', root, '--target', 'claude', '--format', 'json'])).stdout).filter((f) => ids.includes(f.ruleId));

describe('C-02 LST-009 reads the uv index in pyproject.toml', () => {
  it('[[tool.uv.index]] next to uv run is a package source', async () => {
    const root = plugin('uvidx', 'uv', ['run', '--locked', 'server.py'], { 'pyproject.toml': '[project]\nname = "acme"\n\n[[tool.uv.index]]\nname = "corp"\nurl = "https://pypi.evil.test/simple"\ndefault = true\n' });
    const f = await lst(root, 'LST-009');
    expect(f).toEqual([expect.objectContaining({ severity: 'error', path: 'pyproject.toml', message: expect.stringMatching(/^pyproject\.toml sets a package source/) })]);
  });

  it('[tool.uv] index-url, [tool.uv.pip] extra-index-url and a dotted key are package sources too', async () => {
    const bodies = [
      '[tool.uv]\nindex-url = "https://pypi.evil.test/simple"\n',
      '[tool.uv.pip]\nextra-index-url = ["https://pypi.evil.test/simple"]\n',
      '[tool.uv]\nindex = [{ name = "corp", url = "https://pypi.evil.test/simple" }]\n',
      'tool.uv.find-links = ["https://pypi.evil.test/links"]\n',
      '[tool]\nuv.index-url = "https://pypi.evil.test/simple"\n',
    ];
    for (const [i, body] of bodies.entries()) {
      const f = await lst(plugin(`uv${i}`, 'uvx', ['acme-mcp==1.0.0'], { 'server/pyproject.toml': body }), 'LST-009');
      expect(f.map((x) => x.path), body).toEqual(['server/pyproject.toml']);
    }
  });

  it('a pyproject.toml without a uv package source, or other tools\' index keys, is not reported', async () => {
    const bodies = [
      '[project]\nname = "acme"\ndependencies = ["httpx"]\n\n[tool.uv]\ndev-dependencies = ["pytest"]\n',
      '[tool.pdm]\nindex-url = "https://pypi.example.test/simple"\n[[tool.poetry.source]]\nname = "corp"\nurl = "https://pypi.example.test/simple"\n',
      '[tool.uv.sources]\nacme = { path = "../acme" }\n',
    ];
    for (const [i, body] of bodies.entries()) {
      expect(await lst(plugin(`clean${i}`, 'uv', ['run', '--locked', 'server.py'], { 'pyproject.toml': body }), 'LST-009'), body).toEqual([]);
    }
  });
});
