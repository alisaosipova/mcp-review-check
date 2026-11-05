// 1.1.0, package Q2: A06-11 a font file as plugin icon.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const lst = async (root: string, ...ids: string[]) =>
  findings((await run(['--plugin-dir', root, '--target', 'claude', '--format', 'json'])).stdout).filter((f) => ids.includes(f.ruleId));

describe('A06-11 LST-014 does not accept a font as the plugin icon', () => {
  it('icon ./assets/icon.woff2 is not an image file path', async () => {
    for (const ext of ['woff2', 'ttf', 'otf', 'eot']) {
      const root = join(dir, `font-${ext}`);
      cpSync(join(FIX, 'plugin-valid'), root, { recursive: true });
      writeFileSync(join(root, 'assets', `icon.${ext}`), Buffer.from('wOF2'));
      const m = join(root, '.claude-plugin', 'plugin.json');
      const json = JSON.parse(readFileSync(m, 'utf8'));
      writeFileSync(m, JSON.stringify({ ...json, icon: `./assets/icon.${ext}` }));
      const f = await lst(root, 'LST-014');
      expect(f.map((x) => x.message), ext).toEqual([expect.stringMatching(new RegExp(`icon "\\./assets/icon\\.${ext}" is not an image file path`))]);
    }
    expect(await lst(join(FIX, 'plugin-valid'), 'LST-014')).toEqual([]);
  });
});
