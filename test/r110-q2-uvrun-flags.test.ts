// 1.1.0, package Q2 review fixes: uv run options that take a value do not hide --locked / --frozen.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { launcherOf } from '../src/rules/listing.js';
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
  return root;
}
const lst = async (root: string, ...ids: string[]) =>
  findings((await run(['--plugin-dir', root, '--target', 'claude', '--format', 'json'])).stdout).filter((f) => ids.includes(f.ruleId));

describe('review Q2: uv run value options before --locked', () => {
  it('the value of --allow-insecure-host, -C, --config-setting, --fork-strategy and other value options is not the script', () => {
    const forms = [
      ['--allow-insecure-host', 'h.example'],
      ['-C', 'k=v'],
      ['--config-setting', 'k=v'],
      ['--fork-strategy', 'fewest'],
      ['--exclude-newer-package', 'acme=2026-01-01'],
      ['--config-settings-package', 'acme:k=v'],
      ['-w', 'httpx'],
      ['-i', 'https://pypi.org/simple'],
    ];
    for (const f of forms) {
      expect(launcherOf(['uv', 'run', ...f, '--locked', 'server.py'])?.pinned, f.join(' ')).toBe(true);
      expect(launcherOf(['uv', 'run', ...f, '--frozen', 'server.py'])?.pinned, f.join(' ')).toBe(true);
      expect(launcherOf(['uv', 'run', ...f, 'server.py', '--locked'])?.pinned, f.join(' ')).toBe(false);
    }
  });

  it('an unknown option with a value does not hide --locked; known flags without a value still end at the script', () => {
    expect(launcherOf(['uv', 'run', '--some-future-option', 'x', '--locked', 'server.py'])?.pinned).toBe(true);
    expect(launcherOf(['uv', 'run', '--no-sync', 'server.py', '--locked'])?.pinned).toBe(false);
    expect(launcherOf(['uv', 'run', '-q', 'server.py', '--locked'])?.pinned).toBe(false);
    expect(launcherOf(['uv', 'run', '-m', 'acme.server', '--frozen'])?.pinned).toBe(false);
    expect(launcherOf(['uv', 'run', '--allow-insecure-host=h', '--locked', 'server.py'])?.pinned).toBe(true);
    expect(launcherOf(['uv', 'run', '--locked', 'server.py'])?.pinned).toBe(true);
    expect(launcherOf(['uv', 'run', 'server.py'])?.pinned).toBe(false);
  });

  it('LST-008 does not fire on uv run --allow-insecure-host <host> --locked server.py (passed on 1.0.x)', async () => {
    expect(await lst(plugin('insecure', 'uv', ['run', '--allow-insecure-host', 'pypi.corp.example', '--locked', 'server.py']), 'LST-008')).toEqual([]);
    expect(await lst(plugin('cfgset', 'uv', ['run', '-C', 'k=v', '--frozen', 'server.py']), 'LST-008')).toEqual([]);
    expect((await lst(plugin('late', 'uv', ['run', '--fork-strategy', 'fewest', 'server.py', '--locked']), 'LST-008')).length).toBe(1);
  });
});
