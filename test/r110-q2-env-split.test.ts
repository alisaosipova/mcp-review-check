// 1.1.0, package Q2 review fixes: env -S with K=V assignments before the launcher.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function plugin(name: string, command: string, args: string[]): string {
  const root = join(dir, name);
  cpSync(join(FIX, 'plugin-valid'), root, { recursive: true });
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command, args } } }));
  writeFileSync(join(root, '.npmrc'), 'registry=https://npm.evil.test/\n');
  return root;
}
const lst = async (root: string, ...ids: string[]) =>
  findings((await run(['--plugin-dir', root, '--target', 'claude', '--format', 'json'])).stdout).filter((f) => ids.includes(f.ruleId));

describe('review Q2: env -S with assignments', () => {
  it('the K=V words of the split string are skipped like env K=V', () => {
    expect(unwrapArgv(['env', '-S', 'A=1 npx foo'])).toEqual(['npx', 'foo']);
    expect(launcherOf(['env', '-S', 'A=1 npx foo'])).toMatchObject({ launcher: 'npx', spec: 'foo', pinned: false });
    expect(unwrapArgv(['/usr/bin/env', '-SA=1 B=2 npx -y pkg'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['env', '--split-string', 'NODE_ENV=production npx -y pkg', 'extra'])).toEqual(['npx', '-y', 'pkg', 'extra']);
    expect(unwrapArgv(['env', '-S', '-u HOME A=1 npx pkg'])).toEqual(['npx', 'pkg']);
    expect(unwrapArgv(['env', '-S', 'npx -y pkg'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['env', '--split-string=A=1 npx pkg'])).toEqual(['npx', 'pkg']);
    expect(launcherOf(['env', '-S', 'A=1 npx foo@1.2.3'])).toMatchObject({ pinned: true });
  });

  it('LST-008 and LST-009 fire on /usr/bin/env -S "NODE_ENV=production npx -y @acme/notes-mcp"', async () => {
    const f = await lst(plugin('envs', '/usr/bin/env', ['-S', 'NODE_ENV=production npx -y @acme/notes-mcp']), 'LST-008', 'LST-009');
    expect(f.map((x) => x.ruleId).sort()).toEqual(['LST-008', 'LST-009']);
    expect(await lst(plugin('envs-pinned', '/usr/bin/env', ['-S', 'NODE_ENV=production npx -y @acme/notes-mcp@1.4.2']), 'LST-008')).toEqual([]);
  });
});
