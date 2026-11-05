// 1.1.0 Q3: --version and --help load no check module (no transport, rules or renderers); --list-rules and explain
// load the rules but not the transport (connect.ts, the MCP SDK, the proxy); a check still installs the proxy, and a
// bad proxy variable is still exit 2 for a check but not for --help or explain.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLI } from './cli-runner.js';

let dir = '';
let preload = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mrc-q3-lazy-'));
  // A resolve hook that logs every module URL the CLI loads into the file named by MRC_LOAD_LOG.
  writeFileSync(join(dir, 'hooks.mjs'), [
    "import { appendFileSync } from 'node:fs';",
    'export async function resolve(specifier, context, next) {',
    '  const r = await next(specifier, context);',
    "  if (process.env.MRC_LOAD_LOG) appendFileSync(process.env.MRC_LOAD_LOG, r.url + '\\n');",
    '  return r;',
    '}',
  ].join('\n'));
  preload = join(dir, 'register.mjs');
  writeFileSync(preload, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(dir, 'hooks.mjs')).href)});\n`);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string; loaded: string[] }> {
  const log = join(dir, `load-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(log, '');
  return new Promise((done) => {
    execFile(process.execPath, ['--import', pathToFileURL(preload).href, CLI, ...args], { env: { ...process.env, NO_COLOR: '1', MRC_LOAD_LOG: log, ...env }, timeout: 60000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      done({ code, stdout, stderr, loaded: readFileSync(log, 'utf8').split('\n').filter(Boolean) });
    });
  });
}

const has = (loaded: string[], part: string) => loaded.some((u) => u.includes(part));

describe('lazy loading of the check modules', () => {
  it('--version and --help load no transport, rules, renderers or third-party package', async () => {
    for (const args of [['--version'], ['--help']]) {
      const r = await run(args);
      expect(r.code, r.stderr).toBe(0);
      expect(has(r.loaded, '/dist/cli.js')).toBe(true);
      for (const heavy of ['/dist/connect.js', '/dist/proxy.js', '/dist/rules/index.js', '/dist/report/text.js', '/dist/explain.js', '/node_modules/']) {
        expect(has(r.loaded, heavy), `${args[0]} loaded ${heavy}`).toBe(false);
      }
    }
  });

  it('explain and --list-rules load the rules but not connect.ts or the MCP SDK', async () => {
    for (const args of [['explain', 'TOOL-011'], ['--list-rules', 'TOOL']]) {
      const r = await run(args);
      expect(r.code, r.stderr).toBe(0);
      expect(has(r.loaded, '/dist/rules/index.js')).toBe(true);
      expect(has(r.loaded, '/dist/connect.js'), args[0]).toBe(false);
      expect(has(r.loaded, '@modelcontextprotocol'), args[0]).toBe(false);
      // 1.1.0 integration: proxy.ts loads undici only inside installProxy, so the rules' import of diagnose.ts no longer pulls it in.
      expect(has(r.loaded, '/node_modules/undici/'), `${args[0]} loaded undici`).toBe(false);
    }
  });

  it('a bad proxy variable: --help and explain still work, a check is exit 2 with the proxy message', async () => {
    const env = { HTTPS_PROXY: 'socks4://127.0.0.1:1080' };
    expect((await run(['--help'], env)).code).toBe(0);
    expect((await run(['explain', 'TOOL-011'], env)).code).toBe(0);
    const check = await run(['https://mcp.example.invalid/mcp'], env);
    expect(check.code).toBe(2);
    expect(check.stderr).toMatch(/^error: HTTPS_PROXY: unsupported proxy scheme "socks4:\/\/"/);
    expect(check.stderr).toContain('Run with --help for usage.');
  });
});
