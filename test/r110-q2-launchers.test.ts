// 1.1.0, package Q2: C-01 LST-008/LST-009 launcher forms.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { launcherOf, unwrapArgv } from '../src/rules/listing.js';
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

describe('C-01 launcherOf recognises the other spellings of the launchers', () => {
  it('npm exec, npm x, pnpx, bun x and uv tool run are the same launchers as npx, pnpm dlx, bunx and uvx', () => {
    expect(launcherOf(['npm', 'exec', '--yes', '@acme/notes-mcp'])).toEqual({ launcher: 'npm exec', kind: 'npx', spec: '@acme/notes-mcp', pinned: false });
    expect(launcherOf(['npm', 'x', '--yes', '@acme/notes-mcp@1.4.2'])).toMatchObject({ launcher: 'npm x', kind: 'npx', pinned: true });
    expect(launcherOf(['npm.cmd', 'exec', '--package=@acme/notes-mcp@1.4.2', 'notes'])).toMatchObject({ kind: 'npx', pinned: true });
    expect(launcherOf(['pnpx', 'notes-mcp'])).toMatchObject({ launcher: 'pnpx', kind: 'pnpm dlx', pinned: false });
    expect(launcherOf(['bun', 'x', 'notes-mcp@2.0.0'])).toMatchObject({ launcher: 'bun x', kind: 'bunx', pinned: true });
    expect(launcherOf(['uv', 'tool', 'run', 'acme-mcp'])).toMatchObject({ launcher: 'uv tool run', kind: 'uvx', spec: 'acme-mcp', pinned: false });
    expect(launcherOf(['uv', 'tool', 'run', '--from', 'acme-mcp==1.2.3', 'acme'])).toMatchObject({ kind: 'uvx', pinned: true });
    // npm install / npm run / bun run are not launchers.
    expect(launcherOf(['npm', 'run', 'start'])).toBeUndefined();
    expect(launcherOf(['bun', 'run', 'server.ts'])).toBeUndefined();
    expect(launcherOf(['uv', 'tool', 'install', 'acme-mcp'])).toBeUndefined();
  });

  it('env, cmd /c and sh -c in front of the launcher are looked through', () => {
    expect(unwrapArgv(['env', 'A=1', 'B=2', 'npx', '-y', 'pkg'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['/usr/bin/env', '-u', 'HOME', 'npx', 'pkg'])).toEqual(['npx', 'pkg']);
    expect(unwrapArgv(['env', '-S', 'npx -y pkg'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['cmd', '/c', 'npx', '-y', 'pkg'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['C:\\Windows\\System32\\cmd.exe', '/d', '/s', '/c', 'npx -y pkg'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['sh', '-c', 'exec npx -y "pkg"'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['bash', '-lc', 'env A=1 npx pkg'])).toEqual(['npx', 'pkg']);
    expect(launcherOf(['env', 'A=1', 'npx', '-y', '@acme/notes-mcp'])).toMatchObject({ launcher: 'npx', pinned: false });
    expect(launcherOf(['cmd', '/c', 'npx', '-y', '@acme/notes-mcp@1.4.2'])).toMatchObject({ launcher: 'npx', pinned: true });
    // Not a wrapper: a plain node server, or cmd without /c.
    expect(unwrapArgv(['node', 'server.js'])).toEqual(['node', 'server.js']);
    expect(launcherOf(['cmd', 'npx', 'pkg'])).toBeUndefined();
    expect(launcherOf(['sh', 'start.sh'])).toBeUndefined();
  });

  it('uv run counts --locked / --frozen only before the script', () => {
    expect(launcherOf(['uv', 'run', 'server.py', '--locked'])?.pinned).toBe(false);
    expect(launcherOf(['uv', 'run', '--', 'server.py', '--frozen'])?.pinned).toBe(false);
    expect(launcherOf(['uv', 'run', '--locked', 'server.py'])?.pinned).toBe(true);
    expect(launcherOf(['uv', 'run', '--with', 'httpx', '--frozen', 'server.py'])?.pinned).toBe(true);
    expect(launcherOf(['uv', 'run', '--directory', '--locked', 'server.py'])?.pinned).toBe(false);
  });

  it('LST-008 and LST-009 fire on npm exec, bun x, uv tool run, cmd /c npx and env npx', async () => {
    const npmrc = { '.npmrc': 'registry=https://npm.evil.test/\n' };
    const forms: Array<[string, string, string[]]> = [
      ['npm-exec', 'npm', ['exec', '--yes', '@acme/notes-mcp']],
      ['npm-x', 'npm', ['x', '--yes', '@acme/notes-mcp']],
      ['bun-x', 'bun', ['x', '@acme/notes-mcp']],
      ['pnpx', 'pnpx', ['@acme/notes-mcp']],
      ['uv-tool', 'uv', ['tool', 'run', 'acme-mcp']],
      ['cmd', 'cmd', ['/c', 'npx', '-y', '@acme/notes-mcp']],
      ['env', 'env', ['A=1', 'npx', '-y', '@acme/notes-mcp']],
    ];
    for (const [name, command, args] of forms) {
      const f = await lst(plugin(name, command, args, npmrc), 'LST-008', 'LST-009');
      expect(f.map((x) => x.ruleId).sort(), name).toEqual(['LST-008', 'LST-009']);
      expect(f.find((x) => x.ruleId === 'LST-008')!.severity, name).toBe('error');
    }
    const npmExec = await lst(plugin('msg', 'npm', ['exec', '--yes', '@acme/notes-mcp']), 'LST-008');
    expect(npmExec[0].message).toMatch(/runs npm exec "@acme\/notes-mcp" without an exact version \(blocks: Unpinned npx launcher\)/);
    expect(await lst(plugin('pinned', 'cmd', ['/c', 'npx', '-y', '@acme/notes-mcp@1.4.2']), 'LST-008')).toEqual([]);
  });

  it('LST-008 reports uv run with --locked after the script', async () => {
    const f = await lst(plugin('uvlate', 'uv', ['run', 'server.py', '--locked']), 'LST-008');
    expect(f.map((x) => x.message)).toEqual([expect.stringMatching(/runs uv run without --locked or --frozen/)]);
  });
});
