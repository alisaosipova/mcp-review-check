// Regression tests for W6F-cli-wiring (wave 6, 0.4.0): --plugin-dir and --openai-manifest, their config keys
// (pluginDir, openaiManifest, failOnDrift, diffOnly), usage errors and an end-to-end run over test/fixtures/listing.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { loadConfig } from '../src/config.js';

const GOOD = fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));
const stdio = ['--stdio', '--', process.execPath, GOOD];
// Options go before the "--" of the stdio command: run() takes them first and appends the server.
const run = (args: string[]) => runCli(args.includes('--stdio') ? [...args.filter((a) => a !== '--stdio' && a !== '--' && a !== process.execPath && a !== GOOD), ...stdio] : args, {}, false);
const idOf = (f: { ruleId?: string; id?: string }) => f.ruleId ?? f.id;
const lst = (stdout: string) => (JSON.parse(stdout).findings as Array<{ ruleId?: string; id?: string }>).map(idOf).filter((id) => id?.startsWith('LST-'));

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w6f-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('config keys', () => {
  it('pluginDir and openaiManifest are paths relative to the file; failOnDrift and diffOnly are switches', () => {
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({ pluginDir: 'plug', openaiManifest: 'pkg/plugin.json', failOnDrift: true, diffOnly: false }));
    const c = loadConfig(p, true);
    expect(c.options).toEqual({ 'plugin-dir': join(dir, 'plug'), 'openai-manifest': join(dir, 'pkg/plugin.json'), 'fail-on-drift': true });
    expect(c.keys['plugin-dir']).toBe('pluginDir');
  });

  it('wrong types are errors naming the key and not the value', () => {
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({ pluginDir: 42 }));
    expect(() => loadConfig(p, true)).toThrow(/key "pluginDir" must be a string/);
    writeFileSync(p, JSON.stringify({ diffOnly: 'yes' }));
    expect(() => loadConfig(p, true)).toThrow(/key "diffOnly" must be true or false \(the value is not shown\)/);
  });

  it('a config pluginDir runs the LST rules; the flag overrides the key', async () => {
    const cfg = join(dir, 'cfg.json');
    writeFileSync(cfg, JSON.stringify({ pluginDir: join(FIX, 'plugin-invalid'), format: 'json', failOn: 'never' }));
    const fromFile = await run(['--config', cfg, ...stdio]);
    expect(lst(fromFile.stdout).length).toBeGreaterThan(0);
    const flagWins = await run(['--config', cfg, '--plugin-dir', join(FIX, 'plugin-valid'), ...stdio]);
    expect(lst(flagWins.stdout)).toEqual([]);
  });

  it('failOnDrift in the file without --baseline is a usage error naming the key', async () => {
    const cfg = join(dir, 'cfg.json');
    writeFileSync(cfg, JSON.stringify({ failOnDrift: true }));
    const r = await run(['--config', cfg, ...stdio]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--fail-on-drift needs --baseline');
  });
});

describe('usage errors', () => {
  it('a missing path names the flag and not the path', async () => {
    const r = await run([...stdio, '--plugin-dir', join(dir, 'secret-nowhere')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--plugin-dir: no such directory');
    expect(r.stderr).not.toContain('secret-nowhere');
    const m = await run([...stdio, '--openai-manifest', join(dir, 'secret-nowhere.json')]);
    expect(m.code).toBe(2);
    expect(m.stderr).toContain('--openai-manifest: no such file');
    expect(m.stderr).not.toContain('secret-nowhere');
  });

  it('the wrong kind is exit 2', async () => {
    expect((await run([...stdio, '--plugin-dir', join(FIX, 'openai-valid/plugin.json')])).stderr).toContain('--plugin-dir must be a directory, not a file');
    const r = await run([...stdio, '--openai-manifest', join(FIX, 'openai-valid')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--openai-manifest must be a file, not a directory');
  });

  it('an empty value is a usage error; a listing without a target is a listing-only run (0.6)', async () => {
    expect((await run([...stdio, '--plugin-dir='])).code).toBe(2);
    const r = await run(['--plugin-dir', join(FIX, 'plugin-valid')]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/listing-only/);
  });
});

describe('end to end over the fixtures', () => {
  it('--plugin-dir plugin-invalid gives LST findings in JSON and exit 1', async () => {
    const r = await run([...stdio, '--plugin-dir', join(FIX, 'plugin-invalid'), '--format', 'json']);
    expect(r.code).toBe(1);
    expect(lst(r.stdout)).toContain('LST-005');
  });

  it('--plugin-dir plugin-valid gives no LST finding', async () => {
    const r = await run([...stdio, '--plugin-dir', join(FIX, 'plugin-valid'), '--format', 'json']);
    expect(lst(r.stdout)).toEqual([]);
  });

  it('--openai-manifest openai-invalid gives LST findings; openai-valid none and drops MAN-015', async () => {
    const bad = await run([...stdio, '--target', 'chatgpt', '--openai-manifest', join(FIX, 'openai-invalid/plugin.json'), '--format', 'json']);
    expect(lst(bad.stdout).length).toBeGreaterThan(0);
    const ok = await run([...stdio, '--target', 'chatgpt', '--openai-manifest', join(FIX, 'openai-valid/plugin.json'), '--format', 'json']);
    expect(lst(ok.stdout).filter((id) => id !== 'LST-025' && id !== 'LST-026')).toEqual([]);
    const manual = (JSON.parse(ok.stdout).manual as Array<{ id: string }>).map((m) => m.id);
    expect(manual).not.toContain('MAN-015');
    const without = (JSON.parse((await run([...stdio, '--target', 'chatgpt', '--format', 'json'])).stdout).manual as Array<{ id: string }>).map((m) => m.id);
    expect(without).toContain('MAN-015');
  });

  it('both flags together, and a path relative to the working directory', async () => {
    const r = await run([...stdio, '--plugin-dir', join(FIX, 'plugin-invalid'), '--openai-manifest', join(FIX, 'openai-invalid/plugin.json'), '--format', 'json']);
    const ids = lst(r.stdout).map((id) => Number(id!.slice(4)));
    expect(ids.some((n) => n <= 15)).toBe(true);
    expect(ids.some((n) => n >= 16)).toBe(true);
    const rel = await run([...stdio, '--plugin-dir', 'test/fixtures/listing/plugin-invalid', '--format', 'json']);
    expect(lst(rel.stdout).length).toBeGreaterThan(0);
  });
});

describe('redaction', () => {
  it('a SYNTH token in a plugin header reaches no output format', async () => {
    const token = ['ghp', 'SYNTH0123456789abcdefghijklmnopqrstu'].join('_');
    const plugin = join(dir, 'plug');
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'demo-plugin', description: 'd', author: { name: 'a' }, version: '1.0.0' }));
    writeFileSync(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { s: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: `Bearer ${token}` } } } }));
    const json = await run([...stdio, '--plugin-dir', plugin, '--format', 'json']);
    expect(lst(json.stdout)).toContain('LST-011');
    for (const format of ['json', 'text', 'markdown', 'sarif', 'junit']) {
      const r = await run([...stdio, '--plugin-dir', plugin, '--format', format, '--verbose']);
      expect(r.stdout + r.stderr).not.toContain('SYNTH');
    }
  });
});
